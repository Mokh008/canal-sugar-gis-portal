window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Rent module backend config.
   The Rent module talks to a Google Apps Script deployment (ported from
   the standalone site at mokh008.github.io/Rent-Payment-UI), NOT the Geo
   Intelligence backend in api/config.js — different project, different
   action set. paymentUrl/reportUrl used to be two separate deployments;
   getRentReport was merged into the one project so both now point at the
   same URL (see backend/rent/Code.gs and its README). */
MKNexus.RentConfig = Object.freeze({
  // Redeployed (new deployment, hence the URL change) with
  // getRentReport merged in — see backend/rent/Code.gs. paymentUrl and
  // reportUrl are the same URL on purpose now: one project serves both
  // the engineer-facing actions and the admin report. If you ever move
  // the report back to its own deployment, give reportUrl its own URL
  // again instead.
  paymentUrl: 'https://script.google.com/macros/s/AKfycbw9pvWJ-5KCCI5CQj_-G8V0lsYf6kC8uoa-O0lpkBDAtQPFDznVKXe1BYPHTxTldGJDiQ/exec',
  reportUrl: 'https://script.google.com/macros/s/AKfycbw9pvWJ-5KCCI5CQj_-G8V0lsYf6kC8uoa-O0lpkBDAtQPFDznVKXe1BYPHTxTldGJDiQ/exec',
  // The report endpoint's only access control today — a static key baked
  // into the original frontend's source. Pre-existing on the backend side;
  // carried over unchanged, not something introduced or hardened here.
  reportAdminKey: 'mk_admin_2025',
  timeoutMs: 20000,
});
