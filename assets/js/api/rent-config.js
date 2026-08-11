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
  paymentUrl: 'https://script.google.com/macros/s/AKfycbwbYLiAhTW-MRV_htrUFnFOlkOnQVNIpwXTuAo50hIsgUvuEDhI5tQmYG-X_P_LDUu0og/exec',
  // Admin-facing: full paid/unpaid report across all offices. Used to be
  // a second, separate deployment that never implemented getRentReport
  // (see backend/rent/README.md) — that action now lives directly in the
  // same project as paymentUrl, so this points at the same URL. If you
  // ever move the report back to its own deployment, put its URL here
  // instead.
  reportUrl: 'https://script.google.com/macros/s/AKfycbwbYLiAhTW-MRV_htrUFnFOlkOnQVNIpwXTuAo50hIsgUvuEDhI5tQmYG-X_P_LDUu0og/exec',
  // The report endpoint's only access control today — a static key baked
  // into the original frontend's source. Pre-existing on the backend side;
  // carried over unchanged, not something introduced or hardened here.
  reportAdminKey: 'mk_admin_2025',
  timeoutMs: 20000,
});
