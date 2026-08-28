window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Shared utilities. Extracted from the byte-identical copies
   that used to live independently in modules/attendance.js, expenses.js,
   and rent.js (and their three *-client.js API wrappers) — each module
   keeps its own config, action list, and business logic; only this
   generic UI/transport plumbing is now shared. Load this immediately
   after core/config.js, before anything that consumes it. */
MKNexus.Utils = (function () {
  /* ---------------------------------------------------------------
     escapeHtml — every backend/user-controlled string interpolated
     into innerHTML anywhere in the app must go through this first.
  --------------------------------------------------------------- */
  function escapeHtml(value) {
    if (value == null) return '';
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  /* ---------------------------------------------------------------
     isSafeHttpsUrl — guards any backend-supplied URL (PDF links,
     receipt downloads, etc.) before it's used as an href/innerHTML
     attribute or a location.href navigation target. Rejects
     javascript:/data:/relative-scheme tricks; only a real https: URL
     passes.
  --------------------------------------------------------------- */
  function isSafeHttpsUrl(value) {
    if (!value || typeof value !== 'string') return false;
    try {
      return new URL(value, window.location.href).protocol === 'https:';
    } catch {
      return false;
    }
  }

  /* ---------------------------------------------------------------
     isAdmin — UI-level convenience only. This hides/shows admin
     affordances in the client; it is NOT a security boundary — see
     rent-config.js/expenses-config.js's reportAdminKey comments. Kept
     for any other loose "is this an admin?" check; the Roles matrix
     (module visibility, Rent/Expenses report scoping) uses
     MKNexus.Access.isAdmin()/canViewReports() instead — see
     core/access.js — since those need the exact canonical role string,
     not just a loose "contains admin" match.
  --------------------------------------------------------------- */
  function isAdmin() {
    const role = (MKNexus.SessionData?.profile?.role || '').trim().toLowerCase();
    return role.includes('admin');
  }

  function fmtNumber(n, locale = 'ar-EG') {
    return new Intl.NumberFormat(locale).format(n || 0);
  }

  /* ---------------------------------------------------------------
     compareMonthKeys — chronological comparator for "MM-YYYY" month
     keys (Rent/Expenses report filters). A plain `.sort()` on these
     strings is lexicographic, which misorders across a year boundary
     ("01-2026" sorts before "12-2025"). Falls back to a plain string
     compare for anything that isn't in that exact shape, so it's safe
     to use even where the backend's month format turns out to differ.
  --------------------------------------------------------------- */
  function compareMonthKeys(a, b) {
    const parse = (value) => {
      const match = /^(\d{1,2})-(\d{4})$/.exec(String(value || '').trim());
      return match ? Number(match[2]) * 100 + Number(match[1]) : null;
    };
    const pa = parse(a);
    const pb = parse(b);
    if (pa != null && pb != null) return pa - pb;
    return String(a).localeCompare(String(b));
  }

  function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  // Subtle fade+rise on freshly-rendered content — the shared motion
  // language across every module's dynamic content.
  function animateIn(el) {
    if (!el || typeof gsap === 'undefined' || prefersReducedMotion()) return;
    gsap.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' });
  }

  function showLoader(loaderEl, textEl, text) {
    if (textEl) textEl.textContent = text || 'جاري التنفيذ...';
    if (loaderEl) loaderEl.style.display = 'flex';
  }
  function hideLoader(loaderEl) {
    if (loaderEl) loaderEl.style.display = 'none';
  }

  /* ---------------------------------------------------------------
     createApiClient — the request()/timeout/abort/error-normalization
     wrapper shared by AttendanceApi/ExpensesApi/RentApi. Each caller
     supplies its own config (webAppUrl(s), timeoutMs) and gets back an
     independent ApiError subclass + request() — no shared state
     between clients, only shared logic.
  --------------------------------------------------------------- */
  function createApiClient(config, { errorName = 'ApiError', backendLabel = 'backend' } = {}) {
    class ApiError extends Error {
      constructor(message) {
        super(message);
        this.name = errorName;
      }
    }

    async function request(url, { method = 'GET', body } = {}) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetch(url, {
          method,
          // 'text/plain' (not 'application/json') on POST — CORS-preflight
          // -free against Apps Script, which has no doOptions() handler.
          headers: method === 'POST' ? { 'Content-Type': 'text/plain;charset=utf-8' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        if (!response.ok) throw new ApiError(`Backend request failed with HTTP ${response.status}.`);
        const data = await response.json();
        if (data?.error) throw new ApiError(data.error);
        return data;
      } catch (error) {
        if (error?.name === 'AbortError') throw new ApiError('Backend request timed out.');
        if (error instanceof ApiError) throw error;
        throw new ApiError(`Unable to reach the ${backendLabel} backend.`);
      } finally {
        window.clearTimeout(timeout);
      }
    }

    return { ApiError, request };
  }

  return {
    escapeHtml, isSafeHttpsUrl, isAdmin, fmtNumber, compareMonthKeys, prefersReducedMotion,
    animateIn, showLoader, hideLoader, createApiClient,
  };
})();
