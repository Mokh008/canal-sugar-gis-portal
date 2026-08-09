/* MK NEXUS — Config: module registry, map defaults, feature flags.
   Single source of truth for shell navigation and (later) the map engine. */
window.MKNexus = window.MKNexus || {};

MKNexus.Config = (function () {
  const MODULES = [
    { id: 'geo',          label: 'Geo Intelligence', icon: 'fa-solid fa-earth-africa', default: true },
    { id: 'operations',   label: 'Operations',        icon: 'fa-solid fa-gears' },
    { id: 'attendance',   label: 'Attendance',        icon: 'fa-solid fa-user-clock' },
    { id: 'expenses',     label: 'Expenses',          icon: 'fa-solid fa-file-invoice-dollar' },
    { id: 'rent',         label: 'Rent',              icon: 'fa-solid fa-house-chimney' },
    { id: 'analytics',    label: 'Analytics',         icon: 'fa-solid fa-chart-line' },
    { id: 'reports',      label: 'Reports',           icon: 'fa-solid fa-file-lines' },
    { id: 'presentation', label: 'Presentation Mode', icon: 'fa-solid fa-display' },
    { id: 'settings',     label: 'Settings',          icon: 'fa-solid fa-gear' },
  ];

  const COMPANY_NAME = 'Canal Sugar';

  // Consumed by the map engine feature — kept here now so router/shell
  // and map.js share one config surface instead of duplicating constants.
  const MAP_DEFAULTS = {
    center: { lat: 28.1099, lng: 30.7503 }, // Minya Governorate
    zoomLevels: { company: 8, administration: 11, district: 13.5, village: 16 },
    // The one-time "establishing shot" on first load and the idle-camera
    // ambience that follows it — see map.js/camera.js. MapLibre's globe
    // projection blends into flat Mercator by itself as zoom increases
    // (no manual mode switch needed); `establishingZoom` just needs to be
    // low enough that the globe is actually visible before easing up to
    // `zoomLevels.company`.
    globe: {
      enabled: true,
      establishingZoom: 1.6,
      idleDriftDegrees: 5,
      idleDriftPeriodMs: 120000,
    },
  };

  const THEME = {
    name: 'Dark Emerald',
    palette: {
      surfacePanel: '#051f19',
      surfacePanelAlt: '#0e2e22',
      surfaceGlass: 'rgba(9, 33, 27, 0.72)',
      surfaceGlassStrong: 'rgba(9, 33, 27, 0.88)',
      accent: '#3a9678',
      accentHover: '#52c99b',
      accentCore: '#cefeee',
      accentSoft: 'rgba(58, 150, 120, 0.16)',
      accentGradient: 'linear-gradient(135deg, #3a9678 0%, #52c99b 100%)',
      glow: 'rgba(58, 150, 120, 0.32)',
      glowCore: 'rgba(206, 254, 238, 0.55)',
      textPrimary: '#f1f5f3',
      textSecondary: '#b9c9c2',
      textMuted: '#86988f',
      lineSoft: 'rgba(120, 180, 155, 0.14)',
      lineStrong: 'rgba(150, 200, 175, 0.24)',
    },
    typography: {
      preset: 'Inter',
      titleFont: 'Space Grotesk, Arial, sans-serif',
      bodyFont: 'Inter, Arial, sans-serif',
      weight: '600',
      letterSpacing: '0em',
      lineHeight: '1.3',
      uppercase: false,
      smallCaps: false,
      presets: {
        Inter: 'Inter, Arial, sans-serif',
        'SF Pro Display': 'SF Pro Display, Arial, sans-serif',
        Outfit: 'Outfit, Arial, sans-serif',
        Manrope: 'Manrope, Arial, sans-serif',
        'Plus Jakarta Sans': 'Plus Jakarta Sans, Arial, sans-serif',
        'Space Grotesk': 'Space Grotesk, Arial, sans-serif',
        'Exo 2': 'Exo 2, Arial, sans-serif',
      },
    },
    layout: {
      sidebarWidth: 'clamp(240px, 17vw, 296px)',
      mapRightRail: 'clamp(300px, 22vw, 360px)',
      kpiWidth: 'min(360px, 28vw)',
      cardSpacing: '14px',
      gridGap: '14px',
      margins: '24px',
      padding: '24px',
      sectionSpacing: '20px',
      headerHeight: '88px',
      widgetHeight: 'auto',
    },
    card: {
      radius: '24px',
      padding: '20px',
      glassOpacity: '0.78',
      blur: '28px',
      border: '1px solid rgba(255,255,255,0.08)',
      innerGlow: '0 0 28px rgba(58,150,120,0.08)',
      outerGlow: '0 30px 90px rgba(0,0,0,0.35)',
      shadow: '0 30px 90px rgba(0,0,0,0.35)',
      hoverLift: '-4px',
      hoverScale: '1.02',
      background: 'linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
    },
    button: {
      radius: '16px',
      glow: '0 0 18px rgba(82,201,155,0.14)',
      background: 'rgba(255,255,255,0.06)',
      hover: 'rgba(82,201,155,0.14)',
      pressed: 'rgba(255,255,255,0.08)',
      iconSize: '18px',
      shadow: '0 18px 34px rgba(0,0,0,0.2)',
    },
    legend: {
      borderSample: '1px solid rgba(255,255,255,0.1)',
      dashed: true,
      solid: true,
      glow: true,
      labelFont: 'var(--font-mono)',
      spacing: '10px',
    },
    minimap: {
      border: '1px solid rgba(255,255,255,0.08)',
      glow: '0 0 20px rgba(82,201,155,0.22)',
      // Was 0.92 — nearly opaque, which defeated the panel's own
      // backdrop-filter blur (nothing showed through to blur). Lower
      // alpha lets the live satellite map behind it read through, blurred.
      background: 'rgba(7, 23, 19, 0.7)',
      radius: '22px',
      opacity: '0.96',
    },
    chart: {
      circleThickness: 6,
      progressColor: 'linear-gradient(90deg, #b8ffd6 0%, #67e0a1 52%, #21c677 100%)',
      trackColor: 'rgba(255,255,255,0.08)',
      glow: true,
      animation: true,
      gradient: true,
    },
    animation: {
      glowPulse: true,
      borderPulse: true,
      neon: true,
      waveGlow: true,
      dashFlow: true,
      hoverScale: true,
      hoverGlow: true,
      selectionFlash: true,
      speed: 'normal',
    },
    map: {
      // =================================================================
      // BOUNDARY RENDER CONFIG — the single source of truth the layer
      // generator (map/layers.js) and the motion ticker (map/animation.js)
      // read from. Nothing below is duplicated in rendering code — every
      // number/color here is the actual value used, so re-tuning the map
      // is always a config-only change. `levels` (further down) is a
      // declarative recipe: reorder/add/remove a hierarchy level, or turn
      // an optional sub-layer (bloom/highlight) on or off for a level,
      // entirely from data — no new rendering code required.
      // =================================================================

      hoverTransitionMs: 240, // paint-property ease duration — no flashing

      // How much a boundary fades once a *different* boundary is selected
      // (0 = invisible, 1 = no fade at all).
      dimFactor: { fill: 0.5, line: 0.58, glow: 0.6 },

      // Label opacity by state — labels never drop low enough to blend
      // into the imagery, even while dimmed.
      labelOpacity: { base: 0.94, dimmed: 0.62, active: 1 },

      // Floor under the zoom-based width/opacity scaling in layers.js's
      // zoomScaled() — keeps every border level visible even fully zoomed
      // out, instead of thinning toward invisibility.
      minZoomScale: 0.92,

      // A dark line drawn beneath every border stack, slightly wider than
      // its core stroke — real "contrast against the map": keeps the
      // colored line legible over both bright sand and dark vegetation in
      // the satellite imagery, independent of hue.
      contrastCasing: { enabled: true, color: 'rgba(1, 8, 6, 0.7)', widthAdd: 3.4 },

      fill: {
        color: 'rgba(120,255,210,0.14)',
        opacity: 0.18,
        hoverOpacity: 0.26,
        selectedOpacity: 0.36,
      },

      // ---- Motion --------------------------------------------------
      // Multiplies every animation's *duration* uniformly. >1 = slower/
      // calmer, <1 = faster/livelier. `pulseStrength` multiplies only the
      // active-selection pulse's *amplitude*, independent of timing.
      animationSpeed: 1,
      pulseStrength: 1,

      // The active-selection "pulse" ring (shared mk-boundary-glow layer,
      // one per map — see animation.js). Each level's `aliveGlowScale`
      // (below) scales this per selection.
      pulse: { periodMs: 4000, baseOpacity: 0.34, opacityAmplitude: 0.26, baseBlurAdd: 14, blurAmplitude: 9, baseWidthAdd: 9, widthAmplitude: 5 },
      // The traveling light that glides along the active boundary's outline.
      sweep: { periodMs: 5400, bandHalfWidth: 0.14, widthAdd: 2.5 },
      // Ambient "breathing" halo — opt-in per level via `level.breathe`.
      breathe: { baseOpacity: 0.09, opacityAmplitude: 0.12, baseWidthAdd: 1, widthAmplitude: 3 },

      // ---- Hierarchy levels -----------------------------------------
      // Rendered bottom-to-top in this order, so later entries sit above
      // earlier ones. Each level always gets: casing (if contrastCasing is
      // enabled) → glow → core stroke → label. `bloom` and `highlight` are
      // optional extra layers — include them for a richer top-of-hierarchy
      // treatment, omit them for a lighter one; the generator only builds
      // the sub-layers a level actually defines.
      levels: [
        {
          type: 'district',
          color: 'rgba(200,255,243,1)',
          opacity: 0.9,
          width: 3,
          glowColor: 'rgba(99,255,215,1)',
          glowWidth: 6,
          glowOpacity: 0.5,
          glowBlur: 6,
          bloom: { width: 10, opacity: 0.3, blur: 12 },
          highlight: { color: 'rgba(255,255,255,1)', width: 1, opacity: 0.6 },
          breathe: { duration: 6000 },
          hover: { widthDelta: 0.4, opacityDelta: 0.18, glowWidthDelta: 0.5, glowOpacityDelta: 0.14 },
          active: { widthDelta: 0.7, opacityDelta: 0.14, glowWidthDelta: 0.9, glowOpacityDelta: 0.16 },
          aliveGlowScale: 0.5,
          label: { baseSize: 10, activeSize: 12 },
          join: 'round',
          cap: 'round',
        },
        {
          type: 'administration',
          color: 'rgba(150,255,235,1)',
          opacity: 0.96,
          width: 3.6,
          glowColor: 'rgba(99,255,215,1)',
          glowWidth: 8,
          glowOpacity: 0.58,
          glowBlur: 7.5,
          dashArray: [8, 4],
          bloom: { width: 14, opacity: 0.34, blur: 15 },
          highlight: { color: 'rgba(255,255,255,1)', width: 1.4, opacity: 0.75 },
          breathe: { duration: 6500 },
          hover: { widthDelta: 0.5, opacityDelta: 0.16, glowWidthDelta: 0.7, glowOpacityDelta: 0.14 },
          active: { widthDelta: 0.9, opacityDelta: 0.1, glowWidthDelta: 1.2, glowOpacityDelta: 0.16 },
          aliveGlowScale: 0.68,
          label: { baseSize: 11, activeSize: 13 },
          join: 'round',
          cap: 'round',
        },
        {
          // Premium teal family — #63FFD7 (glow) / #8FFFF0 (core) — bright
          // enough to read as a lit neon tube against any satellite terrain.
          // Top of the hierarchy: the only level with an outer bloom, an
          // inner highlight, and ambient breathing.
          type: 'governorate-group',
          color: 'rgba(143,255,240,1)',
          opacity: 1,
          width: 4.6,
          glowColor: 'rgba(99,255,215,1)',
          glowWidth: 11,
          glowOpacity: 0.8,
          glowBlur: 9,
          bloom: { width: 18, opacity: 0.42, blur: 20 },
          highlight: { color: 'rgba(255,255,255,1)', width: 2, opacity: 0.9 },
          breathe: { duration: 7000 },
          hover: { widthDelta: 0.8, opacityDelta: 0.1, glowWidthDelta: 1.1, glowOpacityDelta: 0.12 },
          active: { widthDelta: 1.4, opacityDelta: 0.02, glowWidthDelta: 1.8, glowOpacityDelta: 0.14 },
          aliveGlowScale: 1,
          label: { baseSize: 14, activeSize: 16 },
          join: 'round',
          cap: 'round',
        },
      ],
    },
  };

  function applyTheme(theme) {
    const root = document.documentElement;
    const vars = {
      '--sidebar-width': theme.layout.sidebarWidth,
      '--header-height': theme.layout.headerHeight,
      '--layout-padding': theme.layout.padding,
      '--layout-margin': theme.layout.margins,
      '--layout-gap': theme.layout.sectionSpacing,
      '--panel-radius': theme.card.radius,
      '--panel-padding': theme.card.padding,
      '--panel-glass-opacity': theme.card.glassOpacity,
      '--panel-blur': theme.card.blur,
      '--panel-border': theme.card.border,
      '--panel-bg': theme.card.background,
      '--panel-shadow': theme.card.shadow,
      '--panel-inner-glow': theme.card.innerGlow,
      '--panel-outer-glow': theme.card.outerGlow,
      '--card-radius': theme.card.radius,
      '--card-padding': theme.card.padding,
      '--card-gap': theme.layout.gridGap,
      '--card-bg': theme.card.background,
      '--card-border': theme.card.border,
      '--card-shadow': theme.card.shadow,
      '--card-hover-lift': theme.card.hoverLift,
      '--button-radius': theme.button.radius,
      '--button-bg': theme.button.background,
      '--button-hover-bg': theme.button.hover,
      '--button-pressed-bg': theme.button.pressed,
      '--button-shadow': theme.button.shadow,
      '--button-icon-size': theme.button.iconSize,
      '--legend-border': theme.legend.borderSample,
      '--legend-gap': theme.legend.spacing,
      '--legend-glow': theme.legend.glow ? '0 0 20px rgba(82,201,155,0.18)' : 'none',
      '--minimap-bg': theme.minimap.background,
      '--minimap-border': theme.minimap.border,
      '--minimap-radius': theme.minimap.radius,
      '--minimap-opacity': theme.minimap.opacity,
      '--geo-right-rail': theme.layout.mapRightRail,
      '--geo-kpi-width': theme.layout.kpiWidth,
      '--font-display': theme.typography.titleFont,
      '--font-body': theme.typography.bodyFont,
      '--font-title': theme.typography.titleFont,
      '--font-weight-global': theme.typography.weight,
      '--font-letter-spacing': theme.typography.letterSpacing,
      '--font-line-height': theme.typography.lineHeight,
      '--text-transform-global': theme.typography.uppercase ? 'uppercase' : 'none',
      '--font-variant-global': theme.typography.smallCaps ? 'small-caps' : 'normal',
      '--accent': theme.palette.accent,
      '--accent-hover': theme.palette.accentHover,
      '--accent-core': theme.palette.accentCore,
      '--accent-soft': theme.palette.accentSoft,
      '--accent-gradient': theme.palette.accentGradient,
      '--glow': theme.palette.glow,
      '--glow-core': theme.palette.glowCore,
      '--text-primary': theme.palette.textPrimary,
      '--text-secondary': theme.palette.textSecondary,
      '--text-muted': theme.palette.textMuted,
      '--line-soft': theme.palette.lineSoft,
      '--line-strong': theme.palette.lineStrong,
      '--surface-panel': theme.palette.surfacePanel,
      '--surface-panel-alt': theme.palette.surfacePanelAlt,
      '--surface-glass': theme.palette.surfaceGlass,
      '--surface-glass-strong': theme.palette.surfaceGlassStrong,
      '--progress-gradient': theme.chart.progressColor,
    };

    Object.entries(vars).forEach(([name, value]) => {
      if (value != null) root.style.setProperty(name, value);
    });
  }

  applyTheme(THEME);
  window.MKNexus.Theme = THEME;

  return { MODULES, COMPANY_NAME, MAP_DEFAULTS, THEME };
})();