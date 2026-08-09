window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Map Engine: boots MapLibre GL JS v5 with a self-contained
   style (no external tile requests beyond the satellite/terrain sources
   this project has always used). Globe projection renders a real 3D Earth
   at low zoom and MapLibre blends it into flat Mercator automatically as
   the camera zooms in — every boundary layer/expression in layers.js works
   completely unchanged regardless of which one is currently rendering.
   Background is transparent so the CSS backdrop (geo-module.css) shows
   through the canvas; boundary layers are added by layers.js on load. */
MKNexus.MapEngine = (function () {
  let map = null;

  const STYLE = {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    projection: { type: 'globe' },
    sources: {
      'mk-satellite': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: 'Esri World Imagery',
      },
      'mk-terrain': {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: 15,
      },
    },
    layers: [
      { id: 'mk-bg', type: 'background', paint: { 'background-color': 'rgba(0,0,0,0)' } },
      { id: 'mk-satellite-layer', type: 'raster', source: 'mk-satellite', paint: { 'raster-opacity': 0.82, 'raster-saturation': -0.35, 'raster-contrast': 0.08, 'raster-brightness-max': 0.72 } },
    ],
  };

  const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function init(containerId, { onLoad } = {}) {
    if (map) return map;

    const defaults = MKNexus.Config.MAP_DEFAULTS;
    const globeCfg = defaults.globe || {};
    const reduced = prefersReducedMotion();
    // Globe is only worth opening on if there's room to actually see it
    // reveal itself — reduced-motion users start directly at the final
    // company-zoom view instead (still styled `projection: 'globe'`, but
    // MapLibre's globe-to-Mercator blend is already complete by zoom 8, so
    // it renders indistinguishably from flat Mercator there).
    const showEstablishingShot = globeCfg.enabled !== false && !reduced;

    map = new maplibregl.Map({
      container: containerId,
      style: STYLE,
      center: [defaults.center.lng, defaults.center.lat],
      zoom: showEstablishingShot ? (globeCfg.establishingZoom ?? 1.6) : defaults.zoomLevels.company,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      dragRotate: true,
      touchZoomRotate: true,
      maxPitch: 75,
      maxZoom: 19,
    });

    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
      // A wide fog range plus a touch of horizon blend and a faint
      // starfield is what actually paints the globe's atmosphere/edge glow
      // — this is the single biggest lever for "looks like Earth from
      // orbit" versus "looks like a flat map with a vignette".
      map.setFog?.({
        range: [0.6, 10],
        color: 'rgba(7, 31, 27, 0.28)',
        'high-color': '#0a2b24',
        'space-color': '#020d0c',
        'horizon-blend': 0.16,
        'star-intensity': 0.15,
      });

      const settle = () => {
        // Terrain exaggeration is only meaningfully visible once the
        // camera has blended into the Mercator range anyway (zoomed into
        // a boundary) — enabling it only here, after the establishing
        // shot has already settled at company zoom, sidesteps any globe +
        // exaggerated-terrain interplay at very low (globe-visible) zoom.
        try {
          map.setTerrain({ source: 'mk-terrain', exaggeration: 1.15 });
        } catch (error) {
          console.warn('[MK Nexus] Terrain unavailable, continuing without it', error);
        }
        MKNexus.Camera.startIdleDrift();
        onLoad?.(map);
      };

      if (!showEstablishingShot) {
        settle();
        return;
      }

      // The establishing shot itself: ease up from the full-globe opening
      // zoom to the default company view. One continuous, cubic-eased
      // climb reads as "the Earth resolving into our region" rather than a
      // camera trick — no wind-up/rotate needed here since there's nowhere
      // to arrive *from* yet.
      map.once('moveend', settle);
      map.easeTo({
        zoom: defaults.zoomLevels.company,
        pitch: 0,
        duration: 2600,
        easing: (t) => 1 - Math.pow(1 - t, 3),
      });
    });
    return map;
  }

  function getMap() { return map; }

  return { init, getMap };
})();
