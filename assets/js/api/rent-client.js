window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Rent module API client. Same shape as api/client.js (timeout,
   abort, error normalization) but scoped to RentConfig's two backends —
   now literally shared via MKNexus.Utils.createApiClient (core/utils.js)
   instead of each client re-implementing an identical copy. */
MKNexus.RentApi = (function () {
  const config = MKNexus.RentConfig;
  const { ApiError: RentApiError, request } = MKNexus.Utils.createApiClient(config, {
    errorName: 'RentApiError',
    backendLabel: 'Rent',
  });

  // SECURITY (server-side action required, see final report): `engineerId`
  // below is free-text client input with no ownership check enforceable
  // from here — any authenticated user can list another engineer's
  // office/rent assets, or (via confirmPayment below) record a payment
  // under another engineer's ID, by simply typing a different ID. The
  // backend must verify the caller is authorized for the requested
  // engineerId rather than trusting it verbatim from the request.
  //
  // doGet's getAssets returns { assets: [...], paidMonths: { [assetName]: ["MM-YYYY", ...] } } —
  // both are used (paidMonths marks already-paid months in the month picker).
  function getAssets(engineerId) {
    const url = new URL(config.paymentUrl);
    url.searchParams.set('action', 'getAssets');
    url.searchParams.set('engineerId', engineerId);
    return request(url.toString()).then((data) => ({
      assets: data?.assets || (Array.isArray(data) ? data : []),
      paidMonths: data?.paidMonths || {},
    }));
  }

  function confirmPayment({ engineerId, assetName, month }) {
    return request(config.paymentUrl, { method: 'POST', body: { action: 'confirmPayment', engineerId, assetName, month } });
  }

  function printReceipts({ engineerId, month }) {
    return request(config.paymentUrl, { method: 'POST', body: { action: 'printReceipts', engineerId, month } });
  }

  // SECURITY (server-side action required, see final report): `adminKey`
  // is a static literal shipped in this public JS bundle (see
  // rent-config.js) — readable via view-source by any visitor, not a real
  // secret. The UI only hides the Report tab from Engineer/Supervisor
  // (MKNexus.Access.canViewReports() in modules/rent.js) and further
  // scopes it to "my sector" for Section Manger/Manager
  // (core/data/team-directory.js) — but this call itself has no
  // server-enforceable authorization. Anyone can call
  // MKNexus.RentApi.getRentReport() directly and receive every office's
  // full paid/unpaid rent history. The backend must authenticate the
  // caller's real session/role instead of accepting this key.
  //
  // Returns whatever the backend actually sent, unmodified — the source
  // site distinguishes "a real empty array" (no rent data yet) from "a
  // non-array response" (the getRentReport action isn't implemented /
  // misconfigured on this deployment) and shows a different message for
  // each; silently coercing both to [] here would hide that distinction
  // from modules/rent.js.
  function getRentReport() {
    const url = new URL(config.reportUrl);
    url.searchParams.set('action', 'getRentReport');
    url.searchParams.set('adminKey', config.reportAdminKey);
    return request(url.toString());
  }

  return { RentApiError, getAssets, confirmPayment, printReceipts, getRentReport };
})();
