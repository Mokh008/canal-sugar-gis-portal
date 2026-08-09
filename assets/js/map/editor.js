window.MKNexus = window.MKNexus || {};

/* MK NEXUS — GIS Editor: draw/edit/delete Administration, District, and
   Village polygons directly against MapLibre's GeoJSON sources — no
   external draw plugin, so styling stays fully on-brand. */
MKNexus.GISEditor = (function () {
  let map = null;
  let mode = 'idle'; // idle | drawing | editing
  let editMode = false;
  let drawType = null;
  let draftCoords = [];
  let editingBoundaryId = null;
  let selectedEntity = null;
  // The persistent selection itself — a visualization state independent of
  // editMode/mode above (interaction-session state, reset whenever a draw/
  // edit session ends) — now lives in MKNexus.GeoState, not here, so every
  // other module that cares "what's selected" (camera, deck) can read/
  // subscribe to the same source of truth instead of editor.js forwarding
  // it around manually.
  let draggingVertexIndex = null;
  let selectedVertexIndex = null;
  let hoveredVertexIndex = null;
  const undoStack = [];
  const redoStack = [];

  function screenToLngLat(e) { return [e.lngLat.lng, e.lngLat.lat]; }

  function snappedLngLat(e) {
    const point = map.project(e.lngLat);
    let nearest = null;
    let distance = 12;
    draftCoords.forEach((coordinate, index) => {
      const vertex = map.project({ lng: coordinate[0], lat: coordinate[1] });
      const candidateDistance = Math.hypot(point.x - vertex.x, point.y - vertex.y);
      if (candidateDistance <= distance) { distance = candidateDistance; nearest = { coordinate, index }; }
    });
    return nearest;
  }

  function onMapClick(e) {
    if (!editMode || mode !== 'drawing') return;
    if (e.originalEvent?.detail > 1) return;
    draftCoords.push(snappedLngLat(e)?.coordinate || screenToLngLat(e));
    MKNexus.Layers.setDraft(map, draftCoords);
  }

  function onMapDblClick(e) {
    if (mode === 'idle') return;
    e.preventDefault();
    if (mode === 'drawing' && draftCoords.length >= 3) finishDrawing();
    if (mode === 'editing' && draftCoords.length >= 3) finishEditing();
  }

  function onVertexMouseDown(e) {
    if (mode !== 'editing') return;
    const feature = e.features?.[0];
    if (!feature) return;
    draggingVertexIndex = feature.properties.index;
    selectedVertexIndex = draggingVertexIndex;
    MKNexus.Layers.setVertexDragging(map, draggingVertexIndex, draftCoords.length);
    map.dragPan.disable();
    map.getCanvas().style.cursor = 'grabbing';
  }

  function onMapMouseMove(e) {
    if (mode === 'editing' || mode === 'drawing') {
      const nearest = snappedLngLat(e);
      const nextHoveredIndex = nearest?.index ?? null;
      if (nextHoveredIndex !== hoveredVertexIndex) {
        hoveredVertexIndex = nextHoveredIndex;
        MKNexus.Layers.setVertexHover(map, hoveredVertexIndex, draftCoords.length);
      }
      map.getCanvas().style.cursor = nearest ? 'pointer' : mode === 'drawing' ? 'crosshair' : '';
    }
    if (mode === 'editing' && draggingVertexIndex !== null) {
      draftCoords[draggingVertexIndex] = screenToLngLat(e);
      MKNexus.Layers.setDraft(map, draftCoords);
    } else if (mode === 'drawing' && draftCoords.length > 0) {
      MKNexus.Layers.setDraft(map, [...draftCoords, screenToLngLat(e)]);
    }
  }

  function onMapMouseUp() {
    if (draggingVertexIndex !== null) {
      draggingVertexIndex = null;
      MKNexus.Layers.setVertexDragging(map, null, draftCoords.length);
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
    }
  }

  function startDrawing(type, entity = null) {
    if (!editMode) return;
    cancelCurrent();
    mode = 'drawing';
    drawType = type;
    selectedEntity = entity;
    draftCoords = [];
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = 'crosshair';
    MKNexus.GISEditorUI.setToolbarMode('drawing', type);
  }

  function startEditing(boundaryId) {
    const boundary = MKNexus.Boundaries.getById(boundaryId);
    if (!boundary) return;
    // Editing always implies a selection. This may be reached without
    // going through selectBoundary() first (the list's pencil icon,
    // re-entering Edit Mode with a prior selection) — make sure the map/
    // KPI deck/list are in sync before anything else happens.
    if (MKNexus.GeoState.getSelectedId() !== boundaryId) applySelection(boundaryId, { moveCamera: false });
    // The actual editing session (vertices, drag handles, geometry
    // mutation) is gated on editMode here — the single place every entry
    // point funnels through — so nothing can spawn edit handles while
    // Edit Mode is off, regardless of how startEditing was reached.
    if (!editMode || !boundary.geometry) return;
    cancelCurrent();
    mode = 'editing';
    editingBoundaryId = boundaryId;
    selectedEntity = boundary;
    selectedVertexIndex = null;
    draftCoords = boundary.geometry.coordinates[0].slice(0, -1);
    map.doubleClickZoom.disable();
    MKNexus.Layers.setDraft(map, draftCoords);
    MKNexus.Camera.fitToBoundary(boundary);
    MKNexus.GISEditorUI.setToolbarMode('editing', boundary.type);
  }

  function cancelCurrent() {
    mode = 'idle';
    drawType = null;
    editingBoundaryId = null;
    selectedEntity = null;
    draftCoords = [];
    draggingVertexIndex = null;
    hoveredVertexIndex = null;
    selectedVertexIndex = null;
    if (map) {
      map.getCanvas().style.cursor = '';
      map.doubleClickZoom.enable();
      MKNexus.Layers.clearDraft(map);
    }
    MKNexus.GISEditorUI.setToolbarMode('idle');
  }

  function cleanCoordinates(coordinates) {
    const clean = coordinates.slice();
    while (clean.length > 1 && clean[clean.length - 1][0] === clean[0][0] && clean[clean.length - 1][1] === clean[0][1]) clean.pop();
    return clean;
  }

  function snapshot() { return JSON.parse(JSON.stringify(MKNexus.Boundaries.getAll())); }
  function recordHistory() {
    undoStack.push(snapshot());
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(next, fromStack) {
    MKNexus.Boundaries.replaceAll(next);
    MKNexus.Layers.refreshBoundaries(map);
    MKNexus.GISEditorUI.refreshList();
    if (fromStack) {
      // The restored data may not even contain the previously-selected
      // boundary in its old form — clear the selection (map feature-state,
      // glow/sweep, list highlight) rather than leaving a stale glow
      // pointed at out-of-date geometry.
      MKNexus.GeoState.clearSelection();
      MKNexus.GISEditorUI.setSelected(null);
    }
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop(), true);
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop(), true);
  }

  // Meters-per-degree at the equator; longitude's own meters-per-degree
  // shrinks by cos(latitude) away from it — see areaM2 below.
  const METERS_PER_DEGREE_LAT = 111320;
  const SQM_PER_FEDDAN = 4200.83;

  function polygonMetrics(coordinates) {
    let area = 0;
    let lngTotal = 0;
    let latTotal = 0;
    coordinates.forEach(([lng, lat], index) => {
      const next = coordinates[(index + 1) % coordinates.length];
      area += lng * next[1] - next[0] * lat;
      lngTotal += lng;
      latTotal += lat;
    });
    const center = [lngTotal / coordinates.length, latTotal / coordinates.length];

    // The shoelace result above is in raw degrees^2 — not a physical area
    // at all, even though it used to be sent to the backend as `Area`
    // unmodified. Project degrees to meters with an equirectangular
    // approximation around the polygon's own centroid latitude (accurate
    // enough at single-boundary scale) before converting to Feddan, the
    // same unit every other Area value in the app (kpi-store.js's
    // FIELD_DEFS) is already in.
    const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((center[1] * Math.PI) / 180);
    const areaM2 = Math.abs(area / 2) * METERS_PER_DEGREE_LAT * metersPerDegreeLng;

    return { center, area: areaM2 / SQM_PER_FEDDAN };
  }

  function entityTypeFor(type) {
    return { 'governorate-group': 'Governorate', administration: 'Administration', district: 'District' }[type] || type;
  }

  function saveGeometry(boundaryId, type, coordinates) {
    const polygon = { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] };
    const metrics = polygonMetrics(coordinates);
    const boundary = MKNexus.Boundaries.getById(boundaryId);
    const version = Number(boundary?.version || 0) + 1;
    MKNexus.Boundaries.updateGeometry(boundaryId, {
      entityType: entityTypeFor(type),
      geometry: polygon,
      center: metrics.center,
      area: metrics.area,
      version,
    });
    return polygon;
  }

  function finishDrawing() {
    const coordinates = cleanCoordinates(draftCoords);
    if (coordinates.length < 3 || !selectedEntity?.id) return;
    const boundaryId = selectedEntity.id;
    recordHistory();
    saveGeometry(boundaryId, drawType, coordinates);
    MKNexus.Layers.refreshBoundaries(map);
    cancelCurrent();
    MKNexus.GISEditorUI.refreshList();
    // refreshList() rebuilds the list DOM from scratch, so the selection
    // (including its list-row highlight) is (re)applied after, not before.
    applySelection(boundaryId, { moveCamera: false });
  }

  function finishEditing() {
    const coordinates = cleanCoordinates(draftCoords);
    if (coordinates.length < 3 || !editingBoundaryId) return;
    const boundaryId = editingBoundaryId;
    recordHistory();
    saveGeometry(boundaryId, selectedEntity?.type || MKNexus.Boundaries.getById(boundaryId)?.type, coordinates);
    MKNexus.Layers.refreshBoundaries(map);
    cancelCurrent();
    MKNexus.GISEditorUI.refreshList();
    applySelection(boundaryId, { moveCamera: false });
  }

  function deleteBoundary(boundaryId) {
    recordHistory();
    const removedIds = MKNexus.Boundaries.remove(boundaryId);
    MKNexus.Layers.refreshBoundaries(map);
    MKNexus.GeoState.clearSelection();
    MKNexus.GISEditorUI.refreshList();
    return removedIds;
  }

  function duplicateBoundary(boundaryId) {
    recordHistory();
    const copy = MKNexus.Boundaries.duplicate(boundaryId);
    if (copy) {
      MKNexus.Layers.refreshBoundaries(map);
      MKNexus.GISEditorUI.refreshList();
      selectBoundary(copy.id);
    }
  }

  function insertVertex(e) {
    if (mode !== 'editing' || draftCoords.length < 3) return;
    const point = map.project(e.lngLat);
    let bestIndex = 0;
    let bestDistance = Infinity;
    draftCoords.forEach((coordinate, index) => {
      const next = draftCoords[(index + 1) % draftCoords.length];
      const start = map.project({ lng: coordinate[0], lat: coordinate[1] });
      const end = map.project({ lng: next[0], lat: next[1] });
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
      const distance = Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index + 1; }
    });
    recordHistory();
    draftCoords.splice(bestIndex, 0, screenToLngLat(e));
    selectedVertexIndex = bestIndex;
    MKNexus.Layers.setDraft(map, draftCoords);
  }

  function deleteVertex() {
    if (mode !== 'editing' || selectedVertexIndex == null || draftCoords.length <= 3) return;
    recordHistory();
    draftCoords.splice(selectedVertexIndex, 1);
    selectedVertexIndex = Math.min(selectedVertexIndex, draftCoords.length - 1);
    MKNexus.Layers.setDraft(map, draftCoords);
  }

  function toggleEditMode() {
    editMode = !editMode;
    if (!editMode) {
      // Turning editing off only ends the drawing/editing SESSION (draft
      // coords, vertex handles) — cancelCurrent() never touches the
      // persistent selection, so it stays exactly as it was.
      cancelCurrent();
    } else if (MKNexus.GeoState.getSelectedId()) {
      // Re-entering Edit Mode with something already selected immediately
      // adds edit handles to it, per spec — same selection, editing now on.
      startEditing(MKNexus.GeoState.getSelectedId());
    }
    MKNexus.GISEditorUI.setEditMode(editMode);
    return editMode;
  }

  // Selection is a pure visualization state — fill/outline/glow/breathing
  // pulse/traveling sweep/active label/KPI deck/list highlight — and is
  // completely independent of editMode. Every path that makes a boundary
  // "the current selection" funnels through here so those stay in sync no
  // matter how the boundary was selected. The actual camera/glow/KPI-deck
  // choreography is owned by MKNexus.GeoState (map/geo-state.js) — this
  // just also keeps the GIS Editor's own list highlight in sync.
  function applySelection(boundaryId, { moveCamera = true } = {}) {
    const boundary = MKNexus.GeoState.select(boundaryId, { moveCamera });
    MKNexus.GISEditorUI.setSelected(boundaryId);
    return boundary;
  }

  function selectBoundary(boundaryId, { moveCamera = true } = {}) {
    const boundary = applySelection(boundaryId, { moveCamera });
    // Edit Mode only adds editing capability on top of the same selection
    // — startEditing() itself is what enforces the editMode gate.
    if (boundary) startEditing(boundaryId);
  }

  async function selectEntity(entity) {
    const resolved = await MKNexus.Boundaries.getEntityWithGeometry(entity);
    const existing = MKNexus.Boundaries.getById(resolved.id);
    if (existing?.geometry || resolved.geometry) {
      const boundary = MKNexus.Boundaries.upsertEntity(resolved);
      startEditing(boundary.id);
      return;
    }
    const boundary = MKNexus.Boundaries.upsertEntity(resolved);
    startDrawing(resolved.type, boundary);
  }

  function init(mapInstance) {
    map = mapInstance;
    map.on('click', onMapClick);
    map.on('dblclick', onMapDblClick);
    map.on('mousemove', onMapMouseMove);
    map.on('mouseup', onMapMouseUp);
    map.on('mousemove', 'mk-boundary-fill', (e) => {
      // GeoState.hover() already no-ops on a repeated id, so mousemove
      // firing far more often than the hovered feature actually changes
      // costs nothing extra here.
      const id = e.features?.[0]?.id;
      if (id != null) MKNexus.GeoState.hover(id);
    });
    map.on('mouseleave', 'mk-boundary-fill', () => MKNexus.GeoState.clearHover());
    map.on('click', (e) => {
      if (mode !== 'editing') return;
      // A plain click on (or very near) an existing vertex is a select/
      // drag interaction already fully handled by onVertexMouseDown above
      // — without this guard, that same click also bubbled through here
      // and inserted a spurious duplicate vertex right next to the one
      // just clicked, since insertVertex() only ever looks at the nearest
      // *edge*, not whether the click actually landed on a vertex.
      if (snappedLngLat(e)) return;
      insertVertex(e);
    });
    map.on('mousedown', 'mk-draft-vertices', onVertexMouseDown);
    map.on('click', 'mk-boundary-fill', (e) => {
      if (mode !== 'idle') return;
      const id = e.features?.[0]?.id;
      if (id != null) selectBoundary(id);
    });

    document.addEventListener('keydown', (e) => {
      // This listener is registered once, permanently, on `document` — it
      // used to fire from every module (Rent, Expenses, ...) once Geo had
      // been visited: Ctrl+Z would silently revert boundary geometry (and
      // sync that to the backend) while a user was editing an unrelated
      // text field, and Escape would try to update GIS Editor DOM that the
      // router had already detached, throwing. Both guards fix that.
      if (MKNexus.Router.current() !== 'geo') return;
      if (e.target?.matches?.('input, textarea, select')) return;
      if (e.key === 'Escape') cancelCurrent();
      if (e.key === 'Enter') {
        if (mode === 'drawing') finishDrawing();
        if (mode === 'editing') finishEditing();
      }
      if (e.key === 'Backspace' && mode === 'drawing' && draftCoords.length) {
        draftCoords.pop();
        MKNexus.Layers.setDraft(map, draftCoords);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    });
  }

  // Passthrough for the toolbar's draft-line opacity slider — kept here
  // (rather than letting gis-editor-ui.js reach into MKNexus.Layers
  // directly) so the UI layer never needs to know which map instance is
  // live; this module already owns that reference.
  function setDraftLineOpacity(value) { MKNexus.Layers.setDraftLineOpacity(map, value); }

  return { init, startDrawing, startEditing, cancelCurrent, finishDrawing, finishEditing, deleteBoundary, duplicateBoundary, insertVertex, deleteVertex, undo, redo, toggleEditMode, selectBoundary, selectEntity, setDraftLineOpacity, getMode: () => mode, isEditMode: () => editMode };
})();