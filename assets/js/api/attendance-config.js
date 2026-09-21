window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Attendance module backend config. Ported from the standalone
   site at mokh008.github.io/Attendance-Dashboard — a single Apps Script
   deployment with one read action. Nothing below was invented: the
   URL/action/params match that site's live source exactly. */
MKNexus.AttendanceConfig = Object.freeze({
  webAppUrl: 'https://script.google.com/macros/s/AKfycbz3uMeKx0YQ4yPZeBGT3yRJNEiO8sJjD4Rk3D9ZTmw-g12yieKamCVGu2yzOvjbWO8ZdQ/exec',
  // Auto-refresh interval — matches the source site's setInterval.
  // Pause between the END of one refresh and the start of the next.
  refreshMs: 30000,
  // The attendance Apps Script is slow: measured 25-36 s per call (for a
  // ~1 KB answer). 20 s made every call time out; 90 s leaves headroom for
  // a cold start.
  timeoutMs: 90000,
});
