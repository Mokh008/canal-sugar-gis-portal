window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Camera: all cinematic movement (fly/fit/reset/idle/story)
   funnels through here so easing/duration stay consistent everywhere
   they're triggered from. Built on one reusable primitive — a camera
   timeline that chains easeTo/flyTo/fitBounds steps as promises — instead
   of ad hoc nested `.once('moveend')` callbacks. Multi-stage cinematic
   flights, Story Mode, and idle drift are all just different timelines
   built from the same primitive. */
MKNexus.Camera = (function () {
  const IDLE_TASK = 'camera-idle-drift';
  const ORBIT_TASK = 'camera-orbit';

  const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // A step normally resolves on the map's 'moveend' — but MapLibre doesn't
  // reliably fire 'moveend' for a step whose destination is (near-)
  // identical to the current camera position (e.g. re-clicking an already-
  // centered boundary). Without a fallback, that leaves the whole chained
  // promise — and with it, GeoState's pending KPI-panel update — hanging
  // forever. STEP_TIMEOUT_MS is comfortably above the longest configured
  // flight (governorate: ~450ms wind-up + 1500ms fly), so it only ever
  // fires as a safety net, never cutting a real animation short.
  const STEP_TIMEOUT_MS = 3000;

  // ---- Camera timeline primitive ------------------------------------
  // .easeTo/.flyTo/.fitBounds queue a step; each step only starts once the
  // previous one's 'moveend' has fired. .promise() resolves once every
  // queued step has settled — that's the signal callers (GeoState) wait on
  // before opening the KPI panel.
  function createTimeline(map) {
    let chain = Promise.resolve();
    function step(run) {
      chain = chain.then(() => new Promise((resolve) => {
        let settled = false;
        const finish = () => { if (settled) return; settled = true; resolve(); };
        map.once('moveend', finish);
        run();
        window.setTimeout(finish, STEP_TIMEOUT_MS);
      }));
      return api;
    }
    const api = {
      easeTo: (opts) => step(() => map.easeTo(opts)),
      flyTo: (opts) => step(() => map.flyTo(opts)),
      fitBounds: (bounds, opts) => step(() => map.fitBounds(bounds, opts)),
      promise: () => chain,
    };
    return api;
  }

  // Per-level cinematic tuning — a Governorate flight reads wide and
  // deliberate, a District/Area flight tight and quick, so the *motion*
  // itself reinforces the same hierarchy the border styling already does.
  const LEVEL_PROFILE = {
    'governorate-group': { windUpMs: 450, flyMs: 1500, backOff: 1.35 },
    administration: { windUpMs: 380, flyMs: 1150, backOff: 1.2 },
    district: { windUpMs: 300, flyMs: 850, backOff: 1.08 },
  };
  const DEFAULT_PROFILE = LEVEL_PROFILE.administration;

  function flyTo({ center, zoom, pitch = 0, bearing = 0, duration = 900 }) {
    const map = MKNexus.MapEngine.getMap();
    if (!map) return Promise.resolve();
    stopIdleDrift();
    return createTimeline(map)
      .flyTo({ center, zoom, pitch, bearing, duration, curve: 1.5, easing: (t) => 1 - Math.pow(1 - t, 3) })
      .promise();
  }

  // The "weather forecast" flight: a brief wind-up (ease back + start
  // rotating toward the destination bearing) before the actual fly-in, so
  // arriving at a boundary reads as a deliberate camera decision rather
  // than a hard cut. Resolves once the *real* fly-in settles, so callers
  // that need to wait for the camera to actually stop (e.g. before opening
  // the KPI panel) get an accurate signal either way.
  function fitToBoundary(boundary, { pitch = 45, bearing, padding = 120, duration } = {}) {
    const map = MKNexus.MapEngine.getMap();
    if (!map || !boundary?.geometry) return Promise.resolve();
    stopIdleDrift();

    const coords = boundary.geometry.coordinates[0];
    const bounds = coords.reduce(
      (b, [lng, lat]) => b.extend([lng, lat]),
      new maplibregl.LngLatBounds(coords[0], coords[0])
    );
    const lngSpan = Math.max(bounds.getEast() - bounds.getWest(), 0.0001);
    const latSpan = Math.max(bounds.getNorth() - bounds.getSouth(), 0.0001);
    const calculatedBearing = (Math.atan2(lngSpan, latSpan) * 180) / Math.PI - 45;
    const calculatedPitch = Math.min(52, Math.max(30, 42 + Math.log10(Math.max(lngSpan, latSpan)) * 2));

    const profile = LEVEL_PROFILE[boundary.type] || DEFAULT_PROFILE;
    const targetPitch = pitch === 45 ? calculatedPitch : pitch;
    const targetBearing = bearing ?? calculatedBearing;
    const flyDuration = duration ?? profile.flyMs;
    const fitOpts = { padding: typeof padding === 'number' ? padding : 120, pitch: targetPitch, bearing: targetBearing, duration: flyDuration, curve: 1.5 };

    if (prefersReducedMotion()) {
      return createTimeline(map).fitBounds(bounds, fitOpts).promise();
    }

    // Stage 1 — zoom out slightly + start rotating toward the destination
    // bearing (in place, no pan) — the wind-up. Stage 2 — the actual
    // fly-in — only departs once the wind-up has eased to a stop.
    const currentZoom = map.getZoom();
    const currentBearing = map.getBearing();
    const windUpBearing = currentBearing + (targetBearing - currentBearing) * 0.35;

    return createTimeline(map)
      .easeTo({
        zoom: Math.max(currentZoom - Math.log2(profile.backOff), currentZoom - 1.1),
        bearing: windUpBearing,
        duration: profile.windUpMs,
        easing: (t) => t * (2 - t),
      })
      .fitBounds(bounds, fitOpts)
      .promise();
  }

  function reset({ duration = 650 } = {}) {
    stopOrbit();
    return flyTo({
      center: [MKNexus.Config.MAP_DEFAULTS.center.lng, MKNexus.Config.MAP_DEFAULTS.center.lat],
      zoom: MKNexus.Config.MAP_DEFAULTS.zoomLevels.company,
      pitch: 0,
      bearing: 0,
      duration,
    });
  }

  function stopOrbit() { MKNexus.AnimationTicker.unregister(ORBIT_TASK); }

  function orbit({ duration = 18000, turns = 1 } = {}) {
    const map = MKNexus.MapEngine.getMap();
    if (!map) return Promise.resolve();
    stopIdleDrift();
    stopOrbit();
    const startedAt = performance.now();
    const startBearing = map.getBearing();
    return new Promise((resolve) => {
      MKNexus.AnimationTicker.register(ORBIT_TASK, (now) => {
        const progress = Math.min((now - startedAt) / duration, 1);
        map.setBearing(startBearing + progress * 360 * turns);
        if (progress >= 1) { stopOrbit(); resolve(); }
      });
    });
  }

  // Idle ambience: while nothing is selected and the user hasn't touched
  // the map, sway the bearing a few degrees on a very slow cycle (see
  // MAP_DEFAULTS.globe in config.js) — enough to read as "alive" without
  // ever feeling like the map moved on its own. Cancelled the instant the
  // user interacts, or a real camera move (fitToBoundary/flyTo/orbit)
  // starts. Same sway works whether the camera is currently rendering the
  // globe or has already blended into flat Mercator — bearing rotation
  // isn't projection-specific.
  let idleListenersBound = false;

  function stopIdleDrift() { MKNexus.AnimationTicker.unregister(IDLE_TASK); }

  function bindIdleInterruptors(map) {
    if (idleListenersBound) return;
    idleListenersBound = true;
    ['dragstart', 'wheel', 'touchstart', 'zoomstart'].forEach((evt) => {
      map.on(evt, () => stopIdleDrift());
    });
  }

  function startIdleDrift() {
    const map = MKNexus.MapEngine.getMap();
    if (!map || prefersReducedMotion()) return;
    const globeCfg = MKNexus.Config.MAP_DEFAULTS.globe || {};
    const period = globeCfg.idleDriftPeriodMs ?? 120000;
    const sway = globeCfg.idleDriftDegrees ?? 5;
    bindIdleInterruptors(map);
    const startedAt = performance.now();
    const baseBearing = map.getBearing();
    MKNexus.AnimationTicker.register(IDLE_TASK, (now) => {
      const t = ((now - startedAt) % period) / period;
      map.setBearing(baseBearing + Math.sin(t * Math.PI * 2) * sway);
    });
  }

  // Story Mode reuses flyTo/orbit exactly as any other caller would; the
  // "make this boundary the active selection" side effects (glow/dim/KPI
  // deck) are delegated to GeoState instead of duplicated here, so Story
  // Mode and a manual click produce identical selection behavior.
  async function playStory(stops, onComplete) {
    const map = MKNexus.MapEngine.getMap();
    if (!map || !stops?.length) return;
    stopIdleDrift();
    stopOrbit();
    for (const stop of stops) {
      const boundary = stop.boundary;
      if (!boundary?.geometry) continue;
      const center = boundary.geometry.coordinates[0][0];
      await flyTo({ center, zoom: 11, pitch: 48, bearing: -8, duration: 650 });
      MKNexus.GeoState.select(boundary.id, { moveCamera: false });
      await orbit({ duration: 5200, turns: 0.35 });
    }
    onComplete?.();
  }

  return { flyTo, fitToBoundary, reset, orbit, stopOrbit, startIdleDrift, stopIdleDrift, playStory };
})();
