window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Geo State: the single source of truth for "what's selected/
   hovered" on the map, and the choreographer of everything that reacts to
   it. Callers (editor.js's draw/edit tool, Story Mode) only ever call
   select()/hover()/clearSelection() here — camera movement and the "alive"
   boundary glow are driven directly (their timing is choreography, not
   loosely-coupled reaction), while UI consumers (the KPI deck in
   geo-module.js) subscribe via on('settle'/'clear'/'hover'). This is what
   turns "camera moves -> glow ramps in mid-flight -> camera settles ->
   panel/numbers animate in" into one readable sequence instead of the
   scattered setTimeout calls this used to be spread across editor.js. */
MKNexus.GeoState = (function () {
  const listeners = { select: new Set(), settle: new Set(), hover: new Set(), clear: new Set() };
  let selectedId = null;
  let hoveredId = null;
  let sequenceId = 0;

  // The "alive" glow (pulse ring + traveling sweep) starts a beat after the
  // camera departs, so it reads as arriving mid-flight rather than
  // appearing before or long after the move.
  const GLOW_DELAY_MS = 180;

  // Drill-down: selecting a boundary doesn't just highlight it, it also
  // narrows *which level renders at all* (see MKNexus.Layers' drill
  // filters) — picking a governorate reveals only its administrations,
  // picking one of those reveals only its districts, and picking a
  // district (nothing deeper to drill into) isolates it from its sibling
  // districts instead. Applied once the camera settles, so the reveal
  // reads as "arriving" rather than snapping in in the middle of the fly-in.
  function nextDrillFor(boundary) {
    if (boundary.type === 'governorate-group') return { level: 'administration', parentId: boundary.id, isolateId: null };
    if (boundary.type === 'administration') return { level: 'district', parentId: boundary.id, isolateId: null };
    return { level: 'district', parentId: boundary.parentId, isolateId: boundary.id };
  }

  function on(event, callback) {
    listeners[event]?.add(callback);
    return () => listeners[event]?.delete(callback);
  }

  function emit(event, payload) {
    listeners[event]?.forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        console.error(`[MK Nexus] GeoState listener for "${event}" failed`, error);
      }
    });
  }

  function getSelectedId() { return selectedId; }
  function getHoveredId() { return hoveredId; }

  function hover(boundaryId) {
    if (boundaryId === hoveredId) return;
    hoveredId = boundaryId;
    const map = MKNexus.MapEngine.getMap();
    if (map) {
      if (boundaryId == null) MKNexus.Layers.clearHover(map);
      else MKNexus.Layers.setHover(map, boundaryId);
    }
    emit('hover', boundaryId);
  }

  function clearHover() { hover(null); }

  function select(boundaryId, { moveCamera = true } = {}) {
    const map = MKNexus.MapEngine.getMap();
    const boundary = MKNexus.Boundaries.getById(boundaryId);
    if (!map || !boundary) return null;

    selectedId = boundaryId;
    const mySequence = ++sequenceId;
    const isCurrent = () => mySequence === sequenceId && selectedId === boundaryId;

    // Instant: fill/border dim on every other boundary, active feature-state
    // on this one. This is the "click felt responsive" cue and must never
    // wait on the camera.
    MKNexus.Layers.setActive(map, boundaryId);
    emit('select', boundary);

    const cameraSettled = moveCamera ? MKNexus.Camera.fitToBoundary(boundary) : Promise.resolve();

    setTimeout(() => {
      if (!isCurrent()) return;
      MKNexus.MapAnimation.pulseGlow(map, boundary.id, boundary.type);
      MKNexus.MapAnimation.sweepActiveBoundary(map, boundary.type);
    }, moveCamera ? GLOW_DELAY_MS : 0);

    cameraSettled.then(() => {
      if (!isCurrent()) return;
      MKNexus.Layers.setDrillState(map, nextDrillFor(boundary));
      emit('settle', boundary);
    });

    return boundary;
  }

  function clearSelection() {
    const map = MKNexus.MapEngine.getMap();
    selectedId = null;
    sequenceId += 1;
    if (map) MKNexus.Layers.clearActive(map);
    emit('clear');
  }

  // The explicit "back out entirely" action (breadcrumb's root crumb, the
  // Reset View button) — clearSelection() alone leaves the drill filters
  // wherever they were (undo/redo and other paths call it without wanting
  // a surprise zoom-out), so only this resets to the top-level governorate
  // overview.
  function goToOverview() {
    clearSelection();
    const map = MKNexus.MapEngine.getMap();
    if (map) MKNexus.Layers.setDrillState(map, { level: 'governorate-group', parentId: null, isolateId: null });
  }

  return { on, select, clearSelection, goToOverview, hover, clearHover, getSelectedId, getHoveredId };
})();
