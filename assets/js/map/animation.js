window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Map Animation: cinematic effects layered on top of camera
   moves — procedural canvas particle burst (no assets), the active-
   selection glow pulse + traveling sweep, ambient boundary breathing, and
   a generic count-up utility the KPI panel uses. Every animation loop here
   runs as a task on MKNexus.AnimationTicker (one shared rAF driver) instead
   of owning a private requestAnimationFrame loop — see animation-ticker.js. */
MKNexus.MapAnimation = (function () {
  function countUp(el, { to, decimals = 0, duration = 1.2, suffix = '' }) {
    if (!el) return;
    const obj = { value: 0 };
    gsap.to(obj, {
      value: to, duration: Math.max(0.55, Math.min(0.7, duration)), ease: 'power3.out',
      onUpdate: () => { el.textContent = `${obj.value.toFixed(decimals)}${suffix}`; },
    });
  }

  const THEME = window.MKNexus?.Theme || {};
  const MAP_THEME = THEME.map || {};
  const PALETTE = THEME.palette || {};
  const ANIMATION_SPEED = MAP_THEME.animationSpeed ?? 1;
  const PULSE_STRENGTH = MAP_THEME.pulseStrength ?? 1;

  // The "alive" selection glow (pulseGlow + sweepActiveBoundary below)
  // scales by the selected boundary's level (MAP_THEME.levels[n].
  // aliveGlowScale), so an Administration or Area reads a visibly thinner/
  // subtler ring than a Governorate — hierarchy holds even once something
  // is selected. Every number these animate with — period, amplitude, per-
  // level scale — comes from MAP_THEME (config.js), never a literal here.
  function aliveGlowScale(boundaryType) {
    const level = (MAP_THEME.levels || []).find((entry) => entry.type === boundaryType);
    return level?.aliveGlowScale ?? 1;
  }

  const PULSE_TASK = 'selection-pulse';
  const SWEEP_TASK = 'selection-sweep';
  const BREATHE_TASK = 'boundary-breathe';

  function stopBoundaryPulse() { MKNexus.AnimationTicker.unregister(PULSE_TASK); }

  function pulseGlow(map, boundaryId, boundaryType) {
    if (!map || boundaryId == null || !map.getLayer('mk-boundary-glow')) return;
    const scale = aliveGlowScale(boundaryType);
    const cfg = MAP_THEME.pulse || {};
    const period = (cfg.periodMs ?? 4000) * ANIMATION_SPEED;
    const baseOpacity = cfg.baseOpacity ?? 0.34;
    const opacityAmp = (cfg.opacityAmplitude ?? 0.26) * PULSE_STRENGTH;
    const baseBlur = cfg.baseBlurAdd ?? 14;
    const blurAmp = (cfg.blurAmplitude ?? 9) * PULSE_STRENGTH;
    const baseWidth = cfg.baseWidthAdd ?? 9;
    const widthAmp = (cfg.widthAmplitude ?? 5) * PULSE_STRENGTH;
    const startTime = performance.now();
    // The glow layer covers every boundary (MapLibre doesn't allow
    // feature-state in a `filter` — see addSelectionGlowLayer in
    // layers.js), so "only the active one glows" lives entirely in these
    // paint values: every number this ticker computes gets wrapped in the
    // same active-only `case` the layer was created with, falling back to
    // 0 for every other feature. Plain numbers here (like the layer's
    // initial paint) would glow on *all* boundaries, not just this one.
    const isActive = ['boolean', ['feature-state', 'active'], false];
    // ~30fps ceiling — this is a slow cosmetic sine wave, not motion that
    // benefits from a full 60fps paint pass.
    MKNexus.AnimationTicker.register(PULSE_TASK, (now) => {
      const progress = (Math.sin(((now - startTime) / period) * Math.PI * 2) + 1) / 2;
      const lineOpacity = MKNexus.Layers?.getBoundaryLineOpacity?.() ?? 1;
      map.setPaintProperty('mk-boundary-glow', 'line-opacity', ['case', isActive, (baseOpacity + progress * opacityAmp) * (0.7 + scale * 0.3) * lineOpacity, 0]);
      map.setPaintProperty('mk-boundary-glow', 'line-blur', (baseBlur + progress * blurAmp) * scale);
      map.setPaintProperty('mk-boundary-glow', 'line-width', ['case', isActive, (baseWidth + progress * widthAmp) * scale, 0]);
    }, { intervalMs: 32 });
  }

  function stopBoundarySweep() { MKNexus.AnimationTicker.unregister(SWEEP_TASK); }

  // Builds a line-gradient with one soft, colored band centered on `center`
  // (0-1 along the line) and transparent everywhere else.
  function sweepGradientStops(center, color) {
    const halfWidth = MAP_THEME.sweep?.bandHalfWidth ?? 0.14;
    const start = Math.max(0.001, center - halfWidth);
    const end = Math.min(0.999, center + halfWidth);
    return [
      'interpolate', ['linear'], ['line-progress'],
      0, 'rgba(0,0,0,0)',
      start, 'rgba(0,0,0,0)',
      center, color,
      end, 'rgba(0,0,0,0)',
      1, 'rgba(0,0,0,0)',
    ];
  }

  // A soft highlight that glides back and forth along the active boundary's
  // own outline — the "this region just came alive" cue. Ping-pongs via a
  // sine wave rather than looping past the line's 0/1 seam (which would
  // otherwise jump), so the motion only ever eases — never resets abruptly.
  function sweepActiveBoundary(map, boundaryType) {
    if (!map || !map.getLayer('mk-boundary-sweep')) return;
    const scale = aliveGlowScale(boundaryType);
    const levelCfg = (MAP_THEME.levels || []).find((entry) => entry.type === 'governorate-group') || {};
    const sweepCfg = MAP_THEME.sweep || {};
    try {
      map.setPaintProperty('mk-boundary-sweep', 'line-width', ((levelCfg.width ?? 3.2) + (sweepCfg.widthAdd ?? 2.5)) * (0.6 + scale * 0.4));
    } catch (error) { /* cosmetic-only layer */ }
    const startTime = performance.now();
    const duration = (sweepCfg.periodMs ?? 5400) * ANIMATION_SPEED;
    const color = PALETTE.accentCore || '#cefeee';
    MKNexus.AnimationTicker.register(SWEEP_TASK, (now) => {
      const t = ((now - startTime) % duration) / duration;
      const center = 0.5 + 0.34 * Math.sin(t * Math.PI * 2);
      try {
        map.setPaintProperty('mk-boundary-sweep', 'line-gradient', sweepGradientStops(center, color));
      } catch (error) { /* cosmetic-only layer — never let a paint update break the loop */ }
    }, { intervalMs: 32 });
  }

  // Very slow (6-8s) ambient bloom "breathing" — distinct from pulseGlow
  // (which only runs for the active selection): this runs continuously and
  // subtly on every level that opts in via `level.breathe` (config.js),
  // throttled well under frame rate so large boundary datasets stay cheap
  // to render. No-ops if no level opts in.
  function startBoundaryBreath(map) {
    if (!map || MKNexus.AnimationTicker.isRegistered(BREATHE_TASK)) return;
    const breathingLevels = (MAP_THEME.levels || []).filter((level) => level.breathe);
    if (!breathingLevels.length) return;
    const breatheCfg = MAP_THEME.breathe || {};
    const baseOpacity = breatheCfg.baseOpacity ?? 0.09;
    const opacityAmp = breatheCfg.opacityAmplitude ?? 0.12;
    const baseWidthAdd = breatheCfg.baseWidthAdd ?? 1;
    const widthAmp = breatheCfg.widthAmplitude ?? 3;
    const startTime = performance.now();
    MKNexus.AnimationTicker.register(BREATHE_TASK, (now) => {
      const lineOpacity = MKNexus.Layers?.getBoundaryLineOpacity?.() ?? 1;
      breathingLevels.forEach((level) => {
        const id = `mk-boundary-${level.type}-ambient`;
        if (!map.getLayer(id)) return;
        const duration = Math.max(6000, Math.min(8000, level.breathe.duration || 7000)) * ANIMATION_SPEED;
        const wave = (Math.sin(((now - startTime) / duration) * Math.PI * 2) + 1) / 2;
        map.setPaintProperty(id, 'line-opacity', (baseOpacity + wave * opacityAmp) * lineOpacity);
        map.setPaintProperty(id, 'line-width', (level.bloom?.width ?? level.width) + baseWidthAdd + wave * widthAmp);
      });
    }, { intervalMs: 90 }); // ~11fps ceiling — a multi-second wave doesn't need 60fps
  }

  return { countUp, pulseGlow, startBoundaryBreath, sweepActiveBoundary, stopBoundarySweep };
})();
