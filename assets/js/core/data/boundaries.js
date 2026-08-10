window.MKNexus = window.MKNexus || {};

/* Boundary repository: local storage is a durable offline cache; production
  synchronization uses only the centralized API service. */
MKNexus.Boundaries = (function () {
  const STORAGE_KEY = 'mknexus_boundaries_v2';
  const TYPES = ['governorate-group', 'administration', 'district', 'agricultural-zone'];

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('[MK Nexus] Failed to load boundaries', e);
      return [];
    }
  }

  let store = loadAll();

  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }

  function unwrapRows(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.rows)) return data.rows;
    if (data?.geometry || data?.Polygon || data?.polygon) return [data];
    if (Array.isArray(data?.features)) return data.features.map((feature) => ({
      id: feature.id || feature.properties?.id || feature.properties?.BoundaryID,
      parentId: feature.properties?.parentId || feature.properties?.ParentID || null,
      type: feature.properties?.type || feature.properties?.EntityType,
      name: feature.properties?.name || feature.properties?.label || feature.properties?.Name,
      geometry: feature.geometry || feature.properties?.Polygon,
      metadata: feature.properties || {},
    }));
    return [];
  }

  function firstValue(row, keys) {
    return keys.map((key) => row?.[key]).find((value) => value !== undefined && value !== null && value !== '');
  }

  function typeForRow(row, typeHint) {
    if (typeHint) return typeHint;
    const value = String(firstValue(row, ['type', 'Type', 'entityType', 'EntityType']) || '').toLowerCase();
    if (value.includes('admin')) return 'administration';
    if (value.includes('district')) return 'district';
    if (value.includes('zone')) return 'agricultural-zone';
    return 'governorate-group';
  }

  function normalizeEntity(row, typeHint) {
    if (!row) return null;
    const type = typeForRow(row, typeHint);
    const id = firstValue(row, type === 'administration'
      ? ['id', 'ID', 'AdministrationID', 'administrationId', 'BoundaryID', 'boundaryId']
      : type === 'district'
        ? ['id', 'ID', 'DistrictID', 'districtId', 'BoundaryID', 'boundaryId']
        : ['id', 'ID', 'GovernorateID', 'governorateId', 'BoundaryID', 'boundaryId']);
    if (!id) return null;
    const parentKeys = type === 'district'
      ? ['parentId', 'parentID', 'ParentID', 'AdministrationID', 'administrationId']
      : type === 'administration'
        ? ['parentId', 'parentID', 'ParentID', 'GovernorateID', 'governorateId']
        : ['parentId', 'parentID', 'ParentID'];
    const parentId = firstValue(row, parentKeys) || null;
    const geometry = row.geometry || row.Geometry || row.Polygon || row.polygon || null;
    return {
      id: String(id),
      parentId: parentId ? String(parentId) : null,
      type,
      name: String(firstValue(row, ['name', 'Name', 'NameEnglish', 'NameArabic', 'label', 'Label', 'GovernorateName', 'AdministrationName', 'DistrictName']) || 'Unnamed boundary'),
      geometry,
      metadata: { ...(row.metadata || {}), ...(row.properties || {}), color: firstValue(row, ['color', 'Color']) || row.metadata?.color || row.properties?.color || null },
      center: row.center || row.Center || null,
      area: firstValue(row, ['area', 'Area']) || null,
      version: firstValue(row, ['version', 'Version']) || 0,
      createdAt: row.createdAt || row.CreatedAt || new Date().toISOString(),
      updatedAt: row.updatedAt || row.UpdatedAt || new Date().toISOString(),
    };
  }

  function normalizeBoundary(row) {
    const boundary = normalizeEntity(row);
    return boundary?.geometry ? boundary : null;
  }

  async function getEntities(type, parentId = null) {
    const action = { 'governorate-group': 'getGovernorates', administration: 'getAdministrations', district: 'getDistricts' }[type];
    if (!action) return [];
    const params = parentId
      ? type === 'district'
        ? { AdministrationID: parentId, administrationId: parentId, parentId }
        : { GovernorateID: parentId, governorateId: parentId, parentId }
      : {};
    const data = await MKNexus.ApiClient[action](params);
    return unwrapRows(data).map((row) => normalizeEntity(row, type)).filter(Boolean);
  }

  async function getEntityWithGeometry(entity) {
    if (entity.geometry) return entity;
    try {
      // BUG FIX: confirmed live — getPolygon's validateIdParam_ reads the
      // id specifically as `entityId` (camelCase); every other casing
      // sent here was silently ignored, so this always failed with
      // "Required parameter "entityId" is missing." Kept the other
      // casings too since it's cheap and this action's exact param name
      // was never documented anywhere.
      const data = await MKNexus.ApiClient.getPolygon({ entityId: entity.id, BoundaryID: entity.id, boundaryId: entity.id, id: entity.id });
      const polygon = unwrapRows(data).map((row) => normalizeEntity(row, entity.type)).find((row) => row?.geometry);
      return polygon ? { ...entity, ...polygon, id: entity.id, type: entity.type, name: entity.name, parentId: entity.parentId } : entity;
    } catch (error) {
      console.warn(`[MK Nexus] Polygon lookup failed for ${entity.id}: ${error.message}`);
      return entity;
    }
  }

  async function hydrate() {
    const requests = [
      MKNexus.ApiClient.getGovernorates(),
      MKNexus.ApiClient.getAdministrations(),
      MKNexus.ApiClient.getDistricts(),
      MKNexus.ApiClient.getZones(),
    ];
    const masterRequests = [
      MKNexus.Boundaries.getEntities('governorate-group'),
      MKNexus.Boundaries.getEntities('administration'),
      MKNexus.Boundaries.getEntities('district'),
    ];
    const [results, masterResults] = await Promise.all([
      Promise.allSettled(requests),
      Promise.allSettled(masterRequests),
    ]);
    const allSettled = [...results, ...masterResults];
    const rejected = allSettled.filter((result) => result.status === 'rejected');
    // Every one of these was Promise.allSettled'd specifically so one bad
    // request (e.g. getZones) doesn't block the others — but that also
    // meant a *total* failure (all of them rejected — expired/missing
    // session token, network down, wrong API URL) was completely silent:
    // the map would just quietly keep showing whatever was already in
    // localStorage (nothing, on a browser that's never loaded this app
    // before) with no error anywhere. Surfacing it here is what makes
    // "boundaries aren't showing" diagnosable from the browser console /
    // a toast instead of looking identical to "there's just no data yet".
    if (rejected.length && rejected.length === allSettled.length) {
      const reasons = rejected.map((result) => result.reason?.message || String(result.reason));
      console.error('[MK Nexus] Boundary hydration failed completely — every governorate/administration/district/zone request was rejected:', reasons);
      MKNexus.Toast?.error(`Couldn't load map boundaries from the server: ${reasons[0] || 'unknown error'}`, { duration: 8000 });
    } else if (rejected.length) {
      console.warn('[MK Nexus] Boundary hydration partially failed:', rejected.map((result) => result.reason?.message || String(result.reason)));
    }
    const remote = results.flatMap((result) => result.status === 'fulfilled' ? unwrapRows(result.value) : []).map(normalizeBoundary).filter(Boolean);
    const masters = masterResults.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    const byId = new Map(store.map((boundary) => [boundary.id, boundary]));
    masters.forEach((entity) => {
      const existing = byId.get(entity.id);
      if (existing) Object.assign(existing, { name: entity.name, parentId: entity.parentId, type: entity.type, metadata: { ...existing.metadata, ...entity.metadata } });
      else byId.set(entity.id, entity);
    });
    remote.forEach((boundary) => byId.set(boundary.id, { ...byId.get(boundary.id), ...boundary, name: byId.get(boundary.id)?.name || boundary.name }));
    if (masters.length || remote.length) replaceAll(Array.from(byId.values()));

    // BUG FIX: getGovernorates/getAdministrations/getDistricts never
    // include Geometry inline (confirmed live) — only the per-entity
    // getPolygon action returns it. Every boundary drawn/edited before
    // now only ever showed up on the map because this browser already had
    // it cached in localStorage from an earlier session; a browser
    // loading this app for the first time got zero boundary outlines no
    // matter what's actually stored server-side. Backfilling here (once,
    // for whatever the bulk fetch above left without geometry) is what
    // makes a cold cache work at all.
    const missingGeometry = getAll().filter((b) => !b.geometry && TYPES.includes(b.type) && b.type !== 'agricultural-zone');
    if (missingGeometry.length) await backfillGeometry_(missingGeometry);

    return getAll();
  }

  // Limited concurrency instead of firing every getPolygon request at
  // once — a cold cache can mean 30+ boundaries needing a backfill
  // simultaneously, and Apps Script enforces a per-user concurrent
  // execution quota that a full burst would trip.
  async function backfillGeometry_(boundaries) {
    const CONCURRENCY = 4;
    let cursor = 0;
    async function worker() {
      while (cursor < boundaries.length) {
        const boundary = boundaries[cursor++];
        try {
          const resolved = await getEntityWithGeometry(boundary);
          if (resolved.geometry) upsertEntity(resolved);
        } catch (error) {
          console.warn(`[MK Nexus] Geometry backfill failed for ${boundary.id}: ${error.message}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, boundaries.length) }, worker));
  }

  function featureFor(boundary) {
    return toFeatureCollection([boundary]).features[0];
  }

  // BUG FIX: createGeoJSON/updateGeoJSON go through this dedicated request
  // instead of the generic MKNexus.ApiClient — confirmed live (by calling
  // the backend directly) that its validateIdParam_ check
  // (mk-nexus-core/validation.gs) reads EntityID from the URL query string
  // (context.params / e.parameter), not the JSON POST body. ApiClient's
  // generic POST helper (api/client.js) only ever puts write-action
  // fields in the body — so every polygon drawn/edited through the GIS
  // Editor has always failed this check server-side and never actually
  // reached the backend; it only ever lived in this browser's
  // localStorage (see this file's header comment). `Geometry` (not the
  // `Polygon` key this used to send) is also JSON.stringify'd here
  // because the backend's validateJsonString_ parses it expecting a JSON
  // *string*, not a nested object.
  //
  // This same "ID belongs in the URL, not just the body" contract likely
  // affects other write actions too (createGovernorate, updateAdministration,
  // etc. all funnel through the same validateIdParam_) — not changed here
  // since it wasn't verified against a live failure the way this one was;
  // worth testing if those turn out to have the same silent-failure issue.
  function postGeoJSON_(action, { entityId, entityType, geometry, center, area, version }) {
    const config = MKNexus.ApiConfig;
    const url = new URL(config.baseUrl);
    url.searchParams.set('action', action);
    const token = sessionStorage.getItem(config.sessionStorageKey) || localStorage.getItem(config.sessionStorageKey);
    if (token) url.searchParams.set('token', token);
    if (entityId != null) url.searchParams.set('EntityID', String(entityId));
    const body = {
      action,
      ...(token ? { token } : {}),
      ...(entityId != null ? { EntityID: String(entityId) } : {}),
      EntityType: entityType,
      Geometry: JSON.stringify(geometry),
      Center: center,
      Area: area,
      Version: version,
    };
    return fetch(url.toString(), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      credentials: 'omit',
    }).then((response) => {
      if (!response.ok) throw new Error(`Backend request failed with HTTP ${response.status}.`);
      return response.json();
    }).then((payload) => {
      if (!payload || payload.success === false) throw new Error(payload?.message || 'Backend request failed.');
      return payload.data;
    });
  }

  // Every write here is optimistic: the local cache (and localStorage) is
  // already updated by the time this fires, so a failure here means local
  // state and the backend have silently diverged unless the user is told.
  function sync(operation, label, payload, boundaryName) {
    return operation(payload).catch((error) => {
      console.warn(`[MK Nexus] ${label} synchronization failed: ${error.message}`);
      MKNexus.Toast?.error(
        `Couldn't save "${boundaryName || 'this boundary'}" to the server — your change is only saved on this device. ${error.message || ''}`.trim(),
        { duration: 8000 }
      );
      throw error;
    });
  }

  function generateId(type) {
    const prefix = { 'governorate-group': 'GRP', administration: 'ADM', district: 'DST', 'agricultural-zone': 'AGZ' }[type] || 'GEO';
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
  }

  function create({ type, name, parentId = null, geometry, metadata = {}, color = null, icon = null }) {
    if (!TYPES.includes(type)) throw new Error(`Invalid boundary type: ${type}`);
    const boundary = {
      id: generateId(type),
      parentId: parentId || null,
      type,
      name: name || `Untitled ${type}`,
      geometry,
      metadata: { ...metadata, color, icon },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.push(boundary);
    persist();
    sync(MKNexus.ApiClient.createGeoJSON, 'createGeoJSON', { geojson: featureFor(boundary), boundary }, boundary.name).catch(() => {});
    return boundary;
  }

  function update(id, patch) {
    const b = store.find((x) => x.id === id);
    if (!b) return null;
    Object.assign(b, patch, { updatedAt: new Date().toISOString() });
    persist();
    sync(MKNexus.ApiClient.updateGeoJSON, 'updateGeoJSON', { id, geojson: featureFor(b), boundary: b }, b.name).catch(() => {});
    return b;
  }

  function upsertEntity(entity) {
    const existing = getById(entity.id);
    if (existing) {
      if (entity.geometry && !existing.geometry) {
        Object.assign(existing, { geometry: entity.geometry, center: entity.center, area: entity.area, version: entity.version });
        persist();
      }
      return existing;
    }
    const boundary = {
      id: String(entity.id),
      parentId: entity.parentId || null,
      type: entity.type,
      name: entity.name,
      geometry: entity.geometry || null,
      metadata: { ...(entity.metadata || {}) },
      center: entity.center || null,
      area: entity.area || null,
      version: entity.version || 0,
      createdAt: entity.createdAt || new Date().toISOString(),
      updatedAt: entity.updatedAt || new Date().toISOString(),
    };
    store.push(boundary);
    persist();
    return boundary;
  }

  function updateGeometry(id, { entityType, geometry, center, area, version }) {
    const boundary = store.find((item) => item.id === String(id));
    if (!boundary) return null;
    const next = { geometry, center, area, version, updatedAt: new Date().toISOString() };
    Object.assign(boundary, next);
    persist();
    sync(
      // The backend only accepts updateGeoJSON once a GeoJSON row already
      // exists for this entity — confirmed live: it rejects with "No
      // existing geometry for <Type> "<ID>". Use createGeoJSON first."
      // otherwise. Every boundary's very first sync ever attempted was a
      // createGeoJSON call that failed silently from the same EntityID
      // bug fixed above, so nothing has a row yet — this fallback makes
      // the first successful sync for each entity self-heal (create) and
      // every one after that a normal update, with no separate manual
      // "create" pass needed.
      (payload) => postGeoJSON_('updateGeoJSON', payload).catch((error) => {
        if (/use createGeoJSON first/i.test(error.message || '')) {
          return postGeoJSON_('createGeoJSON', payload);
        }
        throw error;
      }),
      'updateGeoJSON',
      { entityId: id, entityType, geometry, center, area, version },
      boundary.name
    ).catch(() => {});
    return boundary;
  }

  function replaceAll(nextStore) {
    store = nextStore.map((boundary) => ({ ...boundary, metadata: { ...(boundary.metadata || {}) } }));
    persist();
    return getAll();
  }

  function duplicate(id) {
    const original = getById(id);
    if (!original) return null;
    return create({
      ...original,
      name: `${original.name} Copy`,
      geometry: JSON.parse(JSON.stringify(original.geometry)),
      metadata: { ...original.metadata, duplicatedFrom: original.id },
    });
  }

  function remove(id) {
    const toRemove = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      store.forEach((b) => {
        if (b.parentId && toRemove.has(b.parentId) && !toRemove.has(b.id)) {
          toRemove.add(b.id);
          changed = true;
        }
      });
    }
    // Captured before filtering — once removed from `store`, there's
    // nothing left to read a name from for the failure toast below.
    const removedNames = new Map(store.filter((b) => toRemove.has(b.id)).map((b) => [b.id, b.name]));
    store = store.filter((b) => !toRemove.has(b.id));
    persist();
    toRemove.forEach((removedId) => sync(MKNexus.ApiClient.deleteGeoJSON, 'deleteGeoJSON', { id: removedId }, removedNames.get(removedId)).catch(() => {}));
    return Array.from(toRemove);
  }

  function getAll() { return store.slice(); }
  function getById(id) { return store.find((b) => b.id === id) || null; }
  function getByType(type) { return store.filter((b) => b.type === type); }
  function getChildren(parentId) { return store.filter((b) => b.parentId === parentId); }

  function toFeatureCollection(list = store) {
    return {
      type: 'FeatureCollection',
      features: list.map((b) => ({
        type: 'Feature',
        id: b.id,
        properties: {
          id: b.id,
          parentId: b.parentId,
          type: b.type,
          name: b.name,
          label: b.metadata?.label || b.name,
          color: b.metadata?.color || null,
          icon: b.metadata?.icon || null,
          ...b.metadata,
        },
        geometry: b.geometry,
      })),
    };
  }

  return { create, update, updateGeometry, upsertEntity, remove, duplicate, replaceAll, hydrate, getEntities, getEntityWithGeometry, getAll, getById, getByType, getChildren, toFeatureCollection, TYPES };
})();