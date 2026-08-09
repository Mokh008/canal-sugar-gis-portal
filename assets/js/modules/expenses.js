window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Expenses module. Ported from the standalone site at
   mokh008.github.io/Expenses-System (index.html = submission form,
   expenses-report.html = admin report) into the MK Nexus shell/design
   system. Backend contract untouched — see api/expenses-config.js.

   Differences from the source site, by design (same choices as the Rent
   module port):
     - MK Nexus tokens instead of the source's own mk-theme.css.
     - Admin Report view gated on MKNexus.SessionData.profile.role instead
       of a redirect to the separate Company-Portal site + adminKey check.
     - Backend-sourced strings are HTML-escaped before interpolation. */
MKNexus.ExpensesModule = (function () {
  let containerEl = null;
  let empIdInput, monthSelect, daysBoxEl, summaryEl, daysCountEl, totalEl,
    transportBoxEl, dividerTransportEl, transportSectionEl, dividerElecEl,
    elecSectionEl, elecAmountInput, elecYearInput, elecMonthInput, elecDayInput,
    submitBtn, successBoxEl, formViewEl, reportViewEl, tabsEl,
    reportBodyEl, reportCardsEl, monthFilterEl, typeFilterEl, exportBtn,
    loaderEl, loaderTextEl;

  let reportAllData = [];
  let reportLoadedOnce = false;

  const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  /* -------------------------------------------------------------------
     Utilities — shared with Attendance/Rent via core/utils.js instead of
     each module carrying its own identical copy.
  ------------------------------------------------------------------- */
  const escapeHtml = MKNexus.Utils.escapeHtml;
  const fmtNumber = MKNexus.Utils.fmtNumber;
  const isAdmin = MKNexus.Utils.isAdmin;
  const prefersReducedMotion = MKNexus.Utils.prefersReducedMotion;
  const animateIn = MKNexus.Utils.animateIn;
  function showLoader(text) { MKNexus.Utils.showLoader(loaderEl, loaderTextEl, text); }
  function hideLoader() { MKNexus.Utils.hideLoader(loaderEl); }

  /* -------------------------------------------------------------------
     Template
  ------------------------------------------------------------------- */
  function template() {
    const monthOptions = MONTH_NAMES.map((name, i) => `<option value="${i + 1}">${name}</option>`).join('');
    return `
      <div class="expenses-module" dir="rtl">
        <div class="expenses-module__header">
          <div class="expenses-module__heading">
            <span class="type-eyebrow expenses-module__eyebrow">EXPENSES OPERATIONS</span>
            <h1 class="expenses-module__title">مصروفات الإعاشة</h1>
            <p class="expenses-module__subtitle">تسجيل مصروفات الإعاشة والانتقال والكهرباء للمهندسين</p>
          </div>
          <div class="expenses-tabs" id="expensesTabs" hidden>
            <button class="expenses-tab is-active" type="button" data-tab="form">تسجيل مصروفات</button>
            <button class="expenses-tab" type="button" data-tab="report">التقرير الإداري</button>
          </div>
        </div>

        <section class="expenses-view" id="expensesFormView">
          <div class="expenses-form-wrap">
            <div class="expenses-card expenses-form-card">
              <div class="expenses-field">
                <label class="expenses-label" for="expEmpId">رقم المهندس (ID)</label>
                <div class="expenses-input-wrap">
                  <i class="fa-solid fa-id-card expenses-input-icon"></i>
                  <input class="expenses-input expenses-input--icon" id="expEmpId" type="text" inputmode="numeric" placeholder="مثال: 1001730">
                </div>
              </div>
              <div class="expenses-field">
                <label class="expenses-label" for="expMonth">الشهر</label>
                <div class="expenses-input-wrap">
                  <i class="fa-regular fa-calendar expenses-input-icon"></i>
                  <select class="expenses-select expenses-input--icon" id="expMonth">
                    <option value="">اختر الشهر</option>
                    ${monthOptions}
                  </select>
                </div>
              </div>
              <button class="btn btn--primary expenses-load-btn" type="button" id="expLoadDaysBtn">تحميل أيام الحضور</button>

              <div class="expenses-days-box" id="expDaysBox" hidden></div>

              <div class="expenses-summary" id="expSummary" hidden>
                <div class="expenses-summary-row"><span>عدد الأيام</span><span class="expenses-summary-val" id="expDaysCount">0</span></div>
                <div class="expenses-summary-row"><span>إجمالي الإعاشة</span><span class="expenses-summary-val"><span id="expTotal">0</span> جنيه</span></div>
              </div>

              <div class="expenses-divider" id="expDividerTransport" hidden></div>
              <div class="expenses-field" id="expTransportSection" hidden>
                <label class="expenses-label">مصروفات الانتقال (Transportation)</label>
                <div id="expTransportBox"></div>
              </div>

              <div class="expenses-divider" id="expDividerElec" hidden></div>
              <div class="expenses-field" id="expElecSection" hidden>
                <label class="expenses-label">فاتورة كهرباء (اختياري)</label>
                <input class="expenses-input" id="expElecAmount" type="number" min="0" placeholder="المبلغ (EGP)">
                <div class="expenses-date-row">
                  <input class="expenses-input" id="expElecYear" type="number" min="2024" max="2100" placeholder="السنة">
                  <input class="expenses-input" id="expElecMonth" type="number" min="1" max="12" placeholder="الشهر">
                  <input class="expenses-input" id="expElecDay" type="number" min="1" max="31" placeholder="اليوم">
                </div>
              </div>

              <button class="btn btn--primary expenses-submit-btn" type="button" id="expSubmitBtn" hidden>إنشاء ملف المصروفات</button>

              <div id="expSuccessBox" class="expenses-success-box"></div>
            </div>
          </div>
        </section>

        <section class="expenses-view" id="expensesReportView" hidden>
          <div class="expenses-report-toolbar">
            <div class="expenses-filter-row">
              <select class="expenses-select" id="expMonthFilter"><option value="">كل الشهور</option></select>
              <select class="expenses-select" id="expTypeFilter">
                <option value="">كل الأنواع</option>
                <option value="إعاشة">إعاشة</option>
                <option value="انتقال">انتقال</option>
                <option value="كهرباء">كهرباء</option>
              </select>
            </div>
            <button class="btn btn--ghost expenses-export-btn" type="button" id="expExportBtn">
              <i class="fa-solid fa-file-excel"></i><span>تصدير Excel</span>
            </button>
          </div>

          <div class="expenses-kpi-strip">
            <div class="expenses-kpi"><span class="expenses-kpi__icon"><i class="fa-solid fa-coins"></i></span><span class="expenses-kpi__label">إجمالي المبالغ</span><span class="expenses-kpi__value" id="expKpiTotal">—</span></div>
            <div class="expenses-kpi"><span class="expenses-kpi__icon"><i class="fa-solid fa-receipt"></i></span><span class="expenses-kpi__label">عدد السجلات</span><span class="expenses-kpi__value" id="expKpiCount">—</span></div>
            <div class="expenses-kpi"><span class="expenses-kpi__icon"><i class="fa-solid fa-users"></i></span><span class="expenses-kpi__label">عدد المهندسين</span><span class="expenses-kpi__value" id="expKpiEng">—</span></div>
            <div class="expenses-kpi"><span class="expenses-kpi__icon expenses-kpi__icon--living"><i class="fa-solid fa-utensils"></i></span><span class="expenses-kpi__label">إجمالي إعاشة</span><span class="expenses-kpi__value" id="expKpiLiving">—</span></div>
            <div class="expenses-kpi"><span class="expenses-kpi__icon expenses-kpi__icon--transport"><i class="fa-solid fa-car"></i></span><span class="expenses-kpi__label">إجمالي انتقال</span><span class="expenses-kpi__value" id="expKpiTransport">—</span></div>
            <div class="expenses-kpi"><span class="expenses-kpi__icon expenses-kpi__icon--electricity"><i class="fa-solid fa-bolt"></i></span><span class="expenses-kpi__label">إجمالي كهرباء</span><span class="expenses-kpi__value" id="expKpiElec">—</span></div>
          </div>

          <div class="expenses-table-wrap expenses-table-wrap--desktop">
            <table class="expenses-table">
              <thead><tr>
                <th>#</th><th>رقم المهندس</th><th>اسم المهندس</th><th>الشهر</th><th>أيام</th>
                <th>النوع</th><th>إعاشة</th><th>انتقال</th><th>كهرباء</th><th>الإجمالي</th><th>تاريخ التسجيل</th>
              </tr></thead>
              <tbody id="expReportBody"><tr><td class="expenses-state-msg" colspan="11">جاري التحميل...</td></tr></tbody>
            </table>
          </div>
          <div class="expenses-cards expenses-cards--mobile" id="expReportCards"></div>
        </section>

        <div class="expenses-loader" id="expensesLoader">
          <div class="expenses-spinner"></div>
          <div class="expenses-loader-text" id="expensesLoaderText">جاري المعالجة...</div>
        </div>
      </div>`;
  }

  /* -------------------------------------------------------------------
     Form view
  ------------------------------------------------------------------- */
  function loadAttendance() {
    const id = empIdInput.value.trim();
    const m = monthSelect.value;
    if (!id || !m) { MKNexus.Toast.warning('من فضلك أدخل رقم المهندس والشهر'); return; }

    const loadBtn = document.getElementById('expLoadDaysBtn');
    daysBoxEl.hidden = false;
    daysBoxEl.innerHTML = '<div class="expenses-hint">جاري التحميل...</div>';
    transportBoxEl.innerHTML = '';
    if (loadBtn) loadBtn.disabled = true; // prevents overlapping/racing getDays() calls from a double-click

    MKNexus.ExpensesApi.getDays(id, m)
      .then((data) => {
        if (!data.length) {
          daysBoxEl.innerHTML = '<div class="expenses-hint">لا توجد أيام حضور لهذا الشهر</div>';
          return;
        }
        daysBoxEl.innerHTML = data.map((d) => `
          <label class="expenses-day">
            <input type="checkbox" data-date="${escapeHtml(d.date)}" data-day="${escapeHtml(d.day)}">
            <span class="expenses-day__label">${escapeHtml(d.date)} (${escapeHtml(d.day)})</span>
          </label>`).join('');
        animateIn(daysBoxEl);
      })
      .catch(() => {
        daysBoxEl.innerHTML = '<div class="expenses-hint expenses-hint--danger">حدث خطأ في الاتصال</div>';
      })
      .finally(() => { if (loadBtn) loadBtn.disabled = false; });
  }

  function calc() {
    const checked = Array.from(daysBoxEl.querySelectorAll('input:checked'));
    daysCountEl.textContent = String(checked.length);
    totalEl.textContent = String(checked.length * MKNexus.ExpensesConfig.livingRatePerDay);
    transportBoxEl.innerHTML = '';

    const hasChecked = checked.length > 0;
    dividerTransportEl.hidden = !hasChecked;
    transportSectionEl.hidden = !hasChecked;
    dividerElecEl.hidden = !hasChecked;
    elecSectionEl.hidden = !hasChecked;
    summaryEl.hidden = !hasChecked;
    submitBtn.hidden = !hasChecked;

    checked.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'expenses-transport-row';
      row.innerHTML = `
        <span>${escapeHtml(c.dataset.date)} (${escapeHtml(c.dataset.day)})</span>
        <input class="expenses-input" type="number" min="0" placeholder="EGP" data-day="${escapeHtml(c.dataset.day)}">`;
      transportBoxEl.appendChild(row);
    });
  }

  function groupByWeekDay() {
    const checked = Array.from(daysBoxEl.querySelectorAll('input:checked'));
    const result = {};
    checked.forEach((c) => {
      const day = c.dataset.day;
      if (!result[day]) result[day] = [];
      result[day].push(c.dataset.date);
    });
    const final = {};
    Object.keys(result).forEach((k) => { final[k] = result[k].join(' & '); });
    return final;
  }

  function collectTransportation() {
    const result = {};
    transportBoxEl.querySelectorAll('input').forEach((i) => {
      if (i.value && Number(i.value) > 0) result[i.dataset.day] = Number(i.value);
    });
    return result;
  }

  function submitExpenses() {
    if (Number(daysCountEl.textContent) === 0) { MKNexus.Toast.warning('من فضلك اختر يوم واحد على الأقل'); return; }

    const elecAmount = Number(elecAmountInput.value) || 0;
    const y = Number(elecYearInput.value);
    const m = Number(elecMonthInput.value);
    const d = Number(elecDayInput.value);

    if (elecAmount > 0) {
      if (!y || !m || !d) { MKNexus.Toast.warning('من فضلك أدخل تاريخ فاتورة الكهرباء'); return; }
      const testDate = new Date(y, m - 1, d);
      if (testDate.getFullYear() !== y || testDate.getMonth() + 1 !== m || testDate.getDate() !== d) {
        MKNexus.Toast.warning('تاريخ فاتورة الكهرباء غير صحيح'); return;
      }
      if (m !== Number(monthSelect.value)) { MKNexus.Toast.warning('شهر فاتورة الكهرباء لازم يطابق الشهر المختار'); return; }
    }

    submitBtn.disabled = true;
    showLoader('جاري إنشاء ملف المصروفات...');
    successBoxEl.innerHTML = '';

    const payload = {
      id: empIdInput.value,
      month: monthSelect.value,
      days: Number(daysCountEl.textContent),
      total: Number(totalEl.textContent),
      breakdown: groupByWeekDay(),
      transport: collectTransportation(),
      electricity: { amount: elecAmount, year: y || '', month: m || '', day: d || '' },
    };

    MKNexus.ExpensesApi.submitExpenses(payload)
      .then((res) => {
        hideLoader();
        submitBtn.disabled = false;
        if (res?.pdfUrl && MKNexus.Utils.isSafeHttpsUrl(res.pdfUrl)) {
          successBoxEl.innerHTML = `
            <div class="expenses-success">✅ تم إنشاء ملف المصروفات بنجاح</div>
            <a href="${escapeHtml(res.pdfUrl)}" target="_blank" rel="noopener" class="expenses-pdf-link">
              <i class="fa-solid fa-file-pdf"></i><span>تحميل ملف المصروفات (PDF)</span>
            </a>`;
        } else {
          successBoxEl.innerHTML = '<div class="expenses-error">تم الحفظ ولكن لم يتم إنشاء ملف PDF</div>';
        }
        animateIn(successBoxEl);
      })
      .catch((error) => {
        hideLoader();
        submitBtn.disabled = false;
        successBoxEl.innerHTML = `<div class="expenses-error">${escapeHtml(error.message || 'حدث خطأ أثناء الإرسال')}</div>`;
      });
  }

  function bindFormView() {
    document.getElementById('expLoadDaysBtn').addEventListener('click', loadAttendance);
    submitBtn.addEventListener('click', submitExpenses);
    daysBoxEl.addEventListener('change', (e) => { if (e.target.matches('input[type="checkbox"]')) calc(); });
  }

  /* -------------------------------------------------------------------
     Report view (admin only)
  ------------------------------------------------------------------- */
  function typeClass(t) {
    if (!t) return 'expenses-badge--other';
    if (t.includes('إعاشة') || t.includes('معيشة')) return 'expenses-badge--living';
    if (t.includes('انتقال') || t.includes('نقل')) return 'expenses-badge--transport';
    if (t.includes('كهرباء')) return 'expenses-badge--electricity';
    return 'expenses-badge--other';
  }

  function buildMonthFilter(data) {
    const months = [...new Set(data.map((r) => r.month).filter(Boolean))].sort(MKNexus.Utils.compareMonthKeys).reverse();
    monthFilterEl.innerHTML = '<option value="">كل الشهور</option>' + months.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  }

  function applyFilter() {
    const month = monthFilterEl.value;
    const type = typeFilterEl.value;
    const filtered = reportAllData.filter((r) => {
      if (month && r.month !== month) return false;
      if (type && !(r.expenseType || '').includes(type)) return false;
      return true;
    });
    renderKPIs(filtered);
    renderTable(filtered);
    renderCards(filtered);
    return filtered;
  }

  function renderKPIs(data) {
    document.getElementById('expKpiTotal').textContent = fmtNumber(data.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0));
    document.getElementById('expKpiCount').textContent = String(data.length);
    document.getElementById('expKpiEng').textContent = String(new Set(data.map((r) => r.engineerId)).size);
    document.getElementById('expKpiLiving').textContent = fmtNumber(data.reduce((s, r) => s + (Number(r.livingAmount) || 0), 0));
    document.getElementById('expKpiTransport').textContent = fmtNumber(data.reduce((s, r) => s + (Number(r.transportAmount) || 0), 0));
    document.getElementById('expKpiElec').textContent = fmtNumber(data.reduce((s, r) => s + (Number(r.electricityAmount) || 0), 0));
  }

  function renderTable(data) {
    if (!data.length) { reportBodyEl.innerHTML = '<tr><td class="expenses-state-msg" colspan="11">لا توجد بيانات مطابقة</td></tr>'; return; }
    reportBodyEl.innerHTML = data.map((r, i) => `
      <tr>
        <td class="expenses-muted">${i + 1}</td>
        <td class="expenses-muted">${escapeHtml(r.engineerId) || '—'}</td>
        <td>${escapeHtml(r.engineerName) || '—'}</td>
        <td>${escapeHtml(r.month) || '—'}</td>
        <td class="expenses-center">${escapeHtml(r.daysCount) || '—'}</td>
        <td><span class="expenses-badge ${typeClass(r.expenseType)}">${escapeHtml(r.expenseType) || '—'}</span></td>
        <td class="expenses-num">${fmtNumber(r.livingAmount)}</td>
        <td class="expenses-num">${fmtNumber(r.transportAmount)}</td>
        <td class="expenses-num">${fmtNumber(r.electricityAmount)}</td>
        <td class="expenses-num expenses-num--lg">${fmtNumber(r.totalAmount)}</td>
        <td class="expenses-muted">${escapeHtml(r.submittedAt) || '—'}</td>
      </tr>`).join('');
  }

  function renderCards(data) {
    if (!data.length) { reportCardsEl.innerHTML = '<div class="expenses-state-msg">لا توجد بيانات</div>'; return; }
    reportCardsEl.innerHTML = data.map((r) => `
      <div class="expenses-card expenses-report-card">
        <div class="expenses-report-card__top">
          <div class="expenses-report-card__name">${escapeHtml(r.engineerName) || '—'}</div>
          <span class="expenses-badge ${typeClass(r.expenseType)}">${escapeHtml(r.expenseType) || '—'}</span>
        </div>
        <div class="expenses-report-card__grid">
          <div><span class="expenses-report-card__label">رقم المهندس</span><span class="expenses-report-card__value">${escapeHtml(r.engineerId) || '—'}</span></div>
          <div><span class="expenses-report-card__label">الشهر</span><span class="expenses-report-card__value">${escapeHtml(r.month) || '—'}</span></div>
          <div><span class="expenses-report-card__label">إعاشة</span><span class="expenses-report-card__value">${fmtNumber(r.livingAmount)}</span></div>
          <div><span class="expenses-report-card__label">انتقال</span><span class="expenses-report-card__value">${fmtNumber(r.transportAmount)}</span></div>
          <div><span class="expenses-report-card__label">كهرباء</span><span class="expenses-report-card__value">${fmtNumber(r.electricityAmount)}</span></div>
          <div><span class="expenses-report-card__label">الإجمالي</span><span class="expenses-report-card__value expenses-report-card__value--big">${fmtNumber(r.totalAmount)} ج</span></div>
        </div>
      </div>`).join('');
  }

  function exportExcel() {
    const filtered = applyFilter();
    if (!filtered.length) { MKNexus.Toast.warning('لا توجد بيانات للتصدير'); return; }
    if (typeof XLSX === 'undefined') { MKNexus.Toast.warning('تعذر تحميل مكتبة التصدير'); return; }

    const month = monthFilterEl.value || 'كل_الشهور';
    exportBtn.disabled = true;
    const rows = filtered.map((r, i) => ({
      '#': i + 1,
      'رقم المهندس': r.engineerId || '',
      'اسم المهندس': r.engineerName || '',
      'الشهر': r.month || '',
      'عدد الأيام': r.daysCount || 0,
      'نوع المصروف': r.expenseType || '',
      'إعاشة (ج)': Number(r.livingAmount) || 0,
      'انتقال (ج)': Number(r.transportAmount) || 0,
      'كهرباء (ج)': Number(r.electricityAmount) || 0,
      'الإجمالي (ج)': Number(r.totalAmount) || 0,
      'تاريخ التسجيل': r.submittedAt || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المصروفات');
    XLSX.writeFile(wb, `تقرير_المصروفات_${month}.xlsx`);
    exportBtn.disabled = false;
  }

  function loadReport() {
    showLoader('جاري تحميل بيانات المصروفات...');
    MKNexus.ExpensesApi.getExpensesReport()
      .then((data) => {
        hideLoader();
        if (!Array.isArray(data)) {
          reportBodyEl.innerHTML = '<tr><td class="expenses-state-msg" colspan="11">⚠️ أضف action=getExpensesReport في الـ Apps Script أولاً</td></tr>';
          return;
        }
        reportAllData = data;
        buildMonthFilter(data);
        renderKPIs(data);
        renderTable(data);
        renderCards(data);
        animateIn(containerEl.querySelector('.expenses-kpi-strip'));
      })
      .catch((error) => {
        hideLoader();
        reportBodyEl.innerHTML = `<tr><td class="expenses-state-msg" colspan="11">❌ ${escapeHtml(error.message || 'تعذر الاتصال بالخادم')}</td></tr>`;
      });
  }

  function bindReportView() {
    monthFilterEl.addEventListener('change', applyFilter);
    typeFilterEl.addEventListener('change', applyFilter);
    exportBtn.addEventListener('click', exportExcel);
  }

  function bindTopTabs() {
    tabsEl.hidden = false;
    tabsEl.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabsEl.querySelectorAll('[data-tab]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const tab = btn.dataset.tab;
        formViewEl.hidden = tab !== 'form';
        reportViewEl.hidden = tab !== 'report';
        if (tab === 'report' && !reportLoadedOnce) { reportLoadedOnce = true; loadReport(); }
      });
    });
  }

  /* -------------------------------------------------------------------
     Mount / unmount
  ------------------------------------------------------------------- */
  function cacheDom() {
    empIdInput = document.getElementById('expEmpId');
    monthSelect = document.getElementById('expMonth');
    daysBoxEl = document.getElementById('expDaysBox');
    summaryEl = document.getElementById('expSummary');
    daysCountEl = document.getElementById('expDaysCount');
    totalEl = document.getElementById('expTotal');
    transportBoxEl = document.getElementById('expTransportBox');
    dividerTransportEl = document.getElementById('expDividerTransport');
    transportSectionEl = document.getElementById('expTransportSection');
    dividerElecEl = document.getElementById('expDividerElec');
    elecSectionEl = document.getElementById('expElecSection');
    elecAmountInput = document.getElementById('expElecAmount');
    elecYearInput = document.getElementById('expElecYear');
    elecMonthInput = document.getElementById('expElecMonth');
    elecDayInput = document.getElementById('expElecDay');
    submitBtn = document.getElementById('expSubmitBtn');
    successBoxEl = document.getElementById('expSuccessBox');
    formViewEl = document.getElementById('expensesFormView');
    reportViewEl = document.getElementById('expensesReportView');
    tabsEl = document.getElementById('expensesTabs');
    reportBodyEl = document.getElementById('expReportBody');
    reportCardsEl = document.getElementById('expReportCards');
    monthFilterEl = document.getElementById('expMonthFilter');
    typeFilterEl = document.getElementById('expTypeFilter');
    exportBtn = document.getElementById('expExportBtn');
    loaderEl = document.getElementById('expensesLoader');
    loaderTextEl = document.getElementById('expensesLoaderText');
  }

  function mount(container) {
    containerEl = container;
    container.innerHTML = template();
    cacheDom();

    reportLoadedOnce = false;
    reportAllData = [];

    bindFormView();
    if (isAdmin()) {
      bindTopTabs();
      bindReportView();
    }

    if (typeof gsap !== 'undefined' && !prefersReducedMotion()) {
      gsap.fromTo([containerEl.querySelector('.expenses-module__header'), containerEl.querySelector('.expenses-form-card')],
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' });
    }
  }

  function unmount(container) {
    container.innerHTML = '';
  }

  return { mount, unmount };
})();
