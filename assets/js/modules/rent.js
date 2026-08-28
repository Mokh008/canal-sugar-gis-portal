window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Rent module. Ported from the standalone site at
   mokh008.github.io/Rent-Payment-UI (index.html = pay view, rent-report.html
   = admin report view) into the MK Nexus shell/design system. The backend
   contracts (URLs, actions, field names) are untouched — see
   api/rent-config.js's header comment.

   Differences from the source site, by design:
     - Visual identity now follows MK Nexus's tokens (tokens.css) instead
       of the source's own teal/indigo mk-theme.css.
     - The admin Report view is gated on the shell's own logged-in session
       role (MKNexus.Access.canViewReports() — Admin/Section Manger/
       Manager) instead of a redirect to the separate Company-Portal site
       + a client-side adminKey check — you're already authenticated to
       get into the shell at all. Non-admin viewers of that Report view
       (Section Manger/Manager) additionally only ever see rows from
       their own sector — see core/data/team-directory.js.
     - Backend-sourced strings are HTML-escaped before being interpolated
       (the source site didn't).
   Everything else — field names, month generation, payment/print flow,
   report filters/tabs/export — is a straight port. */
MKNexus.RentModule = (function () {
  let containerEl = null;
  let engineerInput, engineerHintEl, printMonthSelect, payResultEl, payViewEl, reportViewEl, tabsEl,
    reportHeadEl, reportBodyEl, reportCardsEl, monthFilterEl, statusFilterEl,
    exportBtn, loaderEl, loaderTextEl;

  let currentEngineerId = null;
  let currentAssets = [];
  let currentPaidMonths = {}; // { [assetName]: ["MM-YYYY", ...] }, from getAssets()
  let reportAllData = [];
  let reportFiltered = [];
  let reportActiveTab = 'all';
  let reportLoadedOnce = false;

  /* -------------------------------------------------------------------
     Utilities — shared with Attendance/Expenses via core/utils.js instead
     of each module carrying its own identical copy.
  ------------------------------------------------------------------- */
  const escapeHtml = MKNexus.Utils.escapeHtml;
  const fmtNumber = MKNexus.Utils.fmtNumber;
  const prefersReducedMotion = MKNexus.Utils.prefersReducedMotion;
  const animateIn = MKNexus.Utils.animateIn;
  function showLoader(text) { MKNexus.Utils.showLoader(loaderEl, loaderTextEl, text); }
  function hideLoader() { MKNexus.Utils.hideLoader(loaderEl); }

  // BUG FIX: engineers used to retype their numeric ID by hand on every
  // visit, with nothing to verify it was really them. Accounts tied to a
  // specific engineer via Users.EngineerID (see
  // backend/mk-nexus-core/auth.gs) now carry that ID on the session
  // itself; this module locks the field to it instead of asking. Empty
  // for accounts not tied to an engineer (admins, etc.) — falls back to
  // the manual field exactly as before.
  function sessionEngineerId() {
    return (MKNexus.SessionData?.profile?.engineerId || '').trim();
  }

  function sanitizeKey(name) {
    return String(name || '').replace(/\s/g, '_');
  }

  function generateMonths(startYear, startMonth, count) {
    const months = [];
    let y = startYear;
    let m = startMonth;
    for (let i = 0; i < count; i++) {
      months.push(`${String(m).padStart(2, '0')}-${y}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return months;
  }
  // Anchored to "now" instead of a hardcoded Dec-2025 start — the old
  // fixed 13-month window would have silently gone stale (no month
  // picker entry past the hardcoded end date) with no error or warning.
  // 6 months back / 12 months ahead comfortably covers late/advance rent
  // payments without needing a code change ever again.
  const MONTHS_LIST = (() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    return generateMonths(start.getFullYear(), start.getMonth() + 1, 19);
  })();

  function formatDate(d) {
    return d ? new Date(d).toLocaleDateString('ar-EG') : '-';
  }

  function daysClass(n) {
    const v = parseInt(n, 10);
    if (Number.isNaN(v)) return '';
    if (v <= 30) return 'rent-days-crit';
    if (v <= 90) return 'rent-days-warn';
    return 'rent-days-ok';
  }

  /* -------------------------------------------------------------------
     Template
  ------------------------------------------------------------------- */
  function template() {
    return `
      <div class="rent-module" dir="rtl">
        <div class="rent-module__header">
          <div class="rent-module__heading">
            <span class="type-eyebrow rent-module__eyebrow">RENT OPERATIONS</span>
            <h1 class="rent-module__title">نظام دفع الإيجارات</h1>
            <p class="rent-module__subtitle">إدارة عقود ومدفوعات إيجار المكاتب والأراضي</p>
          </div>
          <div class="rent-tabs" id="rentTabs" hidden>
            <button class="rent-tab is-active" type="button" data-tab="pay">دفع الإيجار</button>
            <button class="rent-tab" type="button" data-tab="report">التقرير الإداري</button>
          </div>
        </div>

        <section class="rent-view" id="rentPayView">
          <div class="rent-card rent-search-card">
            <div class="rent-field">
              <label class="rent-label" for="rentEngineerId">رقم المهندس (ID)</label>
              <div class="rent-input-wrap">
                <i class="fa-solid fa-id-card rent-input-icon"></i>
                <input class="rent-input rent-input--icon" id="rentEngineerId" type="text" placeholder="مثال: 1001777" inputmode="numeric">
              </div>
              <div class="rent-hint rent-hint--identity" id="rentEngineerHint" hidden></div>
            </div>
            <button class="btn btn--primary rent-search-btn" type="button" id="rentLoadBtn">
              <span>عرض البيانات</span><i class="fa-solid fa-magnifying-glass"></i>
            </button>
          </div>
          <div id="rentPayResult"></div>
        </section>

        <section class="rent-view" id="rentReportView" hidden>
          <div class="rent-report-toolbar">
            <div class="rent-filter-row">
              <select class="rent-select" id="rentMonthFilter"><option value="">اختر الشهر</option></select>
              <select class="rent-select" id="rentStatusFilter">
                <option value="">الكل</option>
                <option value="paid">دفعوا ✅</option>
                <option value="unpaid">لم يدفعوا ❌</option>
              </select>
            </div>
            <button class="btn btn--ghost rent-export-btn" type="button" id="rentExportBtn">
              <i class="fa-solid fa-file-excel"></i><span>تصدير Excel</span>
            </button>
          </div>

          <div class="rent-kpi-strip">
            <div class="rent-kpi"><span class="rent-kpi__icon"><i class="fa-solid fa-building"></i></span><span class="rent-kpi__label">إجمالي المكاتب</span><span class="rent-kpi__value" id="rentKpiTotal">—</span></div>
            <div class="rent-kpi"><span class="rent-kpi__icon rent-kpi__icon--success"><i class="fa-solid fa-circle-check"></i></span><span class="rent-kpi__label">دفعوا</span><span class="rent-kpi__value rent-kpi__value--success" id="rentKpiPaid">—</span></div>
            <div class="rent-kpi"><span class="rent-kpi__icon rent-kpi__icon--danger"><i class="fa-solid fa-circle-xmark"></i></span><span class="rent-kpi__label">لم يدفعوا</span><span class="rent-kpi__value rent-kpi__value--danger" id="rentKpiUnpaid">—</span></div>
            <div class="rent-kpi"><span class="rent-kpi__icon"><i class="fa-solid fa-sack-dollar"></i></span><span class="rent-kpi__label">إجمالي المدفوع</span><span class="rent-kpi__value" id="rentKpiPaidAmt">—</span></div>
            <div class="rent-kpi"><span class="rent-kpi__icon rent-kpi__icon--danger"><i class="fa-solid fa-hand-holding-dollar"></i></span><span class="rent-kpi__label">المتبقي للتحصيل</span><span class="rent-kpi__value rent-kpi__value--danger" id="rentKpiUnpaidAmt">—</span></div>
          </div>

          <div class="rent-tabs rent-tabs--report">
            <button class="rent-tab is-active" type="button" data-report-tab="all">الكل</button>
            <button class="rent-tab" type="button" data-report-tab="paid">دفعوا ✅</button>
            <button class="rent-tab" type="button" data-report-tab="unpaid">لم يدفعوا ❌</button>
            <button class="rent-tab" type="button" data-report-tab="offices">مكاتب غير مدفوعة</button>
          </div>

          <div class="rent-table-wrap rent-table-wrap--desktop">
            <table class="rent-table">
              <thead><tr id="rentReportHead"></tr></thead>
              <tbody id="rentReportBody"><tr><td class="rent-state-msg" colspan="11">اختر شهراً لعرض البيانات</td></tr></tbody>
            </table>
          </div>
          <div class="rent-cards rent-cards--mobile" id="rentReportCards"></div>
        </section>

        <div class="rent-loader" id="rentLoader">
          <div class="rent-spinner"></div>
          <div class="rent-loader-text" id="rentLoaderText">جاري التنفيذ...</div>
        </div>
      </div>`;
  }

  /* -------------------------------------------------------------------
     Pay view
  ------------------------------------------------------------------- */
  function assetRowHtml(item) {
    const key = sanitizeKey(item.assetName);
    const dc = daysClass(item.remainingDays);
    return `
      <tr data-asset-key="${escapeHtml(key)}">
        <td>${escapeHtml(item.assetName)}</td>
        <td>${escapeHtml(item.location)}</td>
        <td>${escapeHtml(item.assetType)}</td>
        <td>${escapeHtml(item.monthlyRent)}</td>
        <td>${formatDate(item.contractStart)}</td>
        <td>${formatDate(item.contractEnd)}</td>
        <td class="${dc}">${escapeHtml(item.remainingDays)}</td>
        <td class="rent-owner-cell">${escapeHtml(item.ownerName)}</td>
        <td>${monthSelectHtml(currentPaidMonths[item.assetName])}</td>
        <td><button class="btn btn--primary rent-pay-btn" type="button" data-role="pay">دفع</button></td>
      </tr>`;
  }

  function assetCardHtml(item) {
    const key = sanitizeKey(item.assetName);
    const dc = daysClass(item.remainingDays);
    const remaining = parseInt(item.remainingDays, 10);
    const daysLabel = remaining > 0 ? `${escapeHtml(item.remainingDays)} يوم متبقي` : 'منتهي';
    return `
      <div class="rent-card rent-asset-card" data-asset-key="${escapeHtml(key)}">
        <div class="rent-asset-card__header">
          <div class="rent-asset-card__name">${escapeHtml(item.assetName)}</div>
          <div class="rent-asset-card__days ${dc}">${daysLabel}</div>
        </div>
        <div class="rent-asset-card__info">
          <div><span class="rent-asset-card__label">الموقع</span><span class="rent-asset-card__value">${escapeHtml(item.location)}</span></div>
          <div><span class="rent-asset-card__label">النوع</span><span class="rent-asset-card__value">${escapeHtml(item.assetType)}</span></div>
          <div><span class="rent-asset-card__label">الإيجار الشهري</span><span class="rent-asset-card__value rent-asset-card__value--amount">${escapeHtml(item.monthlyRent)}</span></div>
          <div><span class="rent-asset-card__label">المالك</span><span class="rent-asset-card__value rent-owner-cell">${escapeHtml(item.ownerName)}</span></div>
          <div><span class="rent-asset-card__label">بداية العقد</span><span class="rent-asset-card__value">${formatDate(item.contractStart)}</span></div>
          <div><span class="rent-asset-card__label">نهاية العقد</span><span class="rent-asset-card__value">${formatDate(item.contractEnd)}</span></div>
        </div>
        <div class="rent-asset-card__divider"></div>
        <div class="rent-asset-card__actions">
          <span class="rent-asset-card__label">اختر الشهر وادفع</span>
          ${monthSelectHtml(currentPaidMonths[item.assetName])}
          <button class="btn btn--primary rent-pay-btn" type="button" data-role="pay">💳 دفع الإيجار</button>
        </div>
      </div>`;
  }

  // Months already in getAssets()'s paidMonths[assetName] are shown
  // disabled/marked instead of only surfacing as a "already paid" alert
  // after the fact — the backend already knows this before the user picks.
  function monthSelectHtml(paidList) {
    const paidSet = new Set(paidList || []);
    return `<select class="rent-select rent-month-select" data-role="month">
      <option value="">اختر الشهر</option>
      ${MONTHS_LIST.map((m) => (paidSet.has(m)
    ? `<option value="${m}" disabled>${m} ✓ مدفوع</option>`
    : `<option value="${m}">${m}</option>`)).join('')}
    </select>`;
  }

  // BUG FIX: printReceipts only ever needs { engineerId, month } — it was
  // never actually scoped to "the payment I just made", it aggregates
  // every paid row for that id+month across all assets. The old button
  // relied on a client-only `lastPaidMonth` variable that got wiped on
  // every reload/re-search, and a month already marked paid was
  // permanently disabled in the per-asset picker — so once an engineer
  // paid without printing immediately (or came back later), there was no
  // way left in the UI to get that receipt again. This lists every month
  // that's actually been paid (across all assets) so any of them can be
  // reprinted at any time, not just the one just paid.
  function paidMonthsUnion() {
    const all = new Set();
    Object.values(currentPaidMonths).forEach((list) => (list || []).forEach((m) => all.add(m)));
    return Array.from(all).sort(MKNexus.Utils.compareMonthKeys).reverse();
  }

  function printMonthOptionsHtml() {
    const months = paidMonthsUnion();
    return '<option value="">اختر شهر الإيصال</option>' + months.map((m) => `<option value="${m}">${m}</option>`).join('');
  }

  function renderResults(data, paidMonths) {
    currentAssets = Array.isArray(data) ? data : [];
    currentPaidMonths = paidMonths || {};
    if (!currentAssets.length) {
      payResultEl.innerHTML = '<div class="rent-empty"><i class="fa-regular fa-folder-open"></i><p>لا توجد بيانات</p></div>';
      animateIn(payResultEl);
      return;
    }
    payResultEl.innerHTML = `
      <div class="rent-print-row" id="rentPrintRow">
        <select class="rent-select" id="rentPrintMonth">${printMonthOptionsHtml()}</select>
        <button class="btn btn--ghost rent-print-btn" type="button" id="rentPrintBtn">
          <i class="fa-solid fa-print"></i><span>تحميل ملف الإيصالات</span>
        </button>
      </div>
      <div class="rent-table-wrap rent-table-wrap--desktop">
        <table class="rent-table">
          <thead><tr>
            <th>المكتب</th><th>الموقع</th><th>النوع</th><th>الإيجار</th><th>بداية</th>
            <th>نهاية</th><th>المتبقي</th><th>المالك</th><th>الشهر</th><th>الدفع</th>
          </tr></thead>
          <tbody>${currentAssets.map(assetRowHtml).join('')}</tbody>
        </table>
      </div>
      <div class="rent-cards rent-cards--mobile">${currentAssets.map(assetCardHtml).join('')}</div>`;
    printMonthSelect = document.getElementById('rentPrintMonth');
    animateIn(payResultEl);
  }

  function loadData() {
    const id = engineerInput.value.trim();
    if (!id) { MKNexus.Toast.warning('أدخل رقم المهندس'); return; }
    const loadBtn = document.getElementById('rentLoadBtn');
    currentEngineerId = id;
    showLoader('جاري تحميل البيانات...');
    if (loadBtn) loadBtn.disabled = true; // prevents overlapping/racing getAssets() calls (Enter + click, or a double-click)
    MKNexus.RentApi.getAssets(id)
      .then(({ assets, paidMonths }) => { hideLoader(); renderResults(assets, paidMonths); })
      .catch((error) => { hideLoader(); MKNexus.Toast.error(error.message || 'خطأ في الاتصال'); })
      .finally(() => { if (loadBtn) loadBtn.disabled = false; });
  }

  function handlePay(btn) {
    const row = btn.closest('[data-asset-key]');
    const key = row?.dataset.assetKey;
    const item = currentAssets.find((a) => sanitizeKey(a.assetName) === key);
    const select = row?.querySelector('[data-role="month"]');
    const month = select?.value;
    if (!item) return;
    if (!month) { MKNexus.Toast.warning('اختر الشهر'); return; }

    // BUG FIX: this used to fire the (permanent, no-undo) payment record
    // the instant "دفع" was clicked, with no confirmation step — a
    // wrong month picked by mistake became a real financial record with
    // no way to cancel it. One extra step for a state that can't be
    // undone is worth the friction.
    const confirmed = window.confirm(`تأكيد دفع إيجار "${item.assetName}" عن شهر ${month}؟`);
    if (!confirmed) return;

    const originalLabel = btn.textContent;
    btn.disabled = true;
    showLoader('جاري تسجيل الدفع...');
    MKNexus.RentApi.confirmPayment({ engineerId: currentEngineerId, assetName: item.assetName, month })
      .then(() => {
        hideLoader();
        if (!currentPaidMonths[item.assetName]) currentPaidMonths[item.assetName] = [];
        currentPaidMonths[item.assetName].push(month);

        // The same asset renders in BOTH the desktop table row and the
        // mobile card (same data-asset-key, only one visible at a time via
        // CSS) — updating only the clicked one used to leave the other
        // still offering to pay an already-paid month if the viewport
        // crossed the 768px breakpoint afterward. Mark it paid in-place in
        // both so the same asset can still pay a *different* month next.
        payResultEl.querySelectorAll(`[data-asset-key="${CSS.escape(key)}"] [data-role="month"]`).forEach((sel) => {
          const paidOption = Array.from(sel.options).find((o) => o.value === month);
          if (paidOption) { paidOption.disabled = true; paidOption.textContent = `${month} ✓ مدفوع`; }
          sel.value = '';
        });

        // Refresh the print-month list with the just-paid month included,
        // and default straight to it so printing right away still needs
        // no extra picking — while leaving every other paid month
        // available to reprint whenever, not just this one right now.
        if (printMonthSelect) {
          printMonthSelect.innerHTML = printMonthOptionsHtml();
          printMonthSelect.value = month;
        }

        btn.textContent = 'تم الدفع ✓';
        btn.classList.add('is-paid');
        window.setTimeout(() => {
          btn.textContent = originalLabel;
          btn.classList.remove('is-paid');
          btn.disabled = false;
        }, 1600);
      })
      .catch((error) => {
        hideLoader();
        btn.disabled = false;
        MKNexus.Toast.error(error.message || 'خطأ أثناء الدفع');
      });
  }

  function handlePrintReceipts() {
    if (!currentEngineerId) { MKNexus.Toast.warning('أدخل رقم المهندس'); return; }
    const month = printMonthSelect?.value;
    if (!month) { MKNexus.Toast.warning('اختر الشهر'); return; }
    showLoader('جاري تجهيز ملف الإيصالات...');
    MKNexus.RentApi.printReceipts({ engineerId: currentEngineerId, month })
      .then((res) => {
        hideLoader();
        if (res?.pdfUrl && MKNexus.Utils.isSafeHttpsUrl(res.pdfUrl)) window.location.href = res.pdfUrl;
        else MKNexus.Toast.error('لم يتم إنشاء ملف الإيصالات');
      })
      .catch((error) => { hideLoader(); MKNexus.Toast.error(error.message || 'تعذر فتح ملف الإيصالات'); });
  }

  function bindPayView() {
    document.getElementById('rentLoadBtn').addEventListener('click', loadData);
    engineerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadData(); });
    payResultEl.addEventListener('click', (e) => {
      if (e.target.closest('#rentPrintBtn')) { handlePrintReceipts(); return; }
      const payBtn = e.target.closest('[data-role="pay"]');
      if (payBtn && !payBtn.classList.contains('is-paid')) handlePay(payBtn);
    });
  }

  /* -------------------------------------------------------------------
     Report view (admin only)
  ------------------------------------------------------------------- */
  function buildMonthFilter(data) {
    const months = [...new Set(data.map((r) => r.month).filter(Boolean))].sort(MKNexus.Utils.compareMonthKeys).reverse();
    monthFilterEl.innerHTML = '<option value="">اختر الشهر</option>' + months.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    if (months.length) { monthFilterEl.value = months[0]; applyReportFilter(); }
  }

  function applyReportFilter() {
    const month = monthFilterEl.value;
    const status = statusFilterEl.value;
    reportFiltered = reportAllData.filter((r) => {
      if (month && r.month !== month) return false;
      if (status === 'paid' && r.status !== 'paid') return false;
      if (status === 'unpaid' && r.status !== 'unpaid') return false;
      return true;
    });
    renderKPIs(reportFiltered);
    renderByReportTab();
  }

  function renderKPIs(data) {
    const paid = data.filter((r) => r.status === 'paid');
    const unpaid = data.filter((r) => r.status === 'unpaid');
    document.getElementById('rentKpiTotal').textContent = String(data.length);
    document.getElementById('rentKpiPaid').textContent = String(paid.length);
    document.getElementById('rentKpiUnpaid').textContent = String(unpaid.length);
    document.getElementById('rentKpiPaidAmt').textContent = fmtNumber(paid.reduce((s, r) => s + (Number(r.monthlyRent) || 0), 0));
    document.getElementById('rentKpiUnpaidAmt').textContent = fmtNumber(unpaid.reduce((s, r) => s + (Number(r.monthlyRent) || 0), 0));
  }

  function setReportHead(cols) {
    reportHeadEl.innerHTML = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  }

  function renderByReportTab() {
    let data = reportFiltered;
    if (reportActiveTab === 'paid') data = reportFiltered.filter((r) => r.status === 'paid');
    if (reportActiveTab === 'unpaid') data = reportFiltered.filter((r) => r.status === 'unpaid');
    if (reportActiveTab === 'offices') { renderOfficesTable(reportFiltered.filter((r) => r.status === 'unpaid')); return; }
    renderReportTable(data);
    renderReportCards(data);
  }

  function renderReportTable(data) {
    setReportHead(['#', 'رقم المهندس', 'اسم المهندس', 'اسم المكتب', 'الموقع', 'الإيجار الشهري', 'الشهر', 'الحالة', 'تاريخ الدفع']);
    if (!data.length) { reportBodyEl.innerHTML = '<tr><td class="rent-state-msg" colspan="9">لا توجد بيانات مطابقة</td></tr>'; return; }
    reportBodyEl.innerHTML = data.map((r, i) => {
      const badge = r.status === 'paid' ? '<span class="rent-badge rent-badge--paid">دفع ✅</span>' : '<span class="rent-badge rent-badge--unpaid">لم يدفع ❌</span>';
      return `<tr>
        <td class="rent-muted">${i + 1}</td><td class="rent-muted">${escapeHtml(r.engineerId) || '—'}</td>
        <td>${escapeHtml(r.engineerName) || '—'}</td><td class="rent-strong">${escapeHtml(r.assetName) || '—'}</td>
        <td class="rent-muted">${escapeHtml(r.location) || '—'}</td><td class="rent-num">${fmtNumber(r.monthlyRent)}</td>
        <td>${escapeHtml(r.month) || '—'}</td><td>${badge}</td><td class="rent-muted">${escapeHtml(r.paidAt) || '—'}</td>
      </tr>`;
    }).join('');
  }

  function renderOfficesTable(data) {
    setReportHead(['#', 'اسم المكتب', 'الموقع', 'النوع', 'الإيجار الشهري', 'المالك', 'المهندس المسؤول', 'الشهر']);
    reportCardsEl.innerHTML = '';
    if (!data.length) { reportBodyEl.innerHTML = '<tr><td class="rent-state-msg" colspan="8">✅ جميع المكاتب دفعت الإيجار</td></tr>'; return; }
    reportBodyEl.innerHTML = data.map((r, i) => `
      <tr>
        <td class="rent-muted">${i + 1}</td>
        <td class="rent-strong rent-danger-text">${escapeHtml(r.assetName) || '—'}</td>
        <td>${escapeHtml(r.location) || '—'}</td><td>${escapeHtml(r.assetType) || '—'}</td>
        <td class="rent-num">${fmtNumber(r.monthlyRent)}</td>
        <td class="rent-owner-cell">${escapeHtml(r.ownerName) || '—'}</td>
        <td>${escapeHtml(r.engineerName) || '—'}</td><td>${escapeHtml(r.month) || '—'}</td>
      </tr>`).join('');
  }

  function renderReportCards(data) {
    if (!data.length) { reportCardsEl.innerHTML = '<div class="rent-state-msg">لا توجد بيانات</div>'; return; }
    reportCardsEl.innerHTML = data.map((r) => {
      const isPaid = r.status === 'paid';
      const badge = isPaid ? '<span class="rent-badge rent-badge--paid">دفع ✅</span>' : '<span class="rent-badge rent-badge--unpaid">لم يدفع ❌</span>';
      return `
      <div class="rent-card rent-report-card ${isPaid ? 'is-paid' : 'is-unpaid'}">
        <div class="rent-report-card__top"><div class="rent-report-card__name">${escapeHtml(r.assetName) || '—'}</div>${badge}</div>
        <div class="rent-report-card__grid">
          <div><span class="rent-asset-card__label">المهندس</span><span class="rent-asset-card__value">${escapeHtml(r.engineerName) || '—'}</span></div>
          <div><span class="rent-asset-card__label">الموقع</span><span class="rent-asset-card__value">${escapeHtml(r.location) || '—'}</span></div>
          <div><span class="rent-asset-card__label">الإيجار الشهري</span><span class="rent-asset-card__value rent-asset-card__value--amount">${fmtNumber(r.monthlyRent)} ج</span></div>
          <div><span class="rent-asset-card__label">الشهر</span><span class="rent-asset-card__value">${escapeHtml(r.month) || '—'}</span></div>
          ${isPaid ? `<div><span class="rent-asset-card__label">تاريخ الدفع</span><span class="rent-asset-card__value">${escapeHtml(r.paidAt) || '—'}</span></div>` : ''}
          <div><span class="rent-asset-card__label">المالك</span><span class="rent-asset-card__value rent-owner-cell">${escapeHtml(r.ownerName) || '—'}</span></div>
        </div>
      </div>`;
    }).join('');
  }

  function exportExcel() {
    let data = reportFiltered;
    if (reportActiveTab === 'paid') data = reportFiltered.filter((r) => r.status === 'paid');
    if (reportActiveTab === 'unpaid') data = reportFiltered.filter((r) => r.status === 'unpaid');
    if (reportActiveTab === 'offices') data = reportFiltered.filter((r) => r.status === 'unpaid');
    if (!data.length) { MKNexus.Toast.warning('لا توجد بيانات للتصدير'); return; }
    if (typeof XLSX === 'undefined') { MKNexus.Toast.warning('تعذر تحميل مكتبة التصدير'); return; }

    const month = monthFilterEl.value || 'كل_الشهور';
    exportBtn.disabled = true;
    const rows = data.map((r, i) => ({
      '#': i + 1,
      'رقم المهندس': r.engineerId || '',
      'اسم المهندس': r.engineerName || '',
      'اسم المكتب': r.assetName || '',
      'الموقع': r.location || '',
      'نوع المكتب': r.assetType || '',
      'الإيجار الشهري': Number(r.monthlyRent) || 0,
      'الشهر': r.month || '',
      'الحالة': r.status === 'paid' ? 'دفع ✅' : 'لم يدفع ❌',
      'تاريخ الدفع': r.paidAt || '',
      'المالك': r.ownerName || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الإيجارات');
    XLSX.writeFile(wb, `تقرير_الإيجارات_${month}.xlsx`);
    exportBtn.disabled = false;
  }

  function loadReport() {
    showLoader('جاري تحميل بيانات الإيجارات...');
    // Section Manger/Manager only ever see their own sector's rows —
    // Admin sees everyone, same as before this scoping existed. See
    // core/data/team-directory.js's header comment for why this is a
    // client-side filter rather than a backend one (Rent has no
    // login/session concept of its own).
    const directoryReady = MKNexus.Access.isAdmin() ? Promise.resolve() : MKNexus.TeamDirectory.ensureLoaded();
    Promise.all([MKNexus.RentApi.getRentReport(), directoryReady])
      .then(([data]) => {
        hideLoader();
        // The backend action can respond successfully with something that
        // isn't a rows array (e.g. getRentReport not implemented on this
        // deployment yet) — that's a config problem, not "no data", so it
        // gets its own message instead of silently looking like an empty
        // report.
        if (!Array.isArray(data)) {
          reportBodyEl.innerHTML = '<tr><td class="rent-state-msg" colspan="9">⚠️ أضف action=getRentReport في الـ Apps Script أولاً</td></tr>';
          return;
        }
        const scoped = MKNexus.TeamDirectory.filterToMySector(data);
        reportAllData = reportFiltered = scoped;
        buildMonthFilter(scoped);
        renderKPIs(reportFiltered);
        renderByReportTab();
        animateIn(containerEl.querySelector('.rent-kpi-strip'));
      })
      .catch((error) => {
        hideLoader();
        reportBodyEl.innerHTML = `<tr><td class="rent-state-msg" colspan="9">❌ ${escapeHtml(error.message || 'تعذر الاتصال بالخادم')}</td></tr>`;
      });
  }

  function bindReportView() {
    monthFilterEl.addEventListener('change', applyReportFilter);
    statusFilterEl.addEventListener('change', applyReportFilter);
    exportBtn.addEventListener('click', exportExcel);
    containerEl.querySelectorAll('[data-report-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        containerEl.querySelectorAll('[data-report-tab]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        reportActiveTab = btn.dataset.reportTab;
        renderByReportTab();
      });
    });
  }

  function bindTopTabs() {
    tabsEl.hidden = false;
    tabsEl.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabsEl.querySelectorAll('[data-tab]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const tab = btn.dataset.tab;
        payViewEl.hidden = tab !== 'pay';
        reportViewEl.hidden = tab !== 'report';
        if (tab === 'report' && !reportLoadedOnce) { reportLoadedOnce = true; loadReport(); }
      });
    });
  }

  /* -------------------------------------------------------------------
     Mount / unmount
  ------------------------------------------------------------------- */
  function cacheDom() {
    engineerInput = document.getElementById('rentEngineerId');
    engineerHintEl = document.getElementById('rentEngineerHint');
    payResultEl = document.getElementById('rentPayResult');
    payViewEl = document.getElementById('rentPayView');
    reportViewEl = document.getElementById('rentReportView');
    tabsEl = document.getElementById('rentTabs');
    reportHeadEl = document.getElementById('rentReportHead');
    reportBodyEl = document.getElementById('rentReportBody');
    reportCardsEl = document.getElementById('rentReportCards');
    monthFilterEl = document.getElementById('rentMonthFilter');
    statusFilterEl = document.getElementById('rentStatusFilter');
    exportBtn = document.getElementById('rentExportBtn');
    loaderEl = document.getElementById('rentLoader');
    loaderTextEl = document.getElementById('rentLoaderText');
  }

  function mount(container) {
    containerEl = container;
    container.innerHTML = template();
    cacheDom();

    reportLoadedOnce = false;
    reportActiveTab = 'all';
    currentAssets = [];
    currentPaidMonths = {};

    const linkedId = sessionEngineerId();
    if (linkedId) {
      currentEngineerId = linkedId;
      engineerInput.value = linkedId;
      engineerInput.readOnly = true;
      const name = MKNexus.SessionData?.profile?.name;
      engineerHintEl.textContent = name ? `🔒 مرتبط بحسابك: ${name}` : '🔒 مرتبط برقم مهندسك';
      engineerHintEl.hidden = false;
    } else if (currentEngineerId) {
      engineerInput.value = currentEngineerId;
    }

    bindPayView();
    if (MKNexus.Access.canViewReports()) {
      bindTopTabs();
      bindReportView();
    }

    // The ID is already known and locked — no reason to make the
    // engineer click "عرض البيانات" too before seeing anything.
    if (linkedId) loadData();

    if (typeof gsap !== 'undefined' && !prefersReducedMotion()) {
      gsap.fromTo([containerEl.querySelector('.rent-module__header'), containerEl.querySelector('.rent-search-card')],
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' });
    }
  }

  function unmount(container) {
    container.innerHTML = '';
  }

  return { mount, unmount };
})();
