window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Attendance module API client. Same request wrapper shape as
   rent-client.js/expenses-client.js — now literally shared via
   MKNexus.Utils.createApiClient (core/utils.js) instead of each client
   re-implementing an identical timeout/abort/error-normalization copy. */
MKNexus.AttendanceApi = (function () {
  const config = MKNexus.AttendanceConfig;
  const { ApiError: AttendanceApiError, request } = MKNexus.Utils.createApiClient(config, {
    errorName: 'AttendanceApiError',
    backendLabel: 'Attendance',
  });

  // SECURITY (server-side action required, see final report): `role` and
  // `region` below are read from the client's own in-memory session
  // profile and sent as plain query params — nothing stops a user from
  // calling MKNexus.AttendanceApi.getAttendance({ role: 'admin', region:
  // 'ALL', ... }) directly from devtools. If the backend uses these
  // values to decide what to return (rather than deriving them itself
  // from the caller's authenticated identity), this is a full
  // authorization bypass. Cannot be closed from the client — the backend
  // must ignore/verify these against the session's own record.
  //
  // Returns whatever the backend sent, unmodified (see rent-client.js's
  // getRentReport() for why non-array responses aren't silently coerced).
  function getAttendance({ role, region, date }) {
    const url = new URL(config.webAppUrl);
    url.searchParams.set('action', 'attendance');
    url.searchParams.set('role', role || '');
    url.searchParams.set('region', region || '');
    url.searchParams.set('date', date || '');
    return request(url.toString());
  }

  return { AttendanceApiError, getAttendance };
})();
