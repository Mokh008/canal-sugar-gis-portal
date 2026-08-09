window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Layers: owns the GeoJSON sources/layers for saved boundaries
   plus the in-progress draft polygon/vertices used by the GIS Editor.

   Boundary rendering is a declarative generator: MAP_THEME.levels
   (config.js) is a bottom-to-top recipe — one entry per hierarchy level,
   each describing its own casing/glow/core/highlight/label treatment.
   buildLevelLayers() reads that recipe and emits the layers; adding a
   level, or turning an optional sub-layer on/off for one, is a config
   change, not new rendering code. */
MKNexus.Layers = (function () {
  const SRC_BOUNDARIES = 'mk-boundaries';
  const SRC_DRAFT = 'mk-draft';
  const SRC_VERTICES = 'mk-draft-vertices';

  const TYPE_COLOR = {
    'governorate-group': '#b7bcbd',
    administration: '#3a9678',
    district: '#52c99b',
    'agricultural-zone': '#c3af8e',
  };

  const THEME = window.MKNexus?.Theme || {};
  const MAP_THEME = THEME.map || {};
  const PALETTE = THEME.palette || {};
  const LEVELS = MAP_THEME.levels || [];

  // ---- Presentation controls: live opacity dials ---------------------------
  // Two independent 0..1 dials a presenter can scrub live: one fades every
  // *saved* boundary line (casing/ambient/bloom/glow/core/highlight — the
  // permanent outline stack below), the other fades the in-progress draft
  // line drawn while marking a new boundary in the GIS Editor. Both are
  // plain JS numbers (not GL expressions) because MapLibre paint
  // expressions can't read a JS variable reactively — every change here
  // re-issues setPaintProperty on the affected layers instead.
  let boundaryLineOpacity = 1;
  let draftLineOpacity = 1;
  const boundaryOpacityLayers = [];

  // Registers a layer's 'line-opacity' as controlled by boundaryLineOpacity
  // and returns its current value — call this in place of computing the
  // paint value directly wherever a persistent boundary line is built.
  function registerLineOpacity(id, build) {
    boundaryOpacityLayers.push({ id, build });
    return build();
  }

  function setBoundaryLineOpacity(map, value) {
    boundaryLineOpacity = Math.max(0, Math.min(1, Number(value)));
    if (!map) return;
    boundaryOpacityLayers.forEach(({ id, build }) => { if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', build()); });
  }

  // Read by the per-frame animations in animation.js (ambient breathe,
  // selection pulse) so they scale their own live-computed opacity by the
  // same dial instead of overwriting it back to full — those tickers run
  // on a rAF loop and would otherwise stomp on setBoundaryLineOpacity()
  // roughly 10-30 times a second, making the slider look like it does
  // nothing whenever a boundary is breathing or actively selected.
  function getBoundaryLineOpacity() { return boundaryLineOpacity; }

  function setDraftLineOpacity(map, value) {
    draftLineOpacity = Math.max(0, Math.min(1, Number(value)));
    if (map?.getLayer('mk-draft-line')) map.setPaintProperty('mk-draft-line', 'line-opacity', draftLineOpacity);
  }

  // ---- Drill-down navigation ------------------------------------------
  // Every level used to render permanently stacked on top of every other
  // (governorate + administration + district lines all visible at once,
  // all the time) — fine with a handful of boundaries, unusable once real
  // data fills in every level, because deeper boundaries visually bury
  // their own parent. This makes exactly one level visible at a time:
  // start at governorates; entering one reveals only *its* administrations;
  // entering one of those reveals only *its* districts; clicking a district
  // (the leaf — nothing deeper to drill into) additionally isolates it
  // from its sibling districts. GeoState drives the transitions (see
  // geo-state.js); this module only owns turning that state into filters.
  let drillState = { level: 'governorate-group', parentId: null, isolateId: null };
  const drillLayers = []; // { id, type } — every per-level line/label layer, so applyDrillFilters can re-filter all of them in one pass

  function registerDrillLayer(id, type) {
    drillLayers.push({ id, type });
  }

  function drillFilterFor(type) {
    const base = ['==', ['get', 'type'], type];
    if (type !== drillState.level) return ['==', ['get', 'type'], '__mk_drill_hidden__']; // matches nothing — this type isn't the active drill level
    if (drillState.isolateId) return ['all', base, ['==', ['get', 'id'], drillState.isolateId]];
    if (drillState.parentId) return ['all', base, ['==', ['get', 'parentId'], drillState.parentId]];
    return base;
  }

  function applyDrillFilters(map) {
    drillLayers.forEach(({ id, type }) => { if (map.getLayer(id)) map.setFilter(id, drillFilterFor(type)); });
    // Casing and the (invisible) click/hover hit-target fill aren't
    // per-level layers — filter them the same way so hidden levels are
    // both invisible *and* unclickable, not just invisible.
    ['mk-boundary-casing', 'mk-boundary-fill'].forEach((id) => { if (map.getLayer(id)) map.setFilter(id, drillFilterFor(drillState.level)); });
    LEVELS.forEach((level) => { const id = `mk-label-${level.type}`; if (map.getLayer(id)) map.setFilter(id, drillFilterFor(level.type)); });
  }

  // { level: 'governorate-group' | 'administration' | 'district', parentId, isolateId }
  function setDrillState(map, next) {
    drillState = { level: next.level, parentId: next.parentId ?? null, isolateId: next.isolateId ?? null };
    if (map) applyDrillFilters(map);
  }

  function mapLabelFont() {
    const raw = THEME.typography?.titleFont || 'Space Grotesk Semibold';
    return raw.split(',')[0].trim().replace(/['"]/g, '');
  }

  // ---- Cinematic boundary rendering helpers -------------------------------
  // Hover/active states are baked into each layer's paint expression via
  // feature-state + GL paint transitions, so brightening is smooth and
  // per-feature — no duplicate "hover-only" layers required.

  const HOVER_MS = MAP_THEME.hoverTransitionMs ?? 240;

  function withTransitions(paint, props, ms = HOVER_MS) {
    props.forEach((prop) => { paint[`${prop}-transition`] = { duration: ms, delay: 0 }; });
    return paint;
  }

  // Scales a base value gently across zoom: borders stay readable when
  // zoomed out and gain natural weight (and slightly stronger glow) closer
  // in. `lowScale`'s default comes from MAP_THEME.minZoomScale — the single
  // "keep boundaries visible at every zoom level" dial. `highZoom` matches
  // the map's actual maxZoom (map.js) on purpose — a MapLibre 'interpolate'
  // expression clamps to its last stop's value past that point, so leaving
  // this short of maxZoom used to freeze the line width a few zoom levels
  // before the map could actually go, making boundaries fade to a hairline
  // (relative to the now-huge imagery) while still zooming in further —
  // exactly the "line barely visible while placing vertices" symptom.
  function zoomScaled(base, { lowZoom = 5, lowScale = MAP_THEME.minZoomScale ?? 0.75, midZoom = 9, highZoom = 19, highScale = 1.4 } = {}) {
    return ['interpolate', ['linear'], ['zoom'], lowZoom, base * lowScale, midZoom, base, highZoom, base * highScale];
  }

  // Same shape as zoomScaled, but for a `base` that's already a GL
  // expression (e.g. a per-type `case`) rather than a plain JS number —
  // multiplies it symbolically at each stop instead of doing the math in
  // JS. Needed because a style expression may contain at most ONE
  // zoom-based interpolate/step subexpression: nesting one *inside* each
  // branch of a `case` (one per boundary type) — which is what the casing
  // layer's width used to do — trips that limit and MapLibre silently
  // refuses to add the layer (logged, not thrown), so every boundary's
  // casing line has never actually been rendering.
  function zoomScaledExpr(expr, { lowZoom = 5, lowScale = MAP_THEME.minZoomScale ?? 0.75, midZoom = 9, highZoom = 19, highScale = 1.4 } = {}) {
    return ['interpolate', ['linear'], ['zoom'], lowZoom, ['*', expr, lowScale], midZoom, expr, highZoom, ['*', expr, highScale]];
  }

  // Adds a hover/active bump on top of a (possibly zoom-scaled) base value.
  // No flashing: the bump itself is a plain number, the *paint property*
  // transition (see withTransitions) is what makes it ease in/out smoothly.
  //
  // NOTE: this is only safe to use on a *zoom-free* baseExpr (e.g. a plain
  // number, or an opacity built from one) — wrapping a zoom-based
  // interpolate in a `+` violates MapLibre's "a zoom expression may only
  // be used as input to a top-level step/interpolate" rule. Every
  // *width* in this file used to do exactly that (`withStateDelta(
  // zoomScaled(...), ...)`), which MapLibre silently refused to add as a
  // layer at all — see zoomScaledWidthWithDelta below for the width case.
  function withStateDelta(baseExpr, hoverDelta = 0, activeDelta = 0) {
    if (!hoverDelta && !activeDelta) return baseExpr;
    return ['+', baseExpr, [
      'case',
      ['boolean', ['feature-state', 'active'], false], activeDelta,
      ['boolean', ['feature-state', 'hover'], false], hoverDelta,
      0,
    ]];
  }

  // The width equivalent of zoomScaled + withStateDelta combined into one
  // valid expression: the zoom interpolate stays the single top-level
  // expression, and the hover/active bump lives *inside* each of its stop
  // values instead of wrapping the whole thing — legal because a zoom
  // interpolate's stop values can be arbitrary (including feature-state)
  // expressions; only the zoom expression itself can't be nested.
  function zoomScaledWidthWithDelta(base, hoverDelta, activeDelta, { lowZoom = 5, lowScale = MAP_THEME.minZoomScale ?? 0.75, midZoom = 9, highZoom = 19, highScale = 1.4 } = {}) {
    if (!hoverDelta && !activeDelta) return zoomScaled(base, { lowZoom, lowScale, midZoom, highZoom, highScale });
    const delta = ['case',
      ['boolean', ['feature-state', 'active'], false], activeDelta,
      ['boolean', ['feature-state', 'hover'], false], hoverDelta,
      0,
    ];
    return ['interpolate', ['linear'], ['zoom'],
      lowZoom, ['+', base * lowScale, delta],
      midZoom, ['+', base, delta],
      highZoom, ['+', base * highScale, delta],
    ];
  }

  // Focus: once anything is selected, every *other* boundary recedes (its
  // 'dimmed' feature-state is set by setActive below) so the selection is
  // unmistakably the visual subject. `dimFactor` defaults come from
  // MAP_THEME.dimFactor (config.js).
  function withDim(expr, dimFactor = MAP_THEME.dimFactor?.line ?? 0.5) {
    return ['case', ['boolean', ['feature-state', 'dimmed'], false], ['*', expr, dimFactor], expr];
  }

  function lineLayout(level) {
    return { 'line-join': level.join || 'round', 'line-cap': level.cap || 'round' };
  }

  function boundaryFillColor() { return MAP_THEME.fill?.color || 'rgba(120, 255, 210, 0.08)'; }
  function baseFillOpacity() { return MAP_THEME.fill?.opacity ?? 0.1; }
  function hoverFillOpacity() { return MAP_THEME.fill?.hoverOpacity ?? 0.15; }
  function activeFillOpacity() { return MAP_THEME.fill?.selectedOpacity ?? 0.2; }

  // ---- Per-feature color derivation ---------------------------------------
  // Independent of the level-recipe generator above: this walks a boundary's
  // parent chain so a custom color set on a Governorate (metadata.color)
  // cascades as a lightened tint to its Administrations/Districts. Informs
  // the GeoJSON source's `styleColor`/`color` properties, which the GIS
  // Editor's list swatches read from boundary.metadata directly — kept
  // exactly as-is; the level recipe's own `color` is what actually paints
  // the boundary stroke unless a boundary opts into a custom color.
  function hexToRgb(hex) {
    const normalized = hex.replace('#', '');
    const value = normalized.length === 3 ? normalized.split('').map((char) => `${char}${char}`).join('') : normalized;
    const intValue = Number.parseInt(value, 16);
    return { r: (intValue >> 16) & 255, g: (intValue >> 8) & 255, b: intValue & 255 };
  }

  function rgbToHex({ r, g, b }) {
    const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
    return `#${[clamp(r), clamp(g), clamp(b)].map((component) => component.toString(16).padStart(2, '0')).join('')}`;
  }

  function lightenColor(hex, amount) {
    const base = hexToRgb(hex || '#52c99b');
    return rgbToHex({
      r: base.r + (255 - base.r) * amount,
      g: base.g + (255 - base.g) * amount,
      b: base.b + (255 - base.b) * amount,
    });
  }

  function styleColorFor(boundary) {
    if (!boundary) return null;
    const baseColor = boundary.metadata?.color || TYPE_COLOR[boundary.type] || '#52c99b';
    if (boundary.type === 'governorate-group') return baseColor;
    const parentBoundary = boundary.parentId ? MKNexus.Boundaries.getById(boundary.parentId) : null;
    const parentColor = parentBoundary ? styleColorFor(parentBoundary) : baseColor;
    return boundary.type === 'administration' ? lightenColor(parentColor, 0.28) : lightenColor(parentColor, 0.45);
  }

  function createStyledFeatureCollection() {
    const features = MKNexus.Boundaries.toFeatureCollection().features.map((feature) => {
      const boundary = MKNexus.Boundaries.getById(feature.properties.id);
      const styleColor = styleColorFor(boundary) || feature.properties.color || null;
      return { ...feature, properties: { ...feature.properties, color: styleColor, styleColor } };
    });
    return { type: 'FeatureCollection', features };
  }

  function ensureSources(map) {
    if (!map.getSource(SRC_BOUNDARIES)) {
      // lineMetrics enables ['line-progress'] for the traveling-light sweep
      // layer below — a rendering capability flag, not a data change.
      map.addSource(SRC_BOUNDARIES, { type: 'geojson', data: createStyledFeatureCollection(), lineMetrics: true });
    }
    if (!map.getSource(SRC_DRAFT)) {
      map.addSource(SRC_DRAFT, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource(SRC_VERTICES)) {
      map.addSource(SRC_VERTICES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
  }

  // ---- Declarative layer recipe -------------------------------------------

  function layerId(type, part) { return `mk-boundary-${type}-${part}`; }

  function addFillLayer(map) {
    if (map.getLayer('mk-boundary-fill')) return;
    map.addLayer({
      id: 'mk-boundary-fill', type: 'fill', source: SRC_BOUNDARIES,
      paint: withTransitions({
        'fill-color': boundaryFillColor(),
        'fill-opacity': withDim([
          'case',
          ['boolean', ['feature-state', 'active'], false], activeFillOpacity(),
          ['boolean', ['feature-state', 'hover'], false], hoverFillOpacity(),
          baseFillOpacity(),
        ], MAP_THEME.dimFactor?.fill),
      }, ['fill-opacity']),
    });
  }

  // A dark line drawn under every level's border stack, slightly wider than
  // each level's own core stroke — real "contrast against the map": keeps
  // the colored line legible over both bright sand and dark vegetation in
  // the satellite imagery, independent of hue. One shared layer (not one
  // per level) so it stays a single cheap GPU pass.
  function addCasingLayer(map) {
    const casing = MAP_THEME.contrastCasing || {};
    if (casing.enabled === false || map.getLayer('mk-boundary-casing') || !LEVELS.length) return;
    const widthAdd = casing.widthAdd ?? 2.6;
    // Per-type base width as a plain (zoom-free) `case` — the zoom scaling
    // is applied exactly once, around the whole thing, via zoomScaledExpr.
    const baseWidthCase = ['case',
      ...LEVELS.flatMap((level) => [['==', ['get', 'type'], level.type], level.width + widthAdd]),
      2 + widthAdd,
    ];
    map.addLayer({
      id: 'mk-boundary-casing', type: 'line', source: SRC_BOUNDARIES,
      filter: ['in', ['get', 'type'], ['literal', LEVELS.map((level) => level.type)]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: withTransitions({
        'line-color': casing.color || 'rgba(1, 8, 6, 0.7)',
        'line-width': zoomScaledExpr(baseWidthCase, { highScale: 1.3 }),
        'line-opacity': registerLineOpacity('mk-boundary-casing', () => withDim(0.85 * boundaryLineOpacity, MAP_THEME.dimFactor?.line)),
      }, ['line-opacity']),
    });
  }

  // One level's full stack: ambient breathe (opt-in) -> bloom (opt-in) ->
  // glow -> core -> highlight (opt-in). Sub-layers a level doesn't define
  // are simply never created — that's the entire mechanism for "richer
  // treatment for Governorate, lighter for Area."
  function buildLevelLayers(map, level) {
    const filter = ['==', ['get', 'type'], level.type];
    const layout = lineLayout(level);
    const hover = level.hover || {};
    const active = level.active || {};

    if (level.breathe && !map.getLayer(layerId(level.type, 'ambient'))) {
      map.addLayer({
        id: layerId(level.type, 'ambient'), type: 'line', source: SRC_BOUNDARIES,
        filter, layout,
        paint: {
          'line-color': level.glowColor || level.color,
          'line-width': (level.bloom?.width ?? level.width) + (MAP_THEME.breathe?.baseWidthAdd ?? 1),
          'line-opacity': registerLineOpacity(layerId(level.type, 'ambient'), () => (MAP_THEME.breathe?.baseOpacity ?? 0.09) * boundaryLineOpacity),
          'line-blur': (level.bloom?.blur ?? level.glowBlur ?? 4) + 2,
        },
      });
      registerDrillLayer(layerId(level.type, 'ambient'), level.type);
    }

    if (level.bloom && !map.getLayer(layerId(level.type, 'bloom'))) {
      map.addLayer({
        id: layerId(level.type, 'bloom'), type: 'line', source: SRC_BOUNDARIES,
        filter, layout,
        paint: withTransitions({
          'line-color': level.glowColor || level.color,
          'line-width': zoomScaledWidthWithDelta(level.bloom.width, hover.glowWidthDelta, active.glowWidthDelta, { highScale: 1.3 }),
          'line-opacity': registerLineOpacity(layerId(level.type, 'bloom'), () => withDim(withStateDelta(level.bloom.opacity * boundaryLineOpacity, hover.glowOpacityDelta, active.glowOpacityDelta), MAP_THEME.dimFactor?.glow)),
          'line-blur': zoomScaled(level.bloom.blur, { highScale: 1.25 }),
        }, ['line-width', 'line-opacity', 'line-blur']),
      });
      registerDrillLayer(layerId(level.type, 'bloom'), level.type);
    }

    if (!map.getLayer(layerId(level.type, 'glow'))) {
      map.addLayer({
        id: layerId(level.type, 'glow'), type: 'line', source: SRC_BOUNDARIES,
        filter, layout,
        paint: withTransitions({
          'line-color': level.glowColor || level.color,
          'line-width': zoomScaledWidthWithDelta(level.glowWidth, hover.glowWidthDelta, active.glowWidthDelta, { highScale: 1.3 }),
          'line-opacity': registerLineOpacity(layerId(level.type, 'glow'), () => withDim(withStateDelta(level.glowOpacity * boundaryLineOpacity, hover.glowOpacityDelta, active.glowOpacityDelta), MAP_THEME.dimFactor?.glow)),
          'line-blur': zoomScaled(level.glowBlur, { highScale: 1.2 }),
        }, ['line-width', 'line-opacity', 'line-blur']),
      });
      registerDrillLayer(layerId(level.type, 'glow'), level.type);
    }

    if (!map.getLayer(layerId(level.type, 'core'))) {
      map.addLayer({
        id: layerId(level.type, 'core'), type: 'line', source: SRC_BOUNDARIES,
        filter, layout,
        paint: withTransitions({
          'line-color': level.color,
          'line-width': zoomScaledWidthWithDelta(level.width, hover.widthDelta, active.widthDelta, { highScale: 1.35 }),
          'line-opacity': registerLineOpacity(layerId(level.type, 'core'), () => withDim(withStateDelta(level.opacity * boundaryLineOpacity, hover.opacityDelta, active.opacityDelta), MAP_THEME.dimFactor?.line)),
          ...(level.dashArray ? { 'line-dasharray': level.dashArray } : {}),
        }, ['line-width', 'line-opacity']),
      });
      registerDrillLayer(layerId(level.type, 'core'), level.type);
    }

    if (level.highlight && !map.getLayer(layerId(level.type, 'highlight'))) {
      map.addLayer({
        id: layerId(level.type, 'highlight'), type: 'line', source: SRC_BOUNDARIES,
        filter, layout,
        paint: withTransitions({
          'line-color': level.highlight.color,
          'line-width': zoomScaledWidthWithDelta(level.highlight.width, 0.2, 0.35, { highScale: 1.3 }),
          'line-opacity': registerLineOpacity(layerId(level.type, 'highlight'), () => withDim(withStateDelta(level.highlight.opacity * boundaryLineOpacity, 0.15, 0.2), MAP_THEME.dimFactor?.glow)),
        }, ['line-width', 'line-opacity']),
      });
      registerDrillLayer(layerId(level.type, 'highlight'), level.type);
    }
  }

  // Selected-feature emphasis ring — an extra soft pulse (see
  // MKNexus.MapAnimation.pulseGlow) drawn above every level's own stack so
  // a selection reads clearly without harsh colors or scale animation. One
  // shared layer covering every feature — MapLibre doesn't allow
  // feature-state in a layer `filter` (data expressions like ['get', ...]
  // are fine there, feature-state is paint/layout-only), so "only the
  // active boundary shows" is enforced entirely in the paint properties
  // below (0 for anything not active) instead of at the filter level.
  // This used to be a feature-state filter, which MapLibre silently
  // rejected — the layer never actually existed, so nothing ever pulsed.
  function addSelectionGlowLayer(map) {
    if (map.getLayer('mk-boundary-glow')) return;
    const pulse = MAP_THEME.pulse || {};
    const isActive = ['boolean', ['feature-state', 'active'], false];
    map.addLayer({
      id: 'mk-boundary-glow', type: 'line', source: SRC_BOUNDARIES,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        // Initial values only — MKNexus.MapAnimation.pulseGlow() takes over
        // every paint property here per-frame once a selection is active,
        // and keeps re-wrapping its animated number in the same
        // active-only `case` so non-active features stay at 0.
        'line-color': PALETTE.accentHover || 'rgba(99, 255, 215, 1)',
        'line-width': ['case', isActive, pulse.baseWidthAdd ?? 9, 0],
        'line-opacity': ['case', isActive, pulse.baseOpacity ?? 0.34, 0],
        'line-blur': pulse.baseBlurAdd ?? 14,
      },
    });
  }

  // Traveling light — a soft highlight glides back and forth along the
  // active boundary's own outline (driven per-frame by
  // MKNexus.MapAnimation.sweepActiveBoundary), the "this region just came
  // alive" cue. Needs lineMetrics on the source (see ensureSources) to read
  // ['line-progress']; purely additive — no other layer's line-color is
  // touched. Same feature-state-can't-be-a-filter constraint as the glow
  // layer above — gated via line-opacity instead of `filter`.
  function addSweepLayer(map) {
    if (map.getLayer('mk-boundary-sweep')) return;
    map.addLayer({
      id: 'mk-boundary-sweep', type: 'line', source: SRC_BOUNDARIES,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-width': (MAP_THEME.sweep?.widthAdd ?? 2.5) + 2.5,
        'line-opacity': ['case', ['boolean', ['feature-state', 'active'], false], 1, 0],
        'line-blur': 1.4,
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)'],
      },
    });
  }

  // Builds the two-branch (active / not) text-size case expression from
  // MAP_THEME.levels, so label sizing per level lives entirely in config.
  function labelSizeExpression(sizeKey, fallback) {
    const branches = LEVELS.flatMap((level) => [['==', ['get', 'type'], level.type], level.label?.[sizeKey] ?? fallback]);
    return ['case', ...branches, fallback];
  }

  function addLabelLayers(map) {
    const types = [...LEVELS.map((level) => level.type), 'agricultural-zone'];
    types.forEach((type) => {
      const id = `mk-label-${type}`;
      if (map.getLayer(id)) return;
      map.addLayer({
        id, type: 'symbol', source: SRC_BOUNDARIES,
        minzoom: 0, maxzoom: 24,
        filter: ['==', ['get', 'type'], type],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': [mapLabelFont(), 'Arial Unicode MS Bold', 'sans-serif'],
          // text-size is a *layout* property — MapLibre doesn't allow
          // feature-state there at all (paint-only), unlike text-color/
          // halo below, so the active boundary's name reads bigger purely
          // via LEVELS' own baseSize per type; the "unmistakably selected"
          // emphasis comes entirely from the paint properties below
          // instead (brighter color, thicker/tighter halo, full opacity).
          'text-size': labelSizeExpression('baseSize', 10),
          'text-max-width': 12,
          'text-letter-spacing': 0.06,
          'text-anchor': 'center',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-padding': 8,
        },
        paint: {
          'text-color': ['case', ['boolean', ['feature-state', 'active'], false], '#ffffff', 'rgba(255, 255, 255, 0.76)'],
          'text-halo-color': ['case', ['boolean', ['feature-state', 'active'], false], 'rgba(34, 197, 94, 0.45)', 'rgba(1, 6, 5, 0.92)'],
          'text-halo-width': ['case', ['boolean', ['feature-state', 'active'], false], 3, 1.8],
          'text-halo-blur': ['case', ['boolean', ['feature-state', 'active'], false], 2.2, 0.8],
          // Label opacity by state — see MAP_THEME.labelOpacity (config.js).
          // Even the "dimmed" state stays clearly readable so labels never
          // blend into the imagery.
          'text-opacity': ['case',
            ['boolean', ['feature-state', 'active'], false], MAP_THEME.labelOpacity?.active ?? 1,
            ['boolean', ['feature-state', 'dimmed'], false], MAP_THEME.labelOpacity?.dimmed ?? 0.62,
            MAP_THEME.labelOpacity?.base ?? 0.94,
          ],
          'text-opacity-transition': { duration: 420, delay: 0 },
        },
      });
    });
  }

  function addDraftLayers(map) {
    if (!map.getLayer('mk-draft-fill')) {
      map.addLayer({ id: 'mk-draft-fill', type: 'fill', source: SRC_DRAFT, paint: { 'fill-color': '#52c99b', 'fill-opacity': 0.24 } });
    }
    if (!map.getLayer('mk-draft-line')) {
      map.addLayer({ id: 'mk-draft-line', type: 'line', source: SRC_DRAFT, paint: { 'line-color': '#a8ffe0', 'line-width': 3, 'line-opacity': 0.95, 'line-dasharray': [2, 1.5] } });
    }
    if (!map.getLayer('mk-draft-vertices')) {
      map.addLayer({
        id: 'mk-draft-vertices', type: 'circle', source: SRC_VERTICES,
        paint: {
          'circle-radius': ['case', ['boolean', ['feature-state', 'dragging'], false], 8, ['boolean', ['feature-state', 'hover'], false], 7, 5],
          'circle-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#d9fff1', '#04140f'],
          'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#ffffff', '#52c99b'],
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 2],
        },
      });
    }
  }

  function ensureLayers(map) {
    addFillLayer(map);
    addCasingLayer(map);
    // Bottom-to-top: LEVELS is already ordered least- to most-important
    // (see config.js), so each level's stack naturally sits above the
    // previous one's.
    LEVELS.forEach((level) => buildLevelLayers(map, level));
    addSelectionGlowLayer(map);
    addSweepLayer(map);
    // Ambient breathing on every level that opts in (level.breathe) —
    // subtle, throttled well below frame rate so it stays cheap on large
    // boundary datasets. No-ops if nothing opts in.
    MKNexus.MapAnimation?.startBoundaryBreath?.(map);
    addLabelLayers(map);
    addDraftLayers(map);
    // First paint: only governorates visible (drillState's default) — every
    // administration/district layer just got created with its plain
    // type-only filter, which would show every level at once until this
    // narrows it down.
    applyDrillFilters(map);
  }

  function refreshBoundaries(map) {
    map.getSource(SRC_BOUNDARIES)?.setData(createStyledFeatureCollection());
  }

  function setDraft(map, coordinates) {
    const features = [];
    if (coordinates.length >= 3) {
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }, properties: {} });
    } else if (coordinates.length === 2) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} });
    }
    map.getSource(SRC_DRAFT)?.setData({ type: 'FeatureCollection', features });

    const vertexFeatures = coordinates.map((c, i) => ({
      type: 'Feature', id: i, geometry: { type: 'Point', coordinates: c }, properties: { index: i },
    }));
    map.getSource(SRC_VERTICES)?.setData({ type: 'FeatureCollection', features: vertexFeatures });
    MKNexus.AnimationTicker.register('draft-shimmer', () => {
      const opacity = (0.7 + Math.abs(Math.sin(performance.now() / 420)) * 0.3) * draftLineOpacity;
      if (map.getLayer('mk-draft-line')) map.setPaintProperty('mk-draft-line', 'line-opacity', opacity);
    });
  }

  function setVertexHover(map, index, count = 0) {
    for (let vertexIndex = 0; vertexIndex < count; vertexIndex += 1) {
      map.setFeatureState({ source: SRC_VERTICES, id: vertexIndex }, { hover: vertexIndex === index });
    }
  }

  function setVertexDragging(map, index, count = 0) {
    for (let vertexIndex = 0; vertexIndex < count; vertexIndex += 1) {
      map.setFeatureState({ source: SRC_VERTICES, id: vertexIndex }, { dragging: vertexIndex === index });
    }
  }

  function clearDraft(map) {
    MKNexus.AnimationTicker.unregister('draft-shimmer');
    map.getSource(SRC_DRAFT)?.setData({ type: 'FeatureCollection', features: [] });
    map.getSource(SRC_VERTICES)?.setData({ type: 'FeatureCollection', features: [] });
  }

  // setActive/clearActive/setHover/clearHover only need the *set of
  // boundary ids* to flip a feature-state flag — they don't need the
  // recomputed styled colors that createStyledFeatureCollection()
  // produces. Boundaries.getAll() gives the same ids far more cheaply
  // (no parent-chain color walk), which matters here because setHover
  // runs on every hover transition.
  function setActive(map, boundaryId) {
    if (boundaryId == null) {
      MKNexus.MapAnimation?.stopBoundaryPulse?.();
      MKNexus.MapAnimation?.stopBoundarySweep?.();
    }
    const activeBoundary = boundaryId != null ? MKNexus.Boundaries.getById(boundaryId) : null;
    MKNexus.Boundaries.getAll().forEach((b) => {
      const isActive = b.id === boundaryId;
      map.setFeatureState({ source: SRC_BOUNDARIES, id: b.id }, {
        active: isActive,
        hover: false,
        // Only dim *same-level* siblings of the selection — see
        // withDim() above. Selecting a governorate leaves it "active"
        // while the drill-down reveals its administrations a beat later
        // (geo-state.js); those administrations are a different type
        // from the active boundary, so without the type check here
        // they'd all render pre-dimmed the instant they appear, for no
        // reason (dimming means "not the selection", not "not the same
        // boundary as some other level's selection").
        dimmed: boundaryId != null && !isActive && b.type === activeBoundary?.type,
        visible: true,
      });
    });
  }

  function clearActive(map) {
    MKNexus.MapAnimation?.stopBoundaryPulse?.();
    MKNexus.MapAnimation?.stopBoundarySweep?.();
    MKNexus.Boundaries.getAll().forEach((b) => {
      map.setFeatureState({ source: SRC_BOUNDARIES, id: b.id }, { active: false, hover: false, dimmed: false, visible: true });
    });
  }

  function setHover(map, boundaryId) {
    MKNexus.Boundaries.getAll().forEach((b) => {
      map.setFeatureState({ source: SRC_BOUNDARIES, id: b.id }, { hover: b.id === boundaryId, visible: true });
    });
  }

  function clearHover(map) {
    MKNexus.Boundaries.getAll().forEach((b) => {
      map.setFeatureState({ source: SRC_BOUNDARIES, id: b.id }, { hover: false, visible: true });
    });
  }

  return {
    ensureSources, ensureLayers, refreshBoundaries, setDraft, setVertexHover, setVertexDragging, clearDraft,
    setActive, clearActive, setHover, clearHover, setBoundaryLineOpacity, setDraftLineOpacity, getBoundaryLineOpacity,
    setDrillState,
    SRC_BOUNDARIES, SRC_DRAFT, SRC_VERTICES,
  };
})();
