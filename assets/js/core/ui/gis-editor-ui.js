window.MKNexus = window.MKNexus || {};

MKNexus.GISEditorUI = (function () {
  let rootEl = null;
  let modalEl = null;
  const TYPE_LABELS = { 'governorate-group': 'Governorate', administration: 'Administration', district: 'District' };
  const typeLabel = (type) => TYPE_LABELS[type] || type;
  const esc = MKNexus.Utils.escapeHtml;

  // boundary.metadata.color is backend-sourced and lands directly in a
  // `style="background:..."` attribute below — validate it's an actual
  // color value first, or a `"><img src=x onerror=...>`-style payload in
  // that field breaks out of the attribute and executes.
  const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
  function safeColor(value) {
    const trimmed = String(value || '').trim();
    return SAFE_COLOR_RE.test(trimmed) ? trimmed : null;
  }

  function render(container) {
    if (rootEl) return;
    rootEl = document.createElement('div');
    rootEl.className = 'gis-editor';
    rootEl.innerHTML = `
      <div class="gis-editor__status" id="gisEditorStatus"></div>
      <div class="gis-editor__toolbar">
        <div class="gis-editor__drag-handle" data-drag="toolbar">
          <i class="fa-solid fa-grip-lines"></i>
          <span class="gis-editor__toolbar-title type-caption">GIS EDITOR</span>
          <button class="gis-editor__reset-btn" data-reset="toolbar" type="button" title="Reset position &amp; size"><i class="fa-solid fa-arrows-rotate"></i></button>
        </div>
        <button class="gis-editor__btn gis-editor__btn--mode is-active" data-action="toggle-mode" type="button"><i class="fa-solid fa-pen-ruler"></i><span>Edit mode</span></button>
        <div class="gis-editor__divider"></div>
        <button class="gis-editor__btn" data-draw="governorate-group" type="button"><i class="fa-solid fa-layer-group"></i><span>Governorate</span></button>
        <button class="gis-editor__btn" data-draw="administration" type="button"><i class="fa-solid fa-draw-polygon"></i><span>Administration</span></button>
        <button class="gis-editor__btn" data-draw="district" type="button"><i class="fa-solid fa-draw-polygon"></i><span>District</span></button>
        <div class="gis-editor__divider"></div>
        <div class="gis-editor__opacity">
          <label for="gisDraftOpacity"><i class="fa-solid fa-slash"></i> Draft line</label>
          <input type="range" id="gisDraftOpacity" min="0" max="100" value="100" step="1" aria-label="Draft line opacity">
        </div>
        <div class="gis-editor__divider"></div>
        <button class="gis-editor__btn" data-action="undo" type="button" title="Undo"><i class="fa-solid fa-rotate-left"></i><span>Undo</span></button>
        <button class="gis-editor__btn" data-action="redo" type="button" title="Redo"><i class="fa-solid fa-rotate-right"></i><span>Redo</span></button>
        <button class="gis-editor__btn" data-action="insert-vertex" type="button" title="Insert vertex"><i class="fa-solid fa-plus"></i><span>Insert Vertex</span></button>
        <button class="gis-editor__btn" data-action="delete-vertex" type="button" title="Delete selected vertex"><i class="fa-solid fa-minus"></i><span>Delete Vertex</span></button>
        <button class="gis-editor__btn" data-action="save" type="button" title="Save"><i class="fa-solid fa-floppy-disk"></i><span>Save</span></button>
        <button class="gis-editor__btn gis-editor__btn--ghost" data-action="cancel" type="button"><i class="fa-solid fa-xmark"></i><span>Cancel</span></button>
      </div>
      <div class="gis-editor__panel">
        <div class="gis-editor__panel-header" data-drag="panel">
          <span class="gis-editor__drag-grip"><i class="fa-solid fa-grip-lines"></i><span class="type-caption">BACKEND BOUNDARIES</span></span>
          <span class="gis-editor__panel-header-right"><span class="gis-editor__count" id="gisEditorCount">0</span><button class="gis-editor__reset-btn" data-reset="panel" type="button" title="Reset position &amp; size"><i class="fa-solid fa-arrows-rotate"></i></button></span>
        </div>
        <ul class="gis-editor__list" id="gisEditorList"></ul>
      </div>`;
    container.appendChild(rootEl);
    rootEl.querySelectorAll('[data-draw]').forEach((button) => button.addEventListener('click', () => openEntitySelector(button.dataset.draw)));
    rootEl.querySelector('#gisDraftOpacity').addEventListener('input', (event) => MKNexus.GISEditor.setDraftLineOpacity(Number(event.target.value) / 100));
    rootEl.querySelector('[data-action="toggle-mode"]').addEventListener('click', () => MKNexus.GISEditor.toggleEditMode());
    rootEl.querySelector('[data-action="undo"]').addEventListener('click', () => MKNexus.GISEditor.undo());
    rootEl.querySelector('[data-action="redo"]').addEventListener('click', () => MKNexus.GISEditor.redo());
    rootEl.querySelector('[data-action="insert-vertex"]').addEventListener('click', () => setToolbarMode('editing', 'Select a polygon, then click its edge to insert a vertex.'));
    rootEl.querySelector('[data-action="delete-vertex"]').addEventListener('click', () => MKNexus.GISEditor.deleteVertex());
    rootEl.querySelector('[data-action="save"]').addEventListener('click', () => MKNexus.GISEditor.finishEditing());
    rootEl.querySelector('[data-action="cancel"]').addEventListener('click', () => MKNexus.GISEditor.cancelCurrent());
    buildModal();
    refreshList();
    setToolbarMode('idle');
    initFloatingPanels();
  }

  // ---- Free-floating toolbar/panel: drag by the header, resize from the
  // corner (native CSS `resize`), position+size persisted per-browser so
  // the layout the user settles on survives a reload. -----------------
  // Bumped to v2: the Legend/Minimap moved off the right edge and the
  // panel's default sizing changed (geo-experience.css/geo-module.css) —
  // any position saved under v1 was tuned against the old, colliding
  // layout, so it's dropped rather than replayed against the new one.
  const FLOAT_STORAGE_KEY = 'mknexus_gis_panel_layout_v2';

  // Every panel setupFloatPanel() has wired, so a single resize listener
  // (below) can re-clamp all of them against whatever screen the page is
  // *currently* on — see the BUG FIX comment inside setupFloatPanel for
  // why this is needed at all.
  const floatPanels = [];

  function loadFloatLayout() {
    try { return JSON.parse(localStorage.getItem(FLOAT_STORAGE_KEY) || '{}'); } catch { return {}; }
  }
  function saveFloatLayout(layout) {
    try { localStorage.setItem(FLOAT_STORAGE_KEY, JSON.stringify(layout)); } catch { /* storage unavailable — layout just won't persist */ }
  }

  // Fits a desired left/top/width/height inside panelEl's actual current
  // container (offsetParent — .gis-editor, itself inset:0 over .geo-module)
  // instead of trusting the numbers verbatim. width/height null means
  // "leave it at whatever it already is" (panelEl.offsetWidth/Height),
  // matching setupFloatPanel's existing "only touch what was saved" rule.
  function clampFloatRect(panelEl, left, top, width, height) {
    const parent = panelEl.offsetParent;
    const parentWidth = parent?.clientWidth || window.innerWidth;
    const parentHeight = parent?.clientHeight || window.innerHeight;
    const clampedWidth = width ? Math.min(width, Math.max(0, parentWidth - 48)) : null;
    const clampedHeight = height ? Math.min(height, Math.max(0, parentHeight - 48)) : null;
    const maxLeft = Math.max(0, parentWidth - (clampedWidth || panelEl.offsetWidth));
    const maxTop = Math.max(0, parentHeight - (clampedHeight || panelEl.offsetHeight));
    return {
      left: Math.max(0, Math.min(maxLeft, left)),
      top: Math.max(0, Math.min(maxTop, top)),
      width: clampedWidth,
      height: clampedHeight,
    };
  }

  function setupFloatPanel(panelEl, handleEl, key) {
    if (!panelEl || !handleEl) return;
    floatPanels.push({ panelEl, key });
    const saved = loadFloatLayout()[key];
    if (saved) {
      // BUG FIX: confirmed live — these were applied as raw saved pixels
      // with zero clamping against the screen actually rendering them. A
      // position/size settled on one monitor (say a 1366px-wide laptop)
      // replayed verbatim on a bigger desktop/projector screen (or just a
      // narrower browser window) could land a panel overlapping the KPI
      // deck, past the visible edge, or taller than the map itself —
      // exactly "كل حاجة فوق بعض", and only on *some* screens, because the
      // saved numbers were never revalidated against whichever viewport
      // loaded them. The drag handler just below already had this same
      // clamp for live mouse movement (maxLeft/maxTop) — restoring a saved
      // layout on mount just never reused it. clampFloatRect() now backs
      // both paths, plus the resize listener at the bottom of this file.
      const fitted = clampFloatRect(panelEl, saved.left, saved.top, saved.width, saved.height);
      panelEl.style.right = 'auto';
      panelEl.style.left = `${fitted.left}px`;
      panelEl.style.top = `${fitted.top}px`;
      if (fitted.width) panelEl.style.width = `${fitted.width}px`;
      if (fitted.height) panelEl.style.height = `${fitted.height}px`;
    }

    const persist = () => {
      const parent = panelEl.offsetParent;
      const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
      const rect = panelEl.getBoundingClientRect();
      const layout = loadFloatLayout();
      layout[key] = { left: rect.left - parentRect.left, top: rect.top - parentRect.top, width: rect.width, height: rect.height };
      saveFloatLayout(layout);
    };

    handleEl.addEventListener('mousedown', (event) => {
      if (event.target.closest('button, input, select, a')) return;
      event.preventDefault();
      const parent = panelEl.offsetParent;
      const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
      const startRect = panelEl.getBoundingClientRect();
      const startLeft = startRect.left - parentRect.left;
      const startTop = startRect.top - parentRect.top;
      const startX = event.clientX;
      const startY = event.clientY;
      panelEl.style.right = 'auto';
      panelEl.style.left = `${startLeft}px`;
      panelEl.style.top = `${startTop}px`;
      panelEl.classList.add('is-dragging');
      const onMove = (moveEvent) => {
        const maxLeft = (parent?.clientWidth || window.innerWidth) - panelEl.offsetWidth;
        const maxTop = (parent?.clientHeight || window.innerHeight) - panelEl.offsetHeight;
        panelEl.style.left = `${Math.max(0, Math.min(maxLeft, startLeft + (moveEvent.clientX - startX)))}px`;
        panelEl.style.top = `${Math.max(0, Math.min(maxTop, startTop + (moveEvent.clientY - startY)))}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        panelEl.classList.remove('is-dragging');
        persist();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // The corner resize handle itself is native (CSS `resize: both`) — a
    // ResizeObserver is the only way to notice when the user has used it,
    // to persist the new size. First callback fires immediately on
    // observe() with the initial size, which isn't a user resize — skip it.
    if (typeof ResizeObserver !== 'undefined') {
      let sawInitial = false;
      new ResizeObserver(() => {
        if (!sawInitial) { sawInitial = true; return; }
        persist();
      }).observe(panelEl);
    }

    panelEl.querySelector('[data-reset]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      panelEl.style.left = '';
      panelEl.style.top = '';
      panelEl.style.right = '';
      panelEl.style.width = '';
      panelEl.style.height = '';
      const layout = loadFloatLayout();
      delete layout[key];
      saveFloatLayout(layout);
    });
  }

  // Re-clamps every floating panel still on screen after the *browser
  // window itself* is resized (moving it to a different monitor, un-
  // maximizing, projecting to a screen of a different size, etc.) — the
  // load-time clamp in setupFloatPanel only ever runs once, on mount, so
  // without this a panel that was fine when the page loaded could still
  // end up off-edge or overlapping if the window changes size afterward
  // without a full reload.
  function reclampAllFloatPanels() {
    const layout = loadFloatLayout();
    let changed = false;
    floatPanels.forEach(({ panelEl, key }) => {
      if (!panelEl.isConnected) return;
      const parent = panelEl.offsetParent;
      const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
      const rect = panelEl.getBoundingClientRect();
      const left = rect.left - parentRect.left;
      const top = rect.top - parentRect.top;
      // Only re-clamp width/height if the user actually customized them
      // before (a saved entry with a width/height) — otherwise leave size
      // alone; the CSS max-width/max-height rules already keep an
      // un-customized panel responsive on their own.
      const savedEntry = layout[key];
      const fitted = clampFloatRect(panelEl, left, top, savedEntry?.width || null, savedEntry?.height || null);
      if (fitted.left === left && fitted.top === top) return; // still fully on screen
      panelEl.style.right = 'auto';
      panelEl.style.left = `${fitted.left}px`;
      panelEl.style.top = `${fitted.top}px`;
      layout[key] = { left: fitted.left, top: fitted.top, width: fitted.width || rect.width, height: fitted.height || rect.height };
      changed = true;
    });
    if (changed) saveFloatLayout(layout);
  }

  let resizeListenerAttached = false;

  function initFloatingPanels() {
    floatPanels.length = 0; // avoid accumulating stale panel refs across remounts
    setupFloatPanel(rootEl.querySelector('.gis-editor__toolbar'), rootEl.querySelector('[data-drag="toolbar"]'), 'toolbar');
    setupFloatPanel(rootEl.querySelector('.gis-editor__panel'), rootEl.querySelector('[data-drag="panel"]'), 'panel');

    if (!resizeListenerAttached) {
      resizeListenerAttached = true;
      let resizeTimer = null;
      window.addEventListener('resize', () => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(reclampAllFloatPanels, 150);
      });
    }
  }

  function buildModal() {
    modalEl = document.createElement('div');
    modalEl.className = 'gis-modal';
    modalEl.innerHTML = `
      <div class="gis-modal__card" role="dialog" aria-labelledby="gisModalTitle">
        <span class="gis-modal__title type-h3" id="gisModalTitle">Select boundary</span>
        <label class="gis-modal__label type-caption" for="gisEntityType">ENTITY TYPE</label>
        <select class="gis-modal__input" id="gisEntityType"><option value="governorate-group">Governorate</option><option value="administration">Administration</option><option value="district">District</option></select>
        <label class="gis-modal__label type-caption gis-modal__governorate-label" for="gisGovernorate">GOVERNORATE</label>
        <select class="gis-modal__input" id="gisGovernorate"></select>
        <label class="gis-modal__label type-caption gis-modal__administration-label" for="gisAdministration">ADMINISTRATION</label>
        <select class="gis-modal__input" id="gisAdministration"></select>
        <label class="gis-modal__label type-caption gis-modal__district-label" for="gisDistrict">DISTRICT</label>
        <select class="gis-modal__input" id="gisDistrict"></select>
        <p class="gis-modal__loading" id="gisModalLoading" aria-live="polite"></p>
        <div class="gis-modal__actions"><button class="btn btn--ghost" id="gisModalCancel" type="button">Cancel</button><button class="btn btn--primary" id="gisModalSelect" type="button"><span>Select boundary</span></button></div>
      </div>`;
    document.body.appendChild(modalEl);
  }

  const optionMarkup = (items) => `<option value="">Select...</option>${items.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}`;

  async function openEntitySelector(type) {
    const typeSelect = document.getElementById('gisEntityType');
    const governorateSelect = document.getElementById('gisGovernorate');
    const administrationSelect = document.getElementById('gisAdministration');
    const districtSelect = document.getElementById('gisDistrict');
    const loading = document.getElementById('gisModalLoading');
    let governorates = [], administrations = [], districts = [];
    const hasPolygon = (entity) => Boolean(entity?.geometry || MKNexus.Boundaries.getById(entity?.id)?.geometry);
    typeSelect.value = type;
    modalEl.classList.add('is-open');
    const refreshVisibility = () => {
      const selectedType = typeSelect.value;
      document.querySelector('.gis-modal__governorate-label').hidden = false;
      governorateSelect.hidden = false;
      document.querySelector('.gis-modal__administration-label').hidden = selectedType === 'governorate-group';
      administrationSelect.hidden = selectedType === 'governorate-group';
      document.querySelector('.gis-modal__district-label').hidden = selectedType !== 'district';
      districtSelect.hidden = selectedType !== 'district';
    };
    const load = async (work) => {
      loading.textContent = 'Loading backend master data...';
      try { await work(); loading.textContent = ''; } catch (error) { loading.textContent = error.message; }
    };
    const loadGovernorates = () => load(async () => {
      governorates = await MKNexus.Boundaries.getEntities('governorate-group');
      governorateSelect.innerHTML = optionMarkup(governorates);
      if (!governorates.length && typeSelect.value !== 'governorate-group') loading.textContent = 'Create a Governorate before drawing this level.';
    });
    const loadAdministrations = () => load(async () => {
      const parent = governorates.find((item) => item.id === governorateSelect.value);
      administrations = hasPolygon(parent) && governorateSelect.value ? await MKNexus.Boundaries.getEntities('administration', governorateSelect.value) : [];
      administrationSelect.innerHTML = optionMarkup(administrations);
      districtSelect.innerHTML = optionMarkup([]);
      if (!hasPolygon(parent)) loading.textContent = 'Create a Governorate polygon before drawing an Administration.';
      else if (!administrations.length && typeSelect.value === 'district') loading.textContent = 'Create an Administration inside this Governorate first.';
    });
    const loadDistricts = () => load(async () => {
      const parent = administrations.find((item) => item.id === administrationSelect.value);
      districts = hasPolygon(parent) && administrationSelect.value ? await MKNexus.Boundaries.getEntities('district', administrationSelect.value) : [];
      districtSelect.innerHTML = optionMarkup(districts);
      if (!hasPolygon(parent)) loading.textContent = 'Create an Administration polygon before drawing a District.';
    });
    typeSelect.onchange = async () => { refreshVisibility(); governorateSelect.value = ''; administrationSelect.innerHTML = optionMarkup([]); districtSelect.innerHTML = optionMarkup([]); await loadGovernorates(); };
    governorateSelect.onchange = async () => { administrationSelect.innerHTML = optionMarkup([]); districtSelect.innerHTML = optionMarkup([]); if (typeSelect.value !== 'governorate-group' && governorateSelect.value) await loadAdministrations(); };
    administrationSelect.onchange = async () => { districtSelect.innerHTML = optionMarkup([]); if (typeSelect.value === 'district' && administrationSelect.value) await loadDistricts(); };
    const close = () => { modalEl.classList.remove('is-open'); typeSelect.onchange = null; governorateSelect.onchange = null; administrationSelect.onchange = null; };
    document.getElementById('gisModalCancel').onclick = close;
    document.getElementById('gisModalSelect').onclick = () => {
      const selectedType = typeSelect.value;
      const selected = selectedType === 'governorate-group' ? governorates.find((item) => item.id === governorateSelect.value) : selectedType === 'administration' ? administrations.find((item) => item.id === administrationSelect.value) : districts.find((item) => item.id === districtSelect.value);
      if (!selected) {
        loading.textContent = typeSelect.value === 'administration'
          ? 'Choose a Governorate before drawing an Administration.'
          : typeSelect.value === 'district'
            ? 'Choose an Administration before drawing a District.'
            : 'Choose a Governorate to continue.';
        return;
      }
      close();
      MKNexus.GISEditor.selectEntity(selected);
    };
    refreshVisibility();
    await loadGovernorates();
  }

  function setToolbarMode(mode, type) {
    if (!rootEl) return;
    // rootEl is kept alive intentionally (see geo-module.js), but the
    // router detaches it from the document whenever another module is
    // active — document.getElementById() only finds attached nodes, so
    // this can still be null even though rootEl itself is a valid object.
    const status = document.getElementById('gisEditorStatus');
    if (!status) return;
    rootEl.querySelectorAll('[data-draw]').forEach((button) => button.classList.toggle('is-active', button.dataset.draw === type && mode !== 'idle'));
    const messages = { idle: 'Select a backend boundary type to edit.', drawing: `Drawing ${typeLabel(type)} — click to add vertices, double-click or Enter to finish, Esc to cancel.`, editing: `Editing ${typeLabel(type)} — drag vertices, Enter to save, Esc to cancel.` };
    status.textContent = messages[mode] || type || '';
    status.classList.toggle('is-active', mode !== 'idle');
  }

  function refreshList() {
    const listEl = document.getElementById('gisEditorList');
    if (!listEl) return;
    const boundaries = MKNexus.Boundaries.getAll();
    document.getElementById('gisEditorCount').textContent = String(boundaries.length);
    listEl.innerHTML = boundaries.map((boundary) => `<li class="gis-editor__item" data-id="${esc(boundary.id)}">
      <div class="gis-editor__item-main"><span class="gis-editor__item-dot" style="background:${safeColor(boundary.metadata?.color) || 'var(--accent)'}"></span><span class="gis-editor__item-name">${esc(boundary.name)}</span><span class="gis-editor__item-type"><i class="fa-solid ${boundary.type === 'governorate-group' ? 'fa-layer-group' : boundary.type === 'administration' ? 'fa-sitemap' : 'fa-draw-polygon'}"></i>${esc(typeLabel(boundary.type))}</span></div>
      <div class="gis-editor__item-kpi" data-kpi="${esc(boundary.id)}">Loading KPI...</div>
      <div class="gis-editor__item-actions"><button class="gis-editor__item-btn" data-edit="${esc(boundary.id)}" type="button" aria-label="Edit"><i class="fa-solid fa-pen"></i></button><button class="gis-editor__item-btn gis-editor__item-btn--danger" data-delete="${esc(boundary.id)}" type="button" aria-label="Delete"><i class="fa-solid fa-trash"></i></button></div>
    </li>`).join('') || '<li class="gis-editor__empty type-body-sm">No backend boundaries loaded.</li>';
    listEl.querySelectorAll('[data-id]').forEach((item) => item.addEventListener('click', (event) => { if (!event.target.closest('[data-edit],[data-delete]')) MKNexus.GISEditor.selectBoundary(item.dataset.id); }));
    listEl.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); MKNexus.GISEditor.startEditing(button.dataset.edit); }));
    listEl.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); const boundary = MKNexus.Boundaries.getById(button.dataset.delete); if (boundary && confirm(`Delete "${boundary.name}"? Child boundaries will be removed too.`)) MKNexus.GISEditor.deleteBoundary(button.dataset.delete); }));
    boundaries.forEach((boundary) => loadCardKpi(boundary));
  }

  async function loadCardKpi(boundary) {
    const card = document.querySelector(`[data-kpi="${boundary.id}"]`);
    if (!card) return;
    const kpi = await MKNexus.KPI.getForBoundaryAsync(boundary.id);
    if (!kpi) { card.textContent = 'KPI unavailable'; return; }
    const sugar = kpi.sugarPercent == null ? '—' : `${Number(kpi.sugarPercent).toFixed(2)}%`;
    const tons = kpi.beetTons == null ? '—' : `${Number(kpi.beetTons).toLocaleString('en-US')} t`;
    card.textContent = `Sugar ${sugar}  •  ${tons}`;
  }

  function setSelected(boundaryId) { document.querySelectorAll('.gis-editor__item').forEach((item) => item.classList.toggle('is-selected', item.dataset.id === boundaryId)); }
  function setEditMode(active) { rootEl?.querySelector('[data-action="toggle-mode"]')?.classList.toggle('is-active', active); rootEl?.querySelectorAll('[data-draw], [data-action="undo"], [data-action="redo"], [data-action="insert-vertex"], [data-action="delete-vertex"], [data-action="save"]').forEach((button) => { button.disabled = !active; }); }
  return { render, setToolbarMode, refreshList, setSelected, setEditMode };
})();
