window.MKNexus = window.MKNexus || {};

MKNexus.ApiClient = (function () {
  const config = MKNexus.ApiConfig;
  const listeners = new Set();

  class ApiError extends Error {
    constructor(message, { code = 'API_ERROR', status = 0, details = [] } = {}) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  }

  function notify(state) {
    listeners.forEach((listener) => {
      try { listener(state); } catch (error) { console.warn('[MK Nexus] API state listener failed:', error); }
    });
  }

  function onStateChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function resolveAction(actionKey) {
    if (!config.actions.includes(actionKey)) {
      throw new ApiError(`Backend action is not registered: ${actionKey}`, {
        code: 'UNSUPPORTED_ACTION',
      });
    }
    return actionKey;
  }

  function createUrl(action, params) {
    const url = new URL(config.baseUrl);
    url.searchParams.set('action', action);
    const sessionToken = sessionStorage.getItem(config.sessionStorageKey) || localStorage.getItem(config.sessionStorageKey);
    if (sessionToken) url.searchParams.set('sessionToken', sessionToken);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    });
    return url;
  }

  function validateResponse(payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.success !== 'boolean') {
      throw new ApiError('Backend returned an invalid response envelope.', { code: 'INVALID_RESPONSE' });
    }
    if (!payload.success) {
      const unauthorized = /unauthori[sz]ed|forbidden|permission|session/i.test(payload.message || '');
      throw new ApiError(payload.message || 'Backend request failed.', {
        code: unauthorized ? 'UNAUTHORIZED' : 'BACKEND_ERROR',
        details: Array.isArray(payload.errors) ? payload.errors : [],
      });
    }
    return payload;
  }

  async function request(actionKey, params = {}, { signal, method = 'GET' } = {}) {
    const action = resolveAction(actionKey);
    const requestMethod = config.postActions.includes(action) ? 'POST' : method;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), config.timeoutMs);
    if (signal?.aborted) controller.abort();
    else if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    notify({ loading: true, action: actionKey });

    try {
      const sessionToken = sessionStorage.getItem(config.sessionStorageKey) || localStorage.getItem(config.sessionStorageKey);
      const body = { action, ...params, ...(sessionToken ? { sessionToken } : {}) };
      const response = await fetch(requestMethod === 'GET' ? createUrl(action, params) : createUrl(action, {}), {
        method: requestMethod,
        // Apps Script web apps don't implement doOptions(), so a POST sent
        // with 'application/json' (a non-simple content-type) triggers a
        // CORS preflight the backend can't answer — the request never
        // fires and fetch throws, which read here as "unreachable" even
        // though the server is up. 'text/plain' is CORS-safelisted (no
        // preflight); Apps Script's e.postData.contents is the raw body
        // either way, so doPost() still JSON.parses it unchanged.
        headers: { Accept: 'application/json', ...(requestMethod === 'POST' ? { 'Content-Type': 'text/plain;charset=utf-8' } : {}) },
        ...(requestMethod === 'POST' ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        credentials: 'omit',
      });
      if (response.status === 401 || response.status === 403) {
        throw new ApiError('Your session is not authorized for this backend.', { code: 'UNAUTHORIZED', status: response.status });
      }
      if (!response.ok) {
        throw new ApiError(`Backend request failed with HTTP ${response.status}.`, { code: 'HTTP_ERROR', status: response.status });
      }
      let payload;
      try { payload = validateResponse(await response.json()); } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError('Backend returned invalid JSON.', { code: 'INVALID_JSON', status: response.status });
      }
      notify({ loading: false, action: actionKey, success: true });
      return payload.data;
    } catch (error) {
      const apiError = error.name === 'AbortError'
        ? new ApiError('Backend request timed out.', { code: 'TIMEOUT' })
        : error instanceof ApiError
          ? error
          : new ApiError('Unable to reach the production backend.', { code: 'NETWORK_ERROR', details: [error.message] });
      notify({ loading: false, action: actionKey, success: false, error: apiError });
      throw apiError;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function login(credentials) {
    const data = await request('login', credentials, { method: 'POST' });
    const token = data?.sessionToken || data?.token;
    if (token) sessionStorage.setItem(config.sessionStorageKey, token);
    return data;
  }

  async function validateSession() {
    return request('validateSession', {}, { method: 'POST' });
  }

  const service = { ApiError, onStateChange, request, login, validateSession };
  config.actions.forEach((action) => {
    if (service[action]) return;
    service[action] = (params = {}, options = {}) => request(action, params, options);
  });
  return Object.freeze(service);
})();
