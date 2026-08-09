window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Rent module backend config.
   The Rent module talks to two separate, pre-existing Google Apps Script
   deployments (ported from the standalone site at
   mokh008.github.io/Rent-Payment-UI), NOT the Geo Intelligence backend in
   api/config.js — different project, different action set. Nothing below
   was invented: URLs/actions/params/param casing match that site's live
   source exactly, so the real backends keep working unmodified. */
MKNexus.RentConfig = Object.freeze({
  // Engineer-facing: list assets for an engineer ID, confirm a payment,
  // generate a receipts PDF.
  paymentUrl: 'https://script.google.com/macros/s/AKfycbyixFl0gSyLbqnzLwjbW7a5UWA7PCohqfqxQeApCef3GJE3q4ItvHh2KZvlWpuW5zEmNA/exec',
  // Admin-facing: full paid/unpaid report across all offices. A different
  // deployment on purpose (matches the source site) — keep them separate
  // rather than merging into one URL.
  reportUrl: 'https://script.google.com/macros/s/AKfycbymN-eiB6AR8LsK31ssWhYtCSq7uzk2qYU3LVLKkx1HM_OhRxa7zC10zFmj47zFDsaAUg/exec',
  // The report endpoint's only access control today — a static key baked
  // into the original frontend's source. Pre-existing on the backend side;
  // carried over unchanged, not something introduced or hardened here.
  reportAdminKey: 'mk_admin_2025',
  timeoutMs: 20000,
});
