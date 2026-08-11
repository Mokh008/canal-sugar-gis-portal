window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Expenses module backend config. Ported from the standalone
   site at mokh008.github.io/Expenses-System — a single Apps Script
   deployment handles both the engineer-facing form and the admin report
   (unlike Rent, which uses two separate deployments). Nothing below was
   invented: the URL/actions/params/payload shape match that site's live
   source exactly, including that the submit POST carries no `action`
   field at all — so the real backend keeps working unmodified. */
MKNexus.ExpensesConfig = Object.freeze({
  // Redeployed (new deployment, not "new version" of the old one, hence
  // the URL change) to ship getExpensesReport() — see
  // backend/expenses/Code.gs and its README.
  webAppUrl: 'https://script.google.com/macros/s/AKfycbyy_32N_DivnXIQFM1AciOcmMc3lFEJU1QLy0rGLR2B0wr0ESOtnWTntUscuvqcn9NU/exec',
  // Same pre-existing, backend-side-only access control as the Rent
  // report — carried over unchanged.
  reportAdminKey: 'mk_admin_2025',
  // Subsistence rate per attended day — computed client-side in the
  // source site (not returned by the backend), preserved as-is.
  livingRatePerDay: 200,
  timeoutMs: 20000,
});
