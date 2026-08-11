window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Geo module: registers 'geo' with the Router. The map
   container DOM node is built once and kept alive in memory — router
   clears the shell's content div on every navigate, so the node is
   detached/reattached rather than recreated, keeping the MapLibre
   instance (bound permanently to that node) valid across navigation.

   This is the executive-presentation UI layer: it owns the command deck,
   KPI cards, legend, minimap, and presentation-mode chrome, and reacts to
   selection via MKNexus.GeoState's 'settle'/'clear' events instead of
   being driven ad hoc by editor.js or camera.js — neither of those two
   modules knows this file exists. Data flow (MKNexus.Boundaries,
   MKNexus.KPI, MKNexus.ApiClient) is untouched. */
MKNexus.GeoModule = (function () {
  const esc = MKNexus.Utils.escapeHtml;
  let initialized = false;
  let mapContainerEl = null;
  let deckBound = false;
  let presentationBound = false;
  let resizeBound = false;
  let selectionRequestId = 0;

  function buildContainerOnce() {
    if (mapContainerEl) return mapContainerEl;
    mapContainerEl = document.createElement('div');
    mapContainerEl.className = 'geo-module';
    mapContainerEl.innerHTML = `
      <div id="mkMapContainer" class="geo-module__map"></div>
      <div class="geo-module__vignette" aria-hidden="true"></div>

      <section class="geo-command-deck" aria-label="Executive geo intelligence">
        <div class="geo-command-deck__eyebrow"><span class="geo-live-dot"></span> LIVE GEO INTELLIGENCE</div>
        <h1 class="geo-command-deck__title" id="geoSelectionName">Canal Sugar Operations</h1>
        <p class="geo-command-deck__subtitle" id="geoSelectionMeta">Egypt / Minya Governorate / Administration view</p>
        <div class="geo-kpi-grid" id="geoKpiGrid"></div>

        <!-- BUG FIX: confirmed live — Legend/Minimap used to float
             independently at a fixed screen corner (bottom-right, then
             bottom-left), competing for space with whichever *other*
             floating panel also anchors near that corner (the GIS Editor
             toolbar/panel on the right, this deck itself on the left —
             its own KPI content alone already needs to scroll internally
             on a normal screen, so there's no free space near it at any
             corner). Folding them into the deck's own scroll area instead
             of a separate absolutely-positioned box removes that entire
             category of "two floating things landed in the same spot" —
             they now scroll along with the KPI cards, guaranteed never to
             sit on top of anything else, on any screen. -->
        <div class="geo-command-deck__extras">
          <div class="geo-legend" aria-label="Boundary legend">
            <span class="geo-legend__title">Map Legend</span>
            <div class="geo-legend__item"><span class="geo-legend__swatch geo-legend__swatch--governorate"></span>Governorate</div>
            <div class="geo-legend__item"><span class="geo-legend__swatch geo-legend__swatch--administration"></span>Administration</div>
            <div class="geo-legend__item"><span class="geo-legend__swatch geo-legend__swatch--district"></span>District</div>
            <div class="geo-legend__opacity">
              <label for="geoLineOpacity"><i class="fa-solid fa-slash"></i> Line visibility</label>
              <input type="range" id="geoLineOpacity" min="0" max="100" value="100" step="1" aria-label="Boundary line opacity">
            </div>
          </div>

          <div class="geo-minimap" aria-label="Selected region minimap">
            <div class="geo-minimap__frame"><div class="geo-minimap__marker" id="geoMinimapMarker"></div></div>
            <div class="geo-minimap__meta">
              <span class="geo-minimap__label">Current selection</span>
              <span class="geo-minimap__name" id="geoMinimapName">Canal Sugar</span>
            </div>
          </div>
        </div>
      </section>

      <div class="geo-map-status"><span id="geoMapStatus">SATELLITE SIMULATION</span><span class="geo-map-status__sep">/</span><span id="geoCoordReadout">28.1099&deg; N 30.7503&deg; E</span></div>

      <div class="geo-command-actions" aria-label="Map presentation controls">
        <button class="geo-command-btn" id="geoResetBtn" type="button" title="Reset camera"><i class="fa-solid fa-crosshairs"></i><span>Reset view</span></button>
        <button class="geo-command-btn" id="geoStoryBtn" type="button" title="Play executive story"><i class="fa-solid fa-layer-group"></i><span>Story mode</span></button>
        <button class="geo-command-btn" id="geoPresentationBtn" type="button" title="Toggle presentation mode"><i class="fa-solid fa-house"></i><span>Presentation</span></button>
        <button class="geo-command-btn" id="geoZoomInBtn" type="button" title="Zoom in"><i class="fa-solid fa-plus"></i><span>Zoom in</span></button>
        <button class="geo-command-btn" id="geoZoomOutBtn" type="button" title="Zoom out"><i class="fa-solid fa-minus"></i><span>Zoom out</span></button>
      </div>

      <button class="geo-presentation-exit" id="geoPresentationExit" type="button"><i class="fa-solid fa-compress"></i><span>Exit presentation</span></button>`;
    return mapContainerEl;
  }

  function formatKpi(value, decimals = 0) {
    if (value === undefined || value === null || value === '') return '—';
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '—';
    return numericValue.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  }

  /* ---------------------------------------------------------------
     Card renderers — each returns a markup string for one KPI card.
     Kept separate from the layout order below so the row grouping
     (hero / achievement / pair / pair / pair) matches the reference
     without touching how the data itself is sourced or computed.
  --------------------------------------------------------------- */
  function heroCard(kpi) {
    const numeric = Number(kpi.beetTons);
    const hasValue = Number.isFinite(numeric);
    return `<article class="geo-kpi geo-kpi--hero" data-kpi-card="beetTons">
      <div class="geo-kpi__top">
        <span class="geo-kpi__label" style="margin-top:0">Beet Tons</span>
        <span class="geo-kpi__icon"><i class="fa-solid fa-leaf"></i></span>
      </div>
      <strong class="geo-kpi__value"${hasValue ? ` data-count-to="${numeric}" data-decimals="0"` : ''}>${hasValue ? formatKpi(numeric, 0) : '—'}</strong>
      <span class="geo-kpi__unit">TON</span>
    </article>`;
  }

  function achievementCard(kpi) {
    const numeric = Number(kpi.achievement);
    const hasValue = Number.isFinite(numeric);
    const pct = hasValue ? Math.max(0, Math.min(100, numeric)) : 0;
    const radius = 30;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - pct / 100);
    return `<article class="geo-kpi geo-kpi--achievement" data-kpi-card="achievement">
      <span class="geo-kpi__label" style="margin-top:0">Achievement</span>
      <div class="geo-kpi__body">
        <div class="geo-kpi__ring">
          <svg viewBox="0 0 76 76">
            <circle class="geo-kpi__ring-track" cx="38" cy="38" r="${radius}"></circle>
            <circle class="geo-kpi__ring-progress" cx="38" cy="38" r="${radius}"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${hasValue ? offset : circumference}"
              data-ring-to="${offset}"></circle>
          </svg>
          <span class="geo-kpi__ring-label">${hasValue ? formatKpi(numeric, 1) : '—'}%</span>
        </div>
        <div class="geo-kpi__bar-track"><div class="geo-kpi__bar-fill" style="width:${pct}%"></div></div>
      </div>
    </article>`;
  }

  function metricCard({ key, label, value, decimals = 0, unitLabel = '', icon, unitCompact = false }) {
    const numeric = Number(value);
    const hasValue = Number.isFinite(numeric);
    return `<article class="geo-kpi" data-kpi-card="${key}">
      <span class="geo-kpi__icon"><i class="${icon}"></i></span>
      <span class="geo-kpi__label">${label}</span>
      <div class="geo-kpi__value-wrap">
        <strong class="geo-kpi__value"${hasValue ? ` data-count-to="${numeric}" data-decimals="${decimals}"` : ''}>${hasValue ? formatKpi(numeric, decimals) : '—'}</strong>
        ${unitLabel ? `<span class="geo-kpi__unit${unitCompact ? ' geo-kpi__unit--small' : ''}">${unitLabel}</span>` : ''}
      </div>
    </article>`;
  }

  function kpiCards(kpi) {
    if (!kpi) return '<p class="geo-kpi-panel__empty">KPI data is unavailable for this region.</p>';
    const lastUpdated = kpi.lastUpdated || kpi.updatedAt || kpi.LastUpdated
      ? new Date(kpi.lastUpdated || kpi.updatedAt || kpi.LastUpdated).toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : new Date().toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

    return `
      ${heroCard(kpi)}
      ${achievementCard(kpi)}
      <div class="geo-kpi-row">
        ${metricCard({ key: 'originalPlan', label: 'Original Plan', value: kpi.originalPlan, decimals: 0, unitLabel: 'TON', icon: 'fa-solid fa-chart-line' })}
        ${metricCard({ key: 'truckCount', label: 'Truck Count', value: kpi.truckCount, decimals: 0, unitLabel: 'TRUCKS', icon: 'fa-solid fa-truck-fast' })}
      </div>
      <div class="geo-kpi-row">
        ${metricCard({ key: 'shippingAverage', label: 'Shipping Average', value: kpi.shippingAverage, decimals: 2, unitLabel: 'TON / TRUCK', unitCompact: true, icon: 'fa-solid fa-ship' })}
        ${metricCard({ key: 'sugarPercent', label: 'Sugar %', value: kpi.sugarPercent, decimals: 2, unitLabel: '%', icon: 'fa-solid fa-cubes-stacked' })}
      </div>
      <div class="geo-kpi-row">
        ${metricCard({ key: 'area', label: 'Area', value: kpi.area, decimals: 2, unitLabel: 'FEDDAN', icon: 'fa-solid fa-draw-polygon' })}
        ${metricCard({ key: 'tarePercent', label: 'Tare %', value: kpi.tarePercent, decimals: 2, unitLabel: '%', icon: 'fa-solid fa-weight-hanging' })}
      </div>
      <div class="geo-kpi-footer">
        <span>Last Updated: ${lastUpdated} <button type="button" id="geoKpiRefreshBtn" title="Refresh"><i class="fa-solid fa-arrows-rotate"></i></button></span>
      </div>`;
  }

  // The deck's own `deck-arrive` CSS animation (geo-experience.css) only
  // ever plays once, on first mount — without this, swapping in a new
  // selection's content would be an instant cut. Every subsequent
  // selection gets a small fade + slide + blur-out/in re-entrance instead,
  // fired once the camera has actually settled (see the GeoState
  // subscription in bindDeck()) — this is the "panel slides in after the
  // camera arrives" beat from the brief.
  function animateDeckEntrance(deckEl) {
    if (!deckEl || typeof gsap === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(deckEl,
      { opacity: 0, y: 10, filter: 'blur(6px)' },
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.45, ease: 'power2.out' }
    );
  }

  function animateKpiCards(container) {
    container.querySelectorAll('[data-count-to]').forEach((element) => {
      element.classList.remove('is-updating');
      void element.offsetWidth;
      element.classList.add('is-updating');
      MKNexus.MapAnimation.countUp(element, {
        to: Number(element.dataset.countTo),
        decimals: Number(element.dataset.decimals),
        duration: 0.9,
      });
    });
    container.querySelectorAll('[data-ring-to]').forEach((circle) => {
      const to = Number(circle.dataset.ringTo);
      const from = circle.getAttribute('stroke-dasharray');
      circle.style.strokeDashoffset = from;
      requestAnimationFrame(() => { circle.style.strokeDashoffset = to; });
    });
  }

  // Clickable breadcrumb: every ancestor is a way *back up* the drill —
  // clicking "Minia" while three levels deep in one of its districts
  // re-selects Minia itself, which (via GeoState's nextDrillFor) reveals
  // its administrations again. Only the current boundary (last crumb)
  // is plain text — you're already looking at it.
  function hierarchyPathHtml(boundary) {
    const chain = [];
    let current = boundary;
    while (current) {
      chain.unshift(current);
      current = current.parentId ? MKNexus.Boundaries.getById(current.parentId) : null;
    }
    const crumbs = ['<button type="button" class="geo-breadcrumb-link" data-crumb="root">Canal Sugar</button>'];
    chain.forEach((b, index) => {
      const isLast = index === chain.length - 1;
      crumbs.push(isLast
        ? `<span class="geo-breadcrumb-current">${esc(b.name)}</span>`
        : `<button type="button" class="geo-breadcrumb-link" data-crumb="${esc(b.id)}">${esc(b.name)}</button>`);
    });
    return crumbs.join(' <span class="geo-breadcrumb-sep">/</span> ');
  }

  function updateMinimap(boundary) {
    const marker = mapContainerEl?.querySelector('#geoMinimapMarker');
    const name = mapContainerEl?.querySelector('#geoMinimapName');
    if (!marker || !name) return;
    marker.classList.toggle('is-active', Boolean(boundary));
    name.textContent = boundary?.name || 'Canal Sugar';
  }

  // The status-bar coordinate readout used to be a permanently hardcoded
  // string that never changed regardless of selection — it read as a live
  // telemetry feed but wasn't one. Now it reflects the selected boundary's
  // actual centroid (falling back to the platform's configured map center
  // when nothing is selected), computed once per selection rather than
  // continuously — a real value, even if not a per-frame live camera feed.
  function formatCoordReadout(lat, lng) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lngDir = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}° ${latDir} ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
  }

  function updateCoordReadout(boundary) {
    const el = mapContainerEl?.querySelector('#geoCoordReadout');
    if (!el) return;
    const center = boundary?.center;
    const lat = Array.isArray(center) ? Number(center[1]) : Number(center?.lat);
    const lng = Array.isArray(center) ? Number(center[0]) : Number(center?.lng);
    const fallback = MKNexus.Config.MAP_DEFAULTS.center;
    el.textContent = formatCoordReadout(
      Number.isFinite(lat) ? lat : fallback.lat,
      Number.isFinite(lng) ? lng : fallback.lng
    );
  }

  async function updateDeck(boundary) {
    if (!mapContainerEl) return;
    const requestId = ++selectionRequestId;
    const title = mapContainerEl.querySelector('#geoSelectionName');
    const meta = mapContainerEl.querySelector('#geoSelectionMeta');
    const grid = mapContainerEl.querySelector('#geoKpiGrid');
    if (!boundary) {
      title.textContent = 'Canal Sugar Operations';
      meta.textContent = 'Egypt / Governorates view';
      grid.innerHTML = '<p class="geo-kpi-panel__empty">Select a governorate to inspect its operating picture.</p>';
      updateMinimap(null);
      updateCoordReadout(null);
      return;
    }
    const kpi = await MKNexus.KPI.getForBoundaryAsync(boundary.id);
    if (requestId !== selectionRequestId) return;
    title.textContent = boundary.name;
    meta.innerHTML = hierarchyPathHtml(boundary);
    updateMinimap(boundary);
    updateCoordReadout(boundary);
    grid.innerHTML = kpiCards(kpi);
    animateDeckEntrance(mapContainerEl.querySelector('.geo-command-deck'));
    if (kpi) animateKpiCards(grid);
  }

  function setPresentation(active) {
    document.getElementById('app-shell')?.classList.toggle('is-presentation', active);
    mapContainerEl?.classList.toggle('is-presentation', active);
  }

  function bindPresentationKeys() {
    if (presentationBound) return;
    presentationBound = true;
    document.addEventListener('keydown', (event) => {
      // Same fix as editor.js's keydown listener: without this, pressing
      // "P" on any other module (Rent, Expenses, ...) once Geo had been
      // visited would still toggle presentation mode app-wide.
      if (MKNexus.Router.current() !== 'geo') return;
      if (event.key === 'Escape' && mapContainerEl?.classList.contains('is-presentation')) setPresentation(false);
      if (event.key.toLowerCase() === 'p' && !event.target.matches('input, textarea, select')) setPresentation(!mapContainerEl?.classList.contains('is-presentation'));
    });
  }

  function bindDeck() {
    if (deckBound) return;
    deckBound = true;
    bindPresentationKeys();

    // The KPI deck reacts to selection purely through GeoState — neither
    // editor.js nor camera.js calls into this module directly anymore.
    // 'settle' fires once the camera has actually stopped moving (see
    // geo-state.js), which is what makes the panel/numbers wait for the
    // camera per the brief.
    MKNexus.GeoState.on('settle', (boundary) => updateDeck(boundary));
    MKNexus.GeoState.on('clear', () => updateDeck(null));

    mapContainerEl.querySelector('#geoResetBtn').addEventListener('click', () => {
      MKNexus.Camera.reset();
      MKNexus.GeoState.goToOverview();
    });
    mapContainerEl.querySelector('#geoPresentationBtn').addEventListener('click', () => setPresentation(!mapContainerEl.classList.contains('is-presentation')));
    mapContainerEl.querySelector('#geoPresentationExit').addEventListener('click', () => setPresentation(false));
    mapContainerEl.querySelector('#geoZoomInBtn').addEventListener('click', () => MKNexus.MapEngine.getMap()?.zoomIn({ duration: 400 }));
    mapContainerEl.querySelector('#geoZoomOutBtn').addEventListener('click', () => MKNexus.MapEngine.getMap()?.zoomOut({ duration: 400 }));
    mapContainerEl.querySelector('#geoLineOpacity').addEventListener('input', (event) => {
      MKNexus.Layers.setBoundaryLineOpacity(MKNexus.MapEngine.getMap(), Number(event.target.value) / 100);
    });
    mapContainerEl.querySelector('#geoStoryBtn').addEventListener('click', (event) => {
      // Governorates only: each GeoState.select() inside playStory() now
      // also drives the drill-down (see geo-state.js), which hides every
      // level except the selected one's children — flying/orbiting through
      // a mix of governorates, administrations, and districts would mean
      // orbiting several stops around a boundary that isn't even visible
      // at that moment. The top-level tour is also the one that actually
      // reads as an executive "here are our regions" story.
      const stops = MKNexus.Boundaries.getAll()
        .filter((boundary) => boundary.type === 'governorate-group' && boundary.geometry)
        .map((boundary) => ({ boundary, title: boundary.name }));
      if (!stops.length) return;
      const storyButton = event.currentTarget;
      storyButton.classList.add('is-playing');
      MKNexus.Camera.playStory(stops, () => storyButton.classList.remove('is-playing'));
    });
    // Refresh button and breadcrumb links both live inside the
    // dynamically-rendered deck, so bind via delegation rather than a
    // direct reference.
    mapContainerEl.addEventListener('click', (event) => {
      if (event.target.closest('#geoKpiRefreshBtn')) {
        const current = MKNexus.GeoState.getSelectedId();
        if (current) updateDeck(MKNexus.Boundaries.getById(current));
        return;
      }
      const crumb = event.target.closest('[data-crumb]');
      if (crumb) {
        if (crumb.dataset.crumb === 'root') MKNexus.GeoState.goToOverview();
        else MKNexus.GISEditor.selectBoundary(crumb.dataset.crumb);
      }
    });
  }

  function bindMapResize() {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener('resize', () => requestAnimationFrame(() => MKNexus.MapEngine.getMap()?.resize()));
  }

  function mount(container) {
    buildContainerOnce();
    container.classList.add('shell-content--flush');
    container.innerHTML = '';
    container.appendChild(mapContainerEl);
    setPresentation(false);
    bindDeck();
    bindMapResize();

    if (!initialized) {
      initialized = true;
      MKNexus.MapEngine.init('mkMapContainer', {
        onLoad: async (map) => {
          await MKNexus.Boundaries.hydrate();
          MKNexus.Layers.ensureSources(map);
          MKNexus.Layers.ensureLayers(map);
          MKNexus.GISEditor.init(map);
          MKNexus.GISEditorUI.render(mapContainerEl);
          MKNexus.GISEditorUI.setEditMode(MKNexus.GISEditor.isEditMode());
          MKNexus.Layers.clearActive(map);
          updateDeck(null);
        },
      });
    } else {
      requestAnimationFrame(() => MKNexus.MapEngine.getMap()?.resize());
      MKNexus.GISEditorUI.refreshList();
    }
  }

  function unmount() {
    // mapContainerEl intentionally kept alive — see header note.
  }

  return { mount, unmount, updateSelection: updateDeck, setPresentation };
})();
