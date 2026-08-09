window.MKNexus = window.MKNexus || {};

/* KPI repository: values are keyed only by boundary ID and synchronized
  through the centralized production API service. */
MKNexus.KPI = (function () {
  const STORAGE_KEY = 'mknexus_kpi_v1';

  const FIELD_DEFS = [
    { key: 'beetTons', label: 'Beet Tons', unit: 'Ton', format: 'integer' },
    { key: 'achievement', label: 'Achievement', unit: '%', format: 'decimal1' },
    { key: 'originalPlan', label: 'Original Plan', unit: 'Ton', format: 'integer' },
    { key: 'truckCount', label: 'Truck Count', unit: '', format: 'integer' },
    { key: 'shippingAverage', label: 'Shipping Average', unit: 'Ton / Truck', format: 'decimal2' },
    { key: 'sugarPercent', label: 'Sugar %', unit: '%', format: 'decimal2' },
    { key: 'tarePercent', label: 'Tare %', unit: '%', format: 'decimal2' },
    { key: 'area', label: 'Area', unit: 'Feddan', format: 'decimal2' },
  ];

  function loadAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  let byId = loadAll();
  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(byId)); }

  // gis-editor-ui.js's list refresh and geo-module.js's selection update
  // both call getForBoundaryAsync() for the same boundary whenever a
  // selection and a list refresh coincide (e.g. right after
  // finishDrawing()/finishEditing()) — this dedupes concurrent requests
  // for the same boundary into a single in-flight fetch instead of firing
  // the backend call twice.
  const inFlight = new Map();

  function firstValue(row, keys) {
    return keys.map((key) => row?.[key]).find((value) => value !== undefined && value !== null && value !== '');
  }

  function numericValue(row, keys) {
    const value = Number(firstValue(row, keys));
    return Number.isFinite(value) ? value : null;
  }

  function normalizeValues(row) {
    return {
      ...row,
      beetTons: numericValue(row, ['BeetTons', 'beetTons', 'BeetTon', 'Beet_Tons', 'Beet Tons']),
      achievement: numericValue(row, ['Achievement', 'achievement', 'AchievementPercent', 'AchievementPercentage', 'achievementPct', 'Achievement %']),
      originalPlan: numericValue(row, ['OriginalPlan', 'originalPlan', 'Original Plan']),
      truckCount: numericValue(row, ['TruckCount', 'truckCount', 'Truck Count']),
      shippingAverage: numericValue(row, ['ShippingAverage', 'shippingAverage', 'Shipping Average']),
      sugarPercent: numericValue(row, ['SugarPercent', 'sugarPercent', 'SugarPct', 'SugarPercentage', 'Sugar', 'Sugar %']),
      tarePercent: numericValue(row, ['TarePercent', 'tarePercent', 'TarePct', 'TarePercentage', 'Tare', 'Tare %']),
      area: numericValue(row, ['Area', 'area', 'AreaFeddan', 'Area_Feddan', 'AreaInFeddan', 'Feddan', 'CultivatedArea']),
    };
  }

  function getForBoundary(boundaryId) {
    return byId[boundaryId] || null;
  }

  async function fetchForBoundary(boundaryId) {
    try {
      const data = await MKNexus.ApiClient.getKPIs({ BoundaryID: boundaryId });
      const rows = Array.isArray(data) ? data : data?.items || data?.rows || data?.kpis || data?.data;
      const values = Array.isArray(rows)
        ? rows.find((row) => String(firstValue(row, ['BoundaryID', 'boundaryId', 'BoundaryId', 'id', 'ID'])) === String(boundaryId)) || (rows.length === 1 ? rows[0] : null)
        : data?.kpi || data?.data || data;
      if (!values || typeof values !== 'object') throw new Error('Backend returned empty KPI data.');
      byId[boundaryId] = normalizeValues(values);
      persist();
      return byId[boundaryId];
    } catch (error) {
      return byId[boundaryId] || null;
    }
  }

  function getForBoundaryAsync(boundaryId) {
    if (inFlight.has(boundaryId)) return inFlight.get(boundaryId);
    const promise = fetchForBoundary(boundaryId).finally(() => inFlight.delete(boundaryId));
    inFlight.set(boundaryId, promise);
    return promise;
  }

  function setForBoundary(boundaryId, values) {
    byId[boundaryId] = { ...getForBoundary(boundaryId), ...values };
    persist();
    return byId[boundaryId];
  }

  return { FIELD_DEFS, getForBoundary, getForBoundaryAsync, setForBoundary };
})();
