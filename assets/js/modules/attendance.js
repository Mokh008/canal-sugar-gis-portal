window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Attendance module. Ported from the standalone site at
   mokh008.github.io/Attendance-Dashboard into the MK Nexus shell/design
   system. Backend contract untouched — see api/attendance-config.js.

   Differences from the source site, by design (same choices as the
   Rent/Expenses ports):
     - MK Nexus tokens instead of the source's own mk-theme.css; Chart.js
       colors are hardcoded to match those tokens (Chart.js needs literal
       color values, not CSS custom properties).
     - No separate login/auth-guard redirect — you're already
       authenticated to be inside the shell at all.
     - Card top-accent line, KPI icons, hover-lift, and a GSAP entrance
       fade — same visual language as the Rent/Expenses modules.

   WHO YOU SEE COMES FROM THE ORG CHART. The source site (and this port,
   until now) shipped a hardcoded engineer-name -> region table. That table
   is gone: the regions on this dashboard are the Org Chart's regions, and
   the people in each are whoever the Org Chart says are that region's
   engineers (see core/data/team-directory.js / backend directory.gs):
   an administration manager sees the engineers of their administration's
   regions, a sector head sees their whole sector, Admin sees everyone
   (plus a group of active Engineer/Supervisor accounts placed nowhere yet,
   so a gap in the Org Chart is visible instead of silently missing).

   A fingerprint row is matched to a person by its `engineerId` (the same
   number as Users.EngineerID — exact, no spelling to get wrong), and only
   when the row has none by NAME: Users.AttendanceName if that optional
   column is filled in (the name exactly as the fingerprint device prints
   it), otherwise their full name. Rows that match nobody on the viewer's
   team are ignored; for Admin they're listed under the dashboard so a
   missing EngineerID / misspelled name can be fixed.

   THE ATTENDANCE BACKEND IS SLOW (measured: 25-36 s to answer with a
   ~1 KB payload), so this screen never waits on it to draw: the team's
   regions and people are drawn immediately from the Org Chart, the
   fingerprints fill in when they arrive, and the next refresh is
   scheduled only after the previous one finished (a fixed 30 s interval
   used to start a new request while the last was still running). */
MKNexus.AttendanceModule = (function () {
  let containerEl = null;
  let dateInput, totalCountEl, inCountEl, outCountEl, userBadgeEl, departmentsBoxEl, unmatchedBoxEl;
  let barChart = null;
  let pieChart = null;
  let refreshTimer = null;
  let statusEl, chartsGridEl;

  // Built from the Org Chart on every mount (see applyScope()).
  let groups = []; // [{ key, title, subtitle, members: [teamMember] }] — one per region
  let allMembers = [];
  let memberById = new Map(); // engineerId (string) -> teamMember
  let memberByName = new Map(); // normalized fingerprint name -> teamMember
  let mountId = 0;
  let requestSeq = 0; // a response older than the latest request is ignored
  let hasData = false; // fingerprints for the selected date have arrived at least once

  /* -------------------------------------------------------------------
     Utilities — escapeHtml/prefersReducedMotion/animateIn now live in
     core/utils.js, shared with the Rent/Expenses modules instead of each
     re-implementing an identical copy.
  ------------------------------------------------------------------- */
  const escapeHtml = MKNexus.Utils.escapeHtml;

  function shortName(n) {
    if (!n) return '';
    const p = n.trim().split(' ');
    return p.length >= 2 ? `${p[0]} ${p[1]}` : n;
  }

  function formatSheetTime(t) {
    if (!t) return '';
    const d = new Date(t);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  }

  function getUserRole() {
    return (MKNexus.SessionData?.profile?.role || '').trim().toLowerCase();
  }

  // Fingerprint names and Users names are typed by different people —
  // compare them ignoring case and stray/double spaces.
  function normalizeName(n) {
    return String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // Turns the Org Chart scope into the region groups this dashboard draws.
  function applyScope() {
    const scope = MKNexus.TeamDirectory.getScope();
    const byRegion = new Map();
    scope.team.forEach((member) => {
      if (!byRegion.has(member.regionId)) {
        byRegion.set(member.regionId, { key: member.regionId, title: member.regionName, subtitle: member.administrationName, members: [] });
      }
      byRegion.get(member.regionId).members.push(member);
    });
    groups = [...byRegion.values()].sort((a, b) =>
      (a.subtitle || '').localeCompare(b.subtitle || '', 'ar') || (a.title || '').localeCompare(b.title || '', 'ar'));
    if (scope.unassigned.length) {
      groups.push({ key: '__unassigned__', title: 'غير موزّعين', subtitle: 'لم يتم وضعهم في أي منطقة بعد', members: scope.unassigned });
    }

    allMembers = groups.flatMap((g) => g.members);
    memberById = new Map();
    memberByName = new Map();
    allMembers.forEach((member) => {
      const engineerId = String(member.engineerId ?? '').trim();
      if (engineerId && !memberById.has(engineerId)) memberById.set(engineerId, member);
      [member.attendanceName, member.name].map(normalizeName).filter(Boolean).forEach((key) => {
        if (!memberByName.has(key)) memberByName.set(key, member);
      });
    });
  }

  function findMember(row) {
    return memberById.get(String(row.engineerId ?? '').trim()) || memberByName.get(normalizeName(row.name));
  }

  const prefersReducedMotion = MKNexus.Utils.prefersReducedMotion;
  const animateIn = MKNexus.Utils.animateIn;

  /* -------------------------------------------------------------------
     Template
  ------------------------------------------------------------------- */
  function template() {
    return `
      <div class="attendance-module" dir="rtl">
        <div class="attendance-module__header">
          <div class="attendance-module__heading">
            <span class="type-eyebrow attendance-module__eyebrow">ATTENDANCE OPERATIONS</span>
            <h1 class="attendance-module__title">لوحة متابعة الحضور</h1>
            <p class="attendance-module__subtitle">حضور وانصراف مهندسي فريقك حسب المنطقة، بتحديث تلقائي كل 30 ثانية</p>
          </div>
          <span class="attendance-module__badge" id="attUserBadge"></span>
        </div>

        <div class="attendance-datebar">
          <i class="fa-regular fa-calendar"></i>
          <input type="date" class="attendance-date-input" id="attDatePicker">
        </div>

        <div class="attendance-status" id="attStatus" hidden></div>

        <div class="attendance-kpi-strip">
          <div class="attendance-kpi"><span class="attendance-kpi__icon"><i class="fa-solid fa-users"></i></span><span class="attendance-kpi__label">إجمالي المهندسين</span><span class="attendance-kpi__value" id="attTotalCount">0</span></div>
          <div class="attendance-kpi"><span class="attendance-kpi__icon attendance-kpi__icon--success"><i class="fa-solid fa-user-check"></i></span><span class="attendance-kpi__label">حضر</span><span class="attendance-kpi__value attendance-kpi__value--success" id="attInCount">0</span></div>
          <div class="attendance-kpi"><span class="attendance-kpi__icon attendance-kpi__icon--danger"><i class="fa-solid fa-user-xmark"></i></span><span class="attendance-kpi__label">غاب</span><span class="attendance-kpi__value attendance-kpi__value--danger" id="attOutCount">0</span></div>
        </div>

        <div class="attendance-charts-grid" id="attChartsGrid" hidden>
          <div class="attendance-card attendance-chart-card"><canvas id="attDeptChart"></canvas></div>
          <div class="attendance-card attendance-chart-card"><canvas id="attPieChart"></canvas></div>
        </div>

        <div class="attendance-dept-grid" id="attDepartmentsBox"></div>
        <div class="attendance-unmatched" id="attUnmatchedBox" hidden></div>
      </div>`;
  }

  /* -------------------------------------------------------------------
     Rendering
  ------------------------------------------------------------------- */
  function buildAttRow(name, loc, time) {
    return `
      <div class="attendance-row">
        <div class="attendance-row__top">
          <span class="attendance-row__name">${escapeHtml(shortName(name))}</span>
          <span class="attendance-row__time"><i class="fa-regular fa-clock"></i> ${escapeHtml(formatSheetTime(time))}</span>
        </div>
        <span class="attendance-row__loc"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(loc || '')}</span>
      </div>`;
  }

  function renderGroups(stats) {
    const emptyRow = "<span class='attendance-empty-hint'>-</span>";

    if (!groups.length) {
      const hint = MKNexus.Access.isAdmin()
        ? 'لسه محدش متوزّع على مناطق — وزّع المهندسين من موديول Org Chart.'
        : 'مفيش مهندسين تابعين ليك في الهيكل التنظيمي. الأدمن بيوزّعهم من موديول Org Chart.';
      departmentsBoxEl.innerHTML = `<div class="attendance-card attendance-empty-state">${escapeHtml(hint)}</div>`;
      return;
    }

    departmentsBoxEl.innerHTML = groups.map((group) => {
      const stat = stats.get(group.key);
      const present = group.members.filter((m) => stat.inById.has(m.userId));
      const absent = group.members.filter((m) => !stat.inById.has(m.userId));
      const notOut = present.filter((m) => !stat.outById.has(m.userId));
      const leftMembers = group.members.filter((m) => stat.outById.has(m.userId));

      const rowsOf = (list, byId) => list.map((m) => { const r = byId.get(m.userId); return buildAttRow(r.name, r.location, r.time); }).join('') || emptyRow;
      const chipsOf = (list) => list.map((m) => `<span class="attendance-name-chip">${escapeHtml(shortName(m.name))}</span>`).join('') || emptyRow;

      return `
        <div class="attendance-card attendance-dept-card">
          <h4 class="attendance-dept-card__title">${escapeHtml(group.title)}${group.subtitle ? ` <small class="attendance-dept-card__sub">${escapeHtml(group.subtitle)}</small>` : ''}</h4>
          <div class="attendance-split">
            <div class="attendance-inner-box"><b>حضر (${present.length})</b>${rowsOf(present, stat.inById)}</div>
            <div class="attendance-inner-box"><b>غاب (${absent.length})</b>${chipsOf(absent)}</div>
          </div>
          <div class="attendance-split attendance-split--out">
            <div class="attendance-inner-box"><b>انصرف (${leftMembers.length})</b>${rowsOf(leftMembers, stat.outById)}</div>
            <div class="attendance-inner-box"><b>لم يبصم انصراف</b>${chipsOf(notOut)}</div>
          </div>
        </div>`;
    }).join('');

    animateIn(departmentsBoxEl);
  }

  // Fingerprint names that match nobody on the viewer's team. Only worth
  // showing to an Admin (for everyone else it is simply the rest of the
  // company) — it is how a misspelled name gets noticed and fixed via the
  // user's AttendanceName.
  function renderUnmatched(names) {
    if (!MKNexus.Access.isAdmin() || !names.length) { unmatchedBoxEl.hidden = true; unmatchedBoxEl.innerHTML = ''; return; }
    unmatchedBoxEl.hidden = false;
    unmatchedBoxEl.innerHTML = `
      <details class="attendance-card">
        <summary>بصمات لأسماء غير مسجّلة في الهيكل (${names.length})</summary>
        <p class="attendance-unmatched__hint">لو الاسم ده لمهندس، طابقه مع اسم المستخدم أو حط الاسم كما يظهر في جهاز البصمة في خانة «اسم البصمة» من الإعدادات.</p>
        <div>${names.map((n) => `<span class="attendance-name-chip">${escapeHtml(n)}</span>`).join('')}</div>
      </details>`;
  }

  function drawCharts(stats, inCount, roleTotal) {
    if (typeof Chart === 'undefined') return;
    if (barChart) barChart.destroy();
    if (pieChart) pieChart.destroy();

    const gridColor = 'rgba(255, 255, 255, 0.05)';
    const labelColor = '#86988f';

    const baseOpts = {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: window.innerWidth < 600 ? 1.3 : 2,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(9, 33, 27, 0.92)', borderColor: 'rgba(82, 201, 155, 0.3)',
          borderWidth: 1, titleColor: '#f1f5f3', bodyColor: '#b9c9c2', padding: 12, cornerRadius: 10,
        },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: labelColor, maxRotation: 30 } },
        y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: labelColor } },
      },
    };

    barChart = new Chart(document.getElementById('attDeptChart'), {
      type: 'bar',
      data: {
        labels: groups.map((g) => g.title),
        datasets: [{
          data: groups.map((g) => stats.get(g.key)?.inById.size || 0),
          backgroundColor: 'rgba(82, 201, 155, 0.7)',
          borderColor: '#3a9678',
          borderWidth: 1,
          borderRadius: 8,
        }],
      },
      options: {
        ...baseOpts,
        plugins: { ...baseOpts.plugins, title: { display: true, text: 'حضور حسب المنطقة', color: '#b9c9c2', font: { size: 13 } } },
      },
    });

    pieChart = new Chart(document.getElementById('attPieChart'), {
      type: 'doughnut',
      data: {
        labels: ['حضر', 'غاب'],
        datasets: [{
          data: [inCount, roleTotal - inCount],
          backgroundColor: ['rgba(82, 201, 155, 0.85)', 'rgba(224, 122, 106, 0.75)'],
          borderColor: ['#52c99b', '#e07a6a'],
          borderWidth: 2,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#b9c9c2', font: { size: 12 }, padding: 16 } },
          tooltip: baseOpts.plugins.tooltip,
        },
      },
    });
  }

  function emptyStats() {
    return new Map(groups.map((g) => [g.key, { inById: new Map(), outById: new Map() }]));
  }

  function setStatus(text, isError) {
    statusEl.hidden = !text;
    statusEl.textContent = text || '';
    statusEl.classList.toggle('attendance-status--error', Boolean(isError));
  }

  // Draws the team (regions + people, everyone still "absent") without any
  // fingerprint data — what the screen shows while the slow attendance
  // backend is still answering, instead of a blank page of zeros.
  function showStructure() {
    hasData = false;
    totalCountEl.textContent = String(allMembers.length);
    inCountEl.textContent = '…';
    outCountEl.textContent = '…';
    chartsGridEl.hidden = true;
    renderGroups(emptyStats());
    renderUnmatched([]);
  }

  function scheduleNext() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(loadDashboard, MKNexus.AttendanceConfig.refreshMs);
  }

  function loadDashboard() {
    const date = dateInput.value;
    const seq = ++requestSeq;
    const stillCurrent = () => seq === requestSeq && Boolean(containerEl);
    window.clearTimeout(refreshTimer);
    const kpiStrip = containerEl?.querySelector('.attendance-kpi-strip');
    kpiStrip?.classList.add('is-loading');
    // Only the very first load of a date is worth announcing — background
    // refreshes update the screen silently.
    if (!hasData) setStatus('جاري تحميل البصمات… خادم الحضور بطيء وممكن ياخد لحد دقيقة.');
    // `region` is always 'ALL' now: which people you see is decided by the
    // Org Chart (applyScope), not by a region string handed to the backend.
    MKNexus.AttendanceApi.getAttendance({ role: getUserRole(), region: 'ALL', date })
      .then((rows) => {
        if (!stillCurrent()) return;
        if (!Array.isArray(rows)) { setStatus('رد غير متوقع من خادم الحضور.', true); return; }

        // Per region: who scanned IN / OUT today, keyed by user. Only the
        // first IN/OUT scan of the day is kept per person — a duplicate
        // scan used to inflate the row lists without inflating the counts,
        // so the two disagreed whenever someone scanned twice.
        const stats = emptyStats();
        const groupOf = new Map();
        groups.forEach((g) => g.members.forEach((m) => groupOf.set(m.userId, g.key)));
        const unmatched = new Set();

        rows.forEach((r) => {
          const member = findMember(r);
          if (!member) { if (r.name) unmatched.add(String(r.name).trim()); return; }
          const stat = stats.get(groupOf.get(member.userId));
          const status = (r.status || r.Action || '').trim().toUpperCase();
          if (status === 'IN' && !stat.inById.has(member.userId)) stat.inById.set(member.userId, r);
          if (status === 'OUT' && !stat.outById.has(member.userId)) stat.outById.set(member.userId, r);
        });

        const total = allMembers.length;
        const presentCount = [...stats.values()].reduce((sum, st) => sum + st.inById.size, 0);

        hasData = true;
        setStatus('');
        totalCountEl.textContent = String(total);
        inCountEl.textContent = String(presentCount);
        outCountEl.textContent = String(total - presentCount);

        chartsGridEl.hidden = false;
        renderGroups(stats);
        renderUnmatched([...unmatched].sort());
        drawCharts(stats, presentCount, total);
      })
      .catch((error) => {
        if (!stillCurrent()) return;
        // Auto-retries after refreshMs, so keep whatever is on screen and
        // just say what happened — a full error page would flicker on every
        // transient failure.
        setStatus(`تعذر تحميل البصمات (${error?.message || 'خطأ غير معروف'}) — هتتعاد المحاولة تلقائياً.`, true);
        MKNexus.Toast?.error(error?.message || 'Couldn\u2019t refresh attendance data — showing the last known values.');
      })
      .finally(() => {
        if (!stillCurrent()) return;
        kpiStrip?.classList.remove('is-loading');
        scheduleNext(); // after this one finished, never while it is still running
      });
  }

  /* -------------------------------------------------------------------
     Mount / unmount
  ------------------------------------------------------------------- */
  function cacheDom() {
    dateInput = document.getElementById('attDatePicker');
    totalCountEl = document.getElementById('attTotalCount');
    inCountEl = document.getElementById('attInCount');
    outCountEl = document.getElementById('attOutCount');
    userBadgeEl = document.getElementById('attUserBadge');
    departmentsBoxEl = document.getElementById('attDepartmentsBox');
    unmatchedBoxEl = document.getElementById('attUnmatchedBox');
    statusEl = document.getElementById('attStatus');
    chartsGridEl = document.getElementById('attChartsGrid');
  }

  function mount(container) {
    containerEl = container;
    container.innerHTML = template();
    cacheDom();
    const thisMount = ++mountId;

    const profile = MKNexus.SessionData?.profile;
    const position = profile?.positions?.[0]?.path;
    userBadgeEl.textContent = profile?.name ? `${profile.name} • ${position || profile.role || ''}` : '';

    dateInput.value = new Date().toLocaleDateString('en-CA');
    // Another date = another set of fingerprints: back to the bare team
    // until they arrive, so yesterday's scans are never shown as today's.
    dateInput.addEventListener('change', () => { showStructure(); loadDashboard(); });

    if (typeof gsap !== 'undefined' && !prefersReducedMotion()) {
      gsap.fromTo([containerEl.querySelector('.attendance-module__header'), containerEl.querySelector('.attendance-datebar')],
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' });
    }

    // The team must be known before the first render — it decides who is
    // on the dashboard at all. Bail out if the user navigated away (or
    // re-opened this module) while the Org Chart scope was loading.
    MKNexus.TeamDirectory.ensureLoaded().then(() => {
      if (thisMount !== mountId || !containerEl) return;
      applyScope();
      showStructure();
      // loadDashboard() re-arms its own timer when it finishes (see
      // scheduleNext); unmount() below clears it — the router detaches this
      // module's DOM on navigate, so an orphaned timer would keep firing.
      loadDashboard();
    });
  }

  function unmount(container) {
    mountId++; // invalidates a mount() still waiting on the Org Chart scope
    requestSeq++; // ...and a fingerprint request still in flight
    containerEl = null;
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
    if (barChart) { barChart.destroy(); barChart = null; }
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    container.innerHTML = '';
  }

  return { mount, unmount };
})();
