window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Expenses module API client. Same request wrapper shape as
   api/rent-client.js — now literally shared via MKNexus.Utils.createApiClient
   (core/utils.js) instead of each client re-implementing an identical
   timeout/abort/error-normalization copy. */
MKNexus.ExpensesApi = (function () {
  const config = MKNexus.ExpensesConfig;
  const { ApiError: ExpensesApiError, request } = MKNexus.Utils.createApiClient(config, {
    errorName: 'ExpensesApiError',
    backendLabel: 'Expenses',
  });

  // SECURITY (server-side action required, see final report): `engineerId`
  // below is free-text client input with no ownership check enforceable
  // from here — any authenticated user can request another engineer's
  // attendance/expense history, or submit an expense claim under another
  // engineer's ID, by simply typing a different ID. The backend must
  // verify the caller is authorized for the requested engineerId (or
  // derive it from the caller's own session) rather than trusting it
  // verbatim from the request.
  function getDays(engineerId, month) {
    const url = new URL(config.webAppUrl);
    url.searchParams.set('action', 'getDays');
    url.searchParams.set('id', engineerId);
    url.searchParams.set('month', month);
    return request(url.toString()).then((data) => (Array.isArray(data) ? data : []));
  }

  // SECURITY (server-side action required, see final report): `total`
  // and `transport` are computed client-side (modules/expenses.js) and
  // sent as-is — nothing here stops a modified request from claiming an
  // arbitrary reimbursement amount. The backend must recompute
  // total/transport from `days`/`breakdown` server-side and reject (or
  // ignore) the client-supplied figures rather than persisting them
  // unmodified.
  //
  // No `action` key on purpose — the source site's doPost() takes this
  // exact shape unconditionally (see api/expenses-config.js header note).
  function submitExpenses({ id, month, days, total, breakdown, transport, electricity }) {
    return request(config.webAppUrl, {
      method: 'POST',
      body: { id, month, days, total, breakdown, transport, electricity },
    });
  }

  // SECURITY (server-side action required, see final report): `adminKey`
  // is a static literal shipped in this public JS bundle (see
  // expenses-config.js) — readable via view-source by any visitor, not a
  // real secret. The UI only hides the Report tab from Engineer/
  // Supervisor (MKNexus.Access.canViewReports() in modules/expenses.js)
  // and further scopes it to "my sector" for Section Manger/Manager
  // (core/data/team-directory.js) — but this call itself has no
  // server-enforceable authorization. Anyone can call
  // MKNexus.ExpensesApi.getExpensesReport() directly and receive every
  // engineer's full expense history. The backend must authenticate the
  // caller's real session/role instead of accepting this key.
  //
  // Returns whatever the backend sent, unmodified — see rent-client.js's
  // getRentReport() for why this isn't coerced to an array here.
  function getExpensesReport() {
    const url = new URL(config.webAppUrl);
    url.searchParams.set('action', 'getExpensesReport');
    url.searchParams.set('adminKey', config.reportAdminKey);
    return request(url.toString());
  }

  return { ExpensesApiError, getDays, submitExpenses, getExpensesReport };
})();
