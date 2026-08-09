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
       authenticated to be inside the shell at all. Role/region scoping
       (see below) now reads MKNexus.SessionData.profile instead of the
       source site's own sessionStorage("authUser") + Attendance-Login
       redirect.
     - Card top-accent line, KPI icons, hover-lift, and a GSAP entrance
       fade — same visual language as the Rent/Expenses modules.

   KNOWN LIMITATION: the source site scoped a "region_manager" role to
   just their own region (USER_REGION, e.g. "بنى سويف"). MK Nexus's own
   Users sheet doesn't have a matching region field today, so every
   logged-in user currently sees every region (getUserRegion() falls back
   to "ALL") — the scoping code path is kept intact and will start
   working the moment a `region` value shows up on the session profile,
   same as isAdmin() in rent.js/expenses.js started working once role
   values were confirmed. */
MKNexus.AttendanceModule = (function () {
  let containerEl = null;
  let dateInput, totalCountEl, inCountEl, outCountEl, userBadgeEl, departmentsBoxEl;
  let barChart = null;
  let pieChart = null;
  let refreshTimer = null;

  // Straight port of the source site's hardcoded engineer→region map —
  // there is no backend endpoint for this, it's client-side data there too.
  const ENGINEER_DEPT = {
    'Mohamed Abdellatif Abdelhamid Aly': 'بنى سويف',
    'Efat Youssef Assad Hanna': 'شمال المنيا',
    'Waleed Mahmoud Ismaiel Abdelrahim': 'شمال المنيا',
    'Ahmed Abdelnasser Mohamed Aly': 'توريدات',
    'Amr Abdullah Abdrabbo Hlhil': 'آلى',
    'Wael Ibrahim Eid Mohamed': 'بنى سويف',
    'Aly Aboseif Abdelbadea Aly Abosaif': 'جنوب المنيا',
    'Mahmoud Fathy Youssef Ismail': 'بنى سويف',
    'Hussien Kamel Abdelkarem Abdelelamam': 'جنوب المنيا',
    'Reda Mekhemar Abdelhamid Abdelhakim': 'جنوب المنيا',
    'Mohamed Khaled Mohamed Khaled': 'توريدات',
    'Alaaeldien Mohamed Soliman AbdelhAlym': 'آلى',
    'Afraim Shawky Mikhail Habashy': 'شمال المنيا',
    'Mohamed Hussien Mohamed Ahmed': 'جنوب المنيا',
    'Ahmed Abdelfattah Aly Aly': 'بنى سويف',
    'Mohamed Moustafa Abdelrahman Reyad': 'جنوب المنيا',
    'Abdullah Shaaban Saad Mourad': 'بنى سويف',
    'Elfarouk Mohamed Ahmed Mohamed': 'متابعه',
    'Essam Sayed Mohamed Seddik': 'جنوب المنيا',
    'Eltawab Mahmoud Aly Aboelhassan': 'آلى',
    'Ibrahim Abdelnaser Abdelshafy Abdellatif': 'آلى',
    'Mohamed Saeed Aboelhagag Hassan': 'آلى',
    'Ahmed Mohamed Farouk Abdelrheam': 'بنى سويف',
    'Ahmed Rabie Abdelrazik Hussien': 'شمال المنيا',
    'Mohamed Atef Mahmoud Elgeneidy': 'بنى سويف',
    'Ali Ahmed Hassan Hamed': 'آلى',
    'Assem Hassan Abdelshafy Hassan': 'بنى سويف',
    'Omar Metwally Ahmed Mohamed Salem': 'آلى',
    'Abdelmoneam Hassan Hafez Karrat': 'آلى',
    'Mahmoud Ramadan Mahmoud Abdelaziz': 'آلى',
    'Mahmoud Khaled': 'جنوب المنيا',
    'Mohamed Youssef': 'شمال المنيا',
    'Mohamed Toney Eid Abdel Zaher': 'آلى',
    'Mohamed Ali Abdel Hafez': 'آلى',
    'Gamal Ahmed Moustafa': 'آلى',
    'Mohamed Khaled Kamal ElRawy': 'آلى',
  };
  const ENGINEERS = Object.keys(ENGINEER_DEPT);
  const DEPARTMENTS = [...new Set(Object.values(ENGINEER_DEPT))];

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
  function getUserRegion() {
    const region = (MKNexus.SessionData?.profile?.region || '').trim().toUpperCase();
    return region || 'ALL';
  }
  function visibleEngineers() {
    const region = getUserRegion();
    return region === 'ALL' ? ENGINEERS : ENGINEERS.filter((e) => ENGINEER_DEPT[e] === region);
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
            <p class="attendance-module__subtitle">حضور وانصراف المهندسين حسب المنطقة، بتحديث تلقائي كل 30 ثانية</p>
          </div>
          <span class="attendance-module__badge" id="attUserBadge"></span>
        </div>

        <div class="attendance-datebar">
          <i class="fa-regular fa-calendar"></i>
          <input type="date" class="attendance-date-input" id="attDatePicker">
        </div>

        <div class="attendance-kpi-strip">
          <div class="attendance-kpi"><span class="attendance-kpi__icon"><i class="fa-solid fa-users"></i></span><span class="attendance-kpi__label">إجمالي المهندسين</span><span class="attendance-kpi__value" id="attTotalCount">0</span></div>
          <div class="attendance-kpi"><span class="attendance-kpi__icon attendance-kpi__icon--success"><i class="fa-solid fa-user-check"></i></span><span class="attendance-kpi__label">حضر</span><span class="attendance-kpi__value attendance-kpi__value--success" id="attInCount">0</span></div>
          <div class="attendance-kpi"><span class="attendance-kpi__icon attendance-kpi__icon--danger"><i class="fa-solid fa-user-xmark"></i></span><span class="attendance-kpi__label">غاب</span><span class="attendance-kpi__value attendance-kpi__value--danger" id="attOutCount">0</span></div>
        </div>

        <div class="attendance-charts-grid">
          <div class="attendance-card attendance-chart-card"><canvas id="attDeptChart"></canvas></div>
          <div class="attendance-card attendance-chart-card"><canvas id="attPieChart"></canvas></div>
        </div>

        <div class="attendance-dept-grid" id="attDepartmentsBox"></div>
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

  function renderDepartments(deptData, presentSet, outDeptData, outSet) {
    const region = getUserRegion();
    const visible = visibleEngineers();
    const emptyRow = "<span class='attendance-empty-hint'>-</span>";

    departmentsBoxEl.innerHTML = DEPARTMENTS.filter((dept) => region === 'ALL' || region === dept).map((dept) => {
      const all = visible.filter((e) => ENGINEER_DEPT[e] === dept);
      const present = [...deptData[dept].set];
      const absent = all.filter((e) => !presentSet.has(e));
      const notOut = present.filter((p) => !outSet.has(p));

      const presentRows = deptData[dept].rows.map((p) => buildAttRow(p.name, p.location, p.time)).join('') || emptyRow;
      const absentNames = absent.map((a) => `<span class="attendance-name-chip">${escapeHtml(shortName(a))}</span>`).join('') || emptyRow;
      const outRows = outDeptData[dept].rows.map((o) => buildAttRow(o.name, o.location, o.time)).join('') || emptyRow;
      const notOutNames = notOut.map((p) => `<span class="attendance-name-chip">${escapeHtml(shortName(p))}</span>`).join('') || emptyRow;

      return `
        <div class="attendance-card attendance-dept-card">
          <h4 class="attendance-dept-card__title">${escapeHtml(dept)}</h4>
          <div class="attendance-split">
            <div class="attendance-inner-box"><b>حضر (${present.length})</b>${presentRows}</div>
            <div class="attendance-inner-box"><b>غاب (${absent.length})</b>${absentNames}</div>
          </div>
          <div class="attendance-split attendance-split--out">
            <div class="attendance-inner-box"><b>انصرف (${outDeptData[dept].set.size})</b>${outRows}</div>
            <div class="attendance-inner-box"><b>لم يبصم انصراف</b>${notOutNames}</div>
          </div>
        </div>`;
    }).join('');

    animateIn(departmentsBoxEl);
  }

  function drawCharts(deptData, inCount, roleTotal) {
    if (typeof Chart === 'undefined') return;
    if (barChart) barChart.destroy();
    if (pieChart) pieChart.destroy();

    const region = getUserRegion();
    const chartDepts = region === 'ALL' ? DEPARTMENTS : [region];
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
        labels: chartDepts,
        datasets: [{
          data: chartDepts.map((d) => deptData[d]?.set.size || 0),
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

  function loadDashboard() {
    const date = dateInput.value;
    const kpiStrip = containerEl?.querySelector('.attendance-kpi-strip');
    kpiStrip?.classList.add('is-loading');
    MKNexus.AttendanceApi.getAttendance({ role: getUserRole(), region: getUserRegion(), date })
      .then((rows) => {
        if (!Array.isArray(rows)) return;

        const presentSet = new Set();
        const outSet = new Set();
        const deptData = {};
        const outDeptData = {};
        DEPARTMENTS.forEach((d) => {
          deptData[d] = { set: new Set(), rows: [] };
          outDeptData[d] = { set: new Set(), rows: [] };
        });

        const userRole = getUserRole();
        const userRegion = getUserRegion();

        rows.forEach((r) => {
          if (!ENGINEER_DEPT[r.name]) return;
          const status = (r.status || r.Action || '').trim().toUpperCase();
          const dept = ENGINEER_DEPT[r.name];
          if (userRole === 'region_manager' && dept !== userRegion) return;
          // Only the first IN/OUT scan of the day is kept per person — a
          // duplicate scan used to inflate `rows` (and anything counted
          // from its length) without inflating the `set`-based header
          // count, so the two disagreed whenever someone scanned twice.
          if (status === 'IN') {
            if (!deptData[dept].set.has(r.name)) deptData[dept].rows.push(r);
            presentSet.add(r.name);
            deptData[dept].set.add(r.name);
          }
          if (status === 'OUT') {
            if (!outDeptData[dept].set.has(r.name)) outDeptData[dept].rows.push(r);
            outSet.add(r.name);
            outDeptData[dept].set.add(r.name);
          }
        });

        const roleTotal = userRegion === 'ALL' ? ENGINEERS.length : ENGINEERS.filter((e) => ENGINEER_DEPT[e] === userRegion).length;

        totalCountEl.textContent = String(roleTotal);
        inCountEl.textContent = String(presentSet.size);
        outCountEl.textContent = String(roleTotal - presentSet.size);

        renderDepartments(deptData, presentSet, outDeptData, outSet);
        drawCharts(deptData, presentSet.size, roleTotal);
      })
      .catch((error) => {
        // Auto-refreshes every 30s, so a full-dashboard error state would
        // flicker distractingly on every transient failure — a toast is
        // enough to tell the user the numbers on screen may be stale
        // without replacing the dashboard they're currently reading.
        MKNexus.Toast?.error(error?.message || 'Couldn’t refresh attendance data — showing the last known values.');
      })
      .finally(() => kpiStrip?.classList.remove('is-loading'));
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
  }

  function mount(container) {
    containerEl = container;
    container.innerHTML = template();
    cacheDom();

    const profile = MKNexus.SessionData?.profile;
    userBadgeEl.textContent = profile?.name ? `${profile.name} • ${profile.role || ''}` : '';

    dateInput.value = new Date().toLocaleDateString('en-CA');
    dateInput.addEventListener('change', loadDashboard);

    loadDashboard();
    // The router detaches this module's DOM on navigate but never called
    // clearInterval here in an earlier draft — that's the exact "orphaned
    // timer" bug class fixed in editor.js/geo-module.js's keydown
    // listeners; guarding it in unmount() below instead.
    refreshTimer = window.setInterval(loadDashboard, MKNexus.AttendanceConfig.refreshMs);

    if (typeof gsap !== 'undefined' && !prefersReducedMotion()) {
      gsap.fromTo([containerEl.querySelector('.attendance-module__header'), containerEl.querySelector('.attendance-datebar')],
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' });
    }
  }

  function unmount(container) {
    if (refreshTimer) { window.clearInterval(refreshTimer); refreshTimer = null; }
    if (barChart) { barChart.destroy(); barChart = null; }
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    container.innerHTML = '';
  }

  return { mount, unmount };
})();
