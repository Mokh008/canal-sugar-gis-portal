window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Settings module. Talks to the mk-nexus-core backend
   (assets/js/api/config.js's baseUrl — same one login/Geo Intelligence
   use) via the getUsers/createUser/updateUser/deleteUser/activateUser/
   deactivateUser/assignRole actions, all of which were already
   registered in that backend's router (backend/mk-nexus-core/router.gs)
   and its frontend action whitelist (api/config.js) but had no UI
   calling them until now.

   IMPORTANT — backend contract caveat: the actual handler functions
   (handleGetUsers_, handleCreateUser_, handleUpdateUser_, etc.) live
   only in the live Apps Script project and weren't available to write
   this against directly (see backend/README.md's "What wasn't touched"
   section). The field names used below for create/update
   (Name/Username/Email/Role/…) are the most defensible guess available:
     - Name/Username/Email/Role come straight from
       backend/mk-nexus-core/validation.gs's VALIDATION_SCHEMAS_ for the
       User entity type — that file IS fully visible, and lists those
       four as the literal required payload keys.
     - Everything else (GovernorateID/AdministrationID/DistrictID/
       SectorID/ManagerID/EngineerID/IsActive) matches the Users sheet's
       own column headers exactly, the same convention auth.gs and
       directory.gs already read from (readSheetAsObjects_ keys objects
       by literal header text).
     - The initial-password field is the biggest unknown — sent as
       `PasswordHash`, matching the sheet's own column name and how the
       rest of this system already treats that column pre-migration
       (see auth.gs's header comment).
     - Role changes are sent BOTH inside updateUser's payload AND via a
       separate assignRole call, since it's unclear from what's visible
       here whether updateUser's own handler even touches Role at all
       (assignRole existing as a distinct action suggests maybe not) —
       redundant but harmless either way.
   Test create/edit/delete against a throwaway account first if possible
   — these write directly to the same Users sheet every login checks
   against. If a field turns out wrong, the fix is a one-line rename
   here once the actual handler source is available. */
MKNexus.SettingsModule = (function () {
  let containerEl = null;
  let loaderEl, loaderTextEl, tabsEl;
  let profileViewEl, prefsViewEl, usersViewEl;
  let themeSwitchEl;
  let usersTableBodyEl, usersCardsEl, usersSearchEl, addUserBtn, usersStateEl;
  let modalEl, modalTitleEl, modalNoteEl;
  let fldId, fldName, fldUsername, fldEmail, fldRole, fldPassword, fldPasswordRow,
    fldGov, fldAdmin, fldDistrict, fldSector, fldManager, fldEngineer;

  let allUsers = [];
  let usersLoadedOnce = false;
  let editingOriginalRole = null;

  const escapeHtml = MKNexus.Utils.escapeHtml;
  const animateIn = MKNexus.Utils.animateIn;
  const prefersReducedMotion = MKNexus.Utils.prefersReducedMotion;
  function showLoader(text) { MKNexus.Utils.showLoader(loaderEl, loaderTextEl, text); }
  function hideLoader() { MKNexus.Utils.hideLoader(loaderEl); }

  const ROLE_OPTIONS = ['Admin', 'Section Manger', 'Manager', 'Engineer', 'Supervisor'];

  function deriveInitials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';
  }

  /* -------------------------------------------------------------------
     Template
  ------------------------------------------------------------------- */
  function template() {
    const isAdmin = MKNexus.Access.isAdmin();
    return `
      <div class="settings-module" dir="rtl">
        <div class="settings-module__header">
          <div>
            <span class="type-eyebrow settings-module__eyebrow">ACCOUNT & SYSTEM</span>
            <h1 class="settings-module__title">الإعدادات</h1>
            <p class="settings-module__subtitle">بيانات حسابك، تفضيلات العرض${isAdmin ? '، وإدارة المستخدمين' : ''}</p>
          </div>
          <div class="settings-tabs" id="settingsTabs">
            <button class="settings-tab is-active" type="button" data-tab="profile">البروفايل</button>
            <button class="settings-tab" type="button" data-tab="preferences">التفضيلات</button>
            ${isAdmin ? '<button class="settings-tab" type="button" data-tab="users">إدارة المستخدمين</button>' : ''}
          </div>
        </div>

        <section class="settings-view" id="settingsProfileView">
          <div class="settings-card">
            <div class="settings-profile">
              <div class="settings-profile__avatar-wrap">
                <span class="settings-profile__avatar" id="settingsProfileAvatar"></span>
                <button class="settings-profile__avatar-edit" type="button" id="settingsAvatarEditBtn" title="تغيير الصورة الشخصية">
                  <i class="fa-solid fa-camera"></i>
                </button>
                <input type="file" accept="image/*" id="settingsAvatarInput" hidden>
              </div>
              <div>
                <div class="settings-profile__name" id="settingsProfileName"></div>
                <div class="settings-profile__role" id="settingsProfileRole"></div>
              </div>
            </div>
            <div class="settings-info-grid">
              <div><span class="settings-info-item__label">اسم المستخدم</span><span class="settings-info-item__value" id="settingsProfileUsername"></span></div>
              <div><span class="settings-info-item__label">البريد الإلكتروني</span><span class="settings-info-item__value" id="settingsProfileEmail"></span></div>
              <div><span class="settings-info-item__label">رقم المهندس</span><span class="settings-info-item__value" id="settingsProfileEngineerId"></span></div>
              <div><span class="settings-info-item__label">كود القطاع</span><span class="settings-info-item__value" id="settingsProfileSectorId"></span></div>
            </div>
          </div>
        </section>

        <section class="settings-view" id="settingsPreferencesView" hidden>
          <div class="settings-card">
            <div class="settings-pref-row">
              <div>
                <div class="settings-pref-row__label">الوضع الفاتح (Light theme)</div>
                <div class="settings-pref-row__desc">نفس الزرار الموجود في أعلى الصفحة — بيتزامن مع بعضه</div>
              </div>
              <label class="settings-switch">
                <input type="checkbox" id="settingsThemeSwitch">
                <span class="settings-switch__track"></span>
              </label>
            </div>
            <div class="settings-pref-row">
              <div>
                <div class="settings-pref-row__label">اللغة</div>
                <div class="settings-pref-row__desc">دعم تعدد اللغات لسه مش متاح في النظام — الواجهة عربي/إنجليزي حسب كل موديول</div>
              </div>
              <span class="settings-badge settings-badge--role">قريباً</span>
            </div>
          </div>
        </section>

        ${isAdmin ? `
        <section class="settings-view" id="settingsUsersView" hidden>
          <div class="settings-users-toolbar">
            <input class="settings-input settings-users-search" id="settingsUsersSearch" type="text" placeholder="بحث بالاسم أو اسم المستخدم...">
            <button class="btn btn--primary" type="button" id="settingsAddUserBtn"><i class="fa-solid fa-user-plus"></i><span>إضافة مستخدم</span></button>
          </div>
          <div class="settings-table-wrap">
            <table class="settings-table">
              <thead><tr>
                <th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>القطاع</th><th>المدير المباشر</th><th>الحالة</th><th>إجراءات</th>
              </tr></thead>
              <tbody id="settingsUsersBody"><tr><td class="settings-state-msg" colspan="7">جاري التحميل...</td></tr></tbody>
            </table>
          </div>
          <div class="settings-cards" id="settingsUsersCards"></div>
        </section>` : ''}

        ${isAdmin ? `
        <div class="settings-modal" id="settingsUserModal">
          <div class="settings-modal__panel">
            <div class="settings-modal__header">
              <span class="settings-modal__title" id="settingsModalTitle">إضافة مستخدم</span>
              <button class="settings-modal__close" type="button" id="settingsModalCloseBtn"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="settings-modal__note" id="settingsModalNote"></div>
            <form id="settingsUserForm">
              <div class="settings-modal__grid">
                <div class="settings-field settings-field--full">
                  <label class="settings-label">الاسم الكامل</label>
                  <input class="settings-input" id="settingsFldName" required>
                </div>
                <div class="settings-field">
                  <label class="settings-label">اسم المستخدم</label>
                  <input class="settings-input" id="settingsFldUsername" required>
                </div>
                <div class="settings-field">
                  <label class="settings-label">البريد الإلكتروني</label>
                  <input class="settings-input" type="email" id="settingsFldEmail" required>
                </div>
                <div class="settings-field" id="settingsFldPasswordRow">
                  <label class="settings-label">كلمة مرور مبدئية</label>
                  <input class="settings-input" type="text" id="settingsFldPassword" placeholder="مطلوبة عند الإضافة فقط">
                </div>
                <div class="settings-field">
                  <label class="settings-label">الدور</label>
                  <select class="settings-select" id="settingsFldRole">
                    ${ROLE_OPTIONS.map((r) => `<option value="${r}">${r}</option>`).join('')}
                  </select>
                </div>
                <div class="settings-field">
                  <label class="settings-label">رقم المهندس (EngineerID)</label>
                  <input class="settings-input" id="settingsFldEngineer">
                </div>
                <div class="settings-field">
                  <label class="settings-label">كود القطاع (SectorID)</label>
                  <input class="settings-input" id="settingsFldSector">
                </div>
                <div class="settings-field">
                  <label class="settings-label">ID المدير المباشر (ManagerID)</label>
                  <input class="settings-input" id="settingsFldManager">
                </div>
                <div class="settings-field">
                  <label class="settings-label">المحافظة (GovernorateID)</label>
                  <input class="settings-input" id="settingsFldGov">
                </div>
                <div class="settings-field">
                  <label class="settings-label">الإدارة (AdministrationID)</label>
                  <input class="settings-input" id="settingsFldAdmin">
                </div>
                <div class="settings-field">
                  <label class="settings-label">المركز (DistrictID)</label>
                  <input class="settings-input" id="settingsFldDistrict">
                </div>
              </div>
              <div class="settings-modal__actions">
                <button class="btn btn--ghost" type="button" id="settingsModalCancelBtn">إلغاء</button>
                <button class="btn btn--primary" type="submit" id="settingsModalSaveBtn">حفظ</button>
              </div>
            </form>
          </div>
        </div>` : ''}

        <div class="settings-loader" id="settingsLoader">
          <div class="settings-spinner"></div>
          <div class="settings-loader-text" id="settingsLoaderText">جاري التنفيذ...</div>
        </div>
      </div>`;
  }

  /* -------------------------------------------------------------------
     Profile tab
  ------------------------------------------------------------------- */
  function renderProfile() {
    const p = MKNexus.SessionData?.profile || {};
    const avatarEl = document.getElementById('settingsProfileAvatar');
    // Same has-photo/background-image approach as header.js's
    // updateProfileDisplay — kept in sync with it (see bindAvatarUpload
    // below), guarded the same way against a malformed URL.
    if (p.avatarUrl && MKNexus.Utils.isSafeHttpsUrl(p.avatarUrl)) {
      avatarEl.style.backgroundImage = `url('${p.avatarUrl}')`;
      avatarEl.classList.add('has-photo');
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.classList.remove('has-photo');
      avatarEl.textContent = p.initials || deriveInitials(p.name);
    }
    document.getElementById('settingsProfileName').textContent = p.name || '—';
    document.getElementById('settingsProfileRole').textContent = p.role || '—';
    document.getElementById('settingsProfileUsername').textContent = p.username || '—';
    document.getElementById('settingsProfileEmail').textContent = p.email || '—';
    document.getElementById('settingsProfileEngineerId').textContent = p.engineerId || '—';
    document.getElementById('settingsProfileSectorId').textContent = p.sectorId || '—';
  }

  // Reads the chosen file, downscales it on a <canvas> (max 300px on the
  // longer side, JPEG @ 0.85) and resolves to a bare base64 string (no
  // "data:image/jpeg;base64," prefix — avatar.gs decodes it directly).
  // A phone photo can be several MB; this keeps the POST body and the
  // resulting Drive file small regardless of what was actually selected.
  function resizeImageToBase64(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('تعذرت قراءة الملف'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('الملف المختار مش صورة صحيحة'));
        img.onload = () => {
          let { width, height } = img;
          if (width >= height && width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else if (height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function handleAvatarFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // lets the same file be re-picked later (e.g. after an error)
    if (!file) return;
    if (!file.type.startsWith('image/')) { MKNexus.Toast.warning('من فضلك اختر ملف صورة'); return; }

    showLoader('جاري رفع الصورة...');
    resizeImageToBase64(file, 300, 0.85)
      .then((base64) => MKNexus.ApiClient.uploadAvatar({ imageBase64: base64, mimeType: 'image/jpeg' }))
      .then((data) => {
        hideLoader();
        if (!data?.avatarUrl) { MKNexus.Toast.error('لم يتم استلام رابط الصورة من الخادم'); return; }
        MKNexus.SessionData.profile.avatarUrl = data.avatarUrl;
        renderProfile();
        // Keeps the header's own avatar in sync immediately — same
        // pattern shell.js uses on a fresh login (see its mount()).
        MKNexus.Header.updateProfileDisplay(MKNexus.SessionData.profile);
        MKNexus.Toast.success('تم تحديث الصورة الشخصية');
      })
      .catch((error) => {
        hideLoader();
        MKNexus.Toast.error(error?.message || 'تعذر رفع الصورة');
      });
  }

  function bindAvatarUpload() {
    const editBtn = document.getElementById('settingsAvatarEditBtn');
    const fileInput = document.getElementById('settingsAvatarInput');
    editBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleAvatarFileChange);
  }

  /* -------------------------------------------------------------------
     Preferences tab
  ------------------------------------------------------------------- */
  function bindPreferences() {
    themeSwitchEl.checked = MKNexus.Header.isLightTheme();
    themeSwitchEl.addEventListener('change', () => {
      MKNexus.Header.applyTheme(themeSwitchEl.checked);
    });
  }

  /* -------------------------------------------------------------------
     Users tab (Admin only)
  ------------------------------------------------------------------- */
  function isActiveUser(u) {
    return String(u?.IsActive ?? 'TRUE').toUpperCase() !== 'FALSE';
  }

  function matchesSearch(u, query) {
    if (!query) return true;
    const haystack = `${u.FullName || ''} ${u.Username || ''} ${u.Email || ''}`.toLowerCase();
    return haystack.includes(query);
  }

  function userRowHtml(u) {
    const active = isActiveUser(u);
    return `
      <tr data-user-id="${escapeHtml(u.ID || '')}">
        <td class="settings-strong">${escapeHtml(u.FullName) || '—'}</td>
        <td class="settings-muted">${escapeHtml(u.Username) || '—'}</td>
        <td><span class="settings-badge settings-badge--role">${escapeHtml(u.Role) || '—'}</span></td>
        <td class="settings-muted">${escapeHtml(u.SectorID) || '—'}</td>
        <td class="settings-muted">${escapeHtml(u.ManagerID) || '—'}</td>
        <td><span class="settings-badge ${active ? 'settings-badge--active' : 'settings-badge--inactive'}">${active ? 'مفعّل' : 'موقوف'}</span></td>
        <td>
          <div class="settings-row-actions">
            <button class="settings-icon-btn" type="button" data-action="edit" title="تعديل"><i class="fa-solid fa-pen"></i></button>
            <button class="settings-icon-btn" type="button" data-action="toggle" title="${active ? 'إيقاف' : 'تفعيل'}"><i class="fa-solid ${active ? 'fa-user-slash' : 'fa-user-check'}"></i></button>
            <button class="settings-icon-btn settings-icon-btn--danger" type="button" data-action="delete" title="حذف"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
  }

  function userCardHtml(u) {
    const active = isActiveUser(u);
    return `
      <div class="settings-card settings-user-card" data-user-id="${escapeHtml(u.ID || '')}">
        <div class="settings-user-card__top">
          <span class="settings-user-card__name">${escapeHtml(u.FullName) || '—'}</span>
          <span class="settings-badge ${active ? 'settings-badge--active' : 'settings-badge--inactive'}">${active ? 'مفعّل' : 'موقوف'}</span>
        </div>
        <div class="settings-user-card__grid">
          <div><span class="settings-info-item__label">اسم المستخدم</span><span class="settings-info-item__value">${escapeHtml(u.Username) || '—'}</span></div>
          <div><span class="settings-info-item__label">الدور</span><span class="settings-info-item__value">${escapeHtml(u.Role) || '—'}</span></div>
          <div><span class="settings-info-item__label">القطاع</span><span class="settings-info-item__value">${escapeHtml(u.SectorID) || '—'}</span></div>
          <div><span class="settings-info-item__label">المدير</span><span class="settings-info-item__value">${escapeHtml(u.ManagerID) || '—'}</span></div>
        </div>
        <div class="settings-row-actions">
          <button class="settings-icon-btn" type="button" data-action="edit" title="تعديل"><i class="fa-solid fa-pen"></i></button>
          <button class="settings-icon-btn" type="button" data-action="toggle" title="${active ? 'إيقاف' : 'تفعيل'}"><i class="fa-solid ${active ? 'fa-user-slash' : 'fa-user-check'}"></i></button>
          <button class="settings-icon-btn settings-icon-btn--danger" type="button" data-action="delete" title="حذف"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
  }

  function renderUsers() {
    const query = (usersSearchEl.value || '').trim().toLowerCase();
    const rows = allUsers.filter((u) => matchesSearch(u, query));
    if (!rows.length) {
      usersTableBodyEl.innerHTML = '<tr><td class="settings-state-msg" colspan="7">لا يوجد مستخدمين مطابقين</td></tr>';
      usersCardsEl.innerHTML = '<div class="settings-state-msg">لا يوجد مستخدمين مطابقين</div>';
      return;
    }
    usersTableBodyEl.innerHTML = rows.map(userRowHtml).join('');
    usersCardsEl.innerHTML = rows.map(userCardHtml).join('');
    animateIn(usersViewEl);
  }

  // Backend response shape for getUsers isn't confirmed (see file header
  // comment) — normalized here so the rest of this module only ever
  // deals with one shape (an array of row objects keyed by the Users
  // sheet's own headers), regardless of whether the real response is a
  // bare array or wrapped in { users: [...] }.
  function normalizeUsersResponse(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.users)) return data.users;
    return [];
  }

  function loadUsers() {
    showLoader('جاري تحميل المستخدمين...');
    MKNexus.ApiClient.getUsers()
      .then((data) => {
        hideLoader();
        allUsers = normalizeUsersResponse(data);
        if (!allUsers.length) {
          usersTableBodyEl.innerHTML = '<tr><td class="settings-state-msg" colspan="7">لا يوجد مستخدمين، أو تعذر قراءة استجابة الخادم</td></tr>';
          usersCardsEl.innerHTML = '';
          return;
        }
        renderUsers();
      })
      .catch((error) => {
        hideLoader();
        usersTableBodyEl.innerHTML = `<tr><td class="settings-state-msg" colspan="7">❌ ${escapeHtml(error.message || 'تعذر تحميل المستخدمين')}</td></tr>`;
      });
  }

  function findUser(id) {
    return allUsers.find((u) => String(u.ID) === String(id));
  }

  /* -------------------------------------------------------------------
     Create/Edit modal
  ------------------------------------------------------------------- */
  function openModal(user) {
    const isEdit = Boolean(user);
    modalTitleEl.textContent = isEdit ? 'تعديل مستخدم' : 'إضافة مستخدم';
    modalNoteEl.textContent = isEdit
      ? 'سيب خانة كلمة المرور فاضية لو مش عايز تغيّرها.'
      : 'اكتب كلمة مرور مبدئية — المستخدم هيقدر يغيّرها بعد أول دخول.';
    fldId.value = user?.ID || '';
    fldName.value = user?.FullName || '';
    fldUsername.value = user?.Username || '';
    fldEmail.value = user?.Email || '';
    fldRole.value = user?.Role && ROLE_OPTIONS.includes(user.Role) ? user.Role : ROLE_OPTIONS[0];
    fldEngineer.value = user?.EngineerID || '';
    fldSector.value = user?.SectorID || '';
    fldManager.value = user?.ManagerID || '';
    fldGov.value = user?.GovernorateID || '';
    fldAdmin.value = user?.AdministrationID || '';
    fldDistrict.value = user?.DistrictID || '';
    fldPassword.value = '';
    fldPassword.placeholder = isEdit ? 'اتركها فارغة لعدم التغيير' : 'مطلوبة';
    editingOriginalRole = user?.Role || null;
    modalEl.classList.add('is-open');
    window.setTimeout(() => fldName.focus(), 50);
  }

  function closeModal() {
    modalEl.classList.remove('is-open');
  }

  function submitModal(event) {
    event.preventDefault();
    const isEdit = Boolean(fldId.value);
    const payload = {
      Name: fldName.value.trim(),
      Username: fldUsername.value.trim(),
      Email: fldEmail.value.trim(),
      Role: fldRole.value,
      EngineerID: fldEngineer.value.trim(),
      SectorID: fldSector.value.trim(),
      ManagerID: fldManager.value.trim(),
      GovernorateID: fldGov.value.trim(),
      AdministrationID: fldAdmin.value.trim(),
      DistrictID: fldDistrict.value.trim(),
    };
    if (!payload.Name || !payload.Username || !payload.Email) {
      MKNexus.Toast.warning('من فضلك املأ الاسم واسم المستخدم والبريد الإلكتروني');
      return;
    }
    if (!isEdit && !fldPassword.value.trim()) {
      MKNexus.Toast.warning('كلمة المرور المبدئية مطلوبة عند إضافة مستخدم جديد');
      return;
    }
    if (fldPassword.value.trim()) payload.PasswordHash = fldPassword.value.trim();

    showLoader(isEdit ? 'جاري حفظ التعديلات...' : 'جاري إضافة المستخدم...');

    const request = isEdit
      ? MKNexus.ApiClient.updateUser({ id: fldId.value, ...payload })
        // Sent again via the dedicated action too — see this file's
        // header comment on why role changes go through both paths.
        .then(() => (payload.Role !== editingOriginalRole
          ? MKNexus.ApiClient.assignRole({ id: fldId.value, role: payload.Role }).catch(() => {})
          : null))
      : MKNexus.ApiClient.createUser(payload);

    request
      .then(() => {
        hideLoader();
        MKNexus.Toast.success(isEdit ? 'تم حفظ التعديلات' : 'تمت إضافة المستخدم');
        closeModal();
        loadUsers();
      })
      .catch((error) => {
        hideLoader();
        MKNexus.Toast.error(error?.message || 'حدث خطأ أثناء الحفظ');
      });
  }

  function toggleActive(user) {
    const nowActive = isActiveUser(user);
    showLoader(nowActive ? 'جاري إيقاف المستخدم...' : 'جاري تفعيل المستخدم...');
    const call = nowActive ? MKNexus.ApiClient.deactivateUser({ id: user.ID }) : MKNexus.ApiClient.activateUser({ id: user.ID });
    call
      .then(() => { hideLoader(); MKNexus.Toast.success('تم الحفظ'); loadUsers(); })
      .catch((error) => { hideLoader(); MKNexus.Toast.error(error?.message || 'تعذر تنفيذ الإجراء'); });
  }

  function deleteUserRow(user) {
    const confirmed = window.confirm(`تأكيد حذف المستخدم "${user.FullName || user.Username}"؟ هذا الإجراء لا يمكن التراجع عنه.`);
    if (!confirmed) return;
    showLoader('جاري الحذف...');
    MKNexus.ApiClient.deleteUser({ id: user.ID })
      .then(() => { hideLoader(); MKNexus.Toast.success('تم الحذف'); loadUsers(); })
      .catch((error) => { hideLoader(); MKNexus.Toast.error(error?.message || 'تعذر الحذف'); });
  }

  function bindUsersView() {
    addUserBtn.addEventListener('click', () => openModal(null));
    usersSearchEl.addEventListener('input', renderUsers);

    function handleRowAction(e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const row = btn.closest('[data-user-id]');
      const user = findUser(row?.dataset.userId);
      if (!user) return;
      if (btn.dataset.action === 'edit') openModal(user);
      else if (btn.dataset.action === 'toggle') toggleActive(user);
      else if (btn.dataset.action === 'delete') deleteUserRow(user);
    }
    usersTableBodyEl.addEventListener('click', handleRowAction);
    usersCardsEl.addEventListener('click', handleRowAction);

    document.getElementById('settingsModalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('settingsModalCancelBtn').addEventListener('click', closeModal);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
    document.getElementById('settingsUserForm').addEventListener('submit', submitModal);

    loadUsers();
  }

  /* -------------------------------------------------------------------
     Tabs
  ------------------------------------------------------------------- */
  function bindTabs() {
    tabsEl.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabsEl.querySelectorAll('[data-tab]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const tab = btn.dataset.tab;
        profileViewEl.hidden = tab !== 'profile';
        prefsViewEl.hidden = tab !== 'preferences';
        if (usersViewEl) usersViewEl.hidden = tab !== 'users';
        if (tab === 'users' && !usersLoadedOnce) { usersLoadedOnce = true; bindUsersView(); }
      });
    });
  }

  /* -------------------------------------------------------------------
     Mount / unmount
  ------------------------------------------------------------------- */
  function cacheDom() {
    loaderEl = document.getElementById('settingsLoader');
    loaderTextEl = document.getElementById('settingsLoaderText');
    tabsEl = document.getElementById('settingsTabs');
    profileViewEl = document.getElementById('settingsProfileView');
    prefsViewEl = document.getElementById('settingsPreferencesView');
    usersViewEl = document.getElementById('settingsUsersView');
    themeSwitchEl = document.getElementById('settingsThemeSwitch');

    if (MKNexus.Access.isAdmin()) {
      usersTableBodyEl = document.getElementById('settingsUsersBody');
      usersCardsEl = document.getElementById('settingsUsersCards');
      usersSearchEl = document.getElementById('settingsUsersSearch');
      addUserBtn = document.getElementById('settingsAddUserBtn');
      modalEl = document.getElementById('settingsUserModal');
      modalTitleEl = document.getElementById('settingsModalTitle');
      modalNoteEl = document.getElementById('settingsModalNote');
      fldId = { value: '' }; // synthetic — real ID lives only in-memory (see openModal), never a form field a user could tamper with
      fldName = document.getElementById('settingsFldName');
      fldUsername = document.getElementById('settingsFldUsername');
      fldEmail = document.getElementById('settingsFldEmail');
      fldRole = document.getElementById('settingsFldRole');
      fldPassword = document.getElementById('settingsFldPassword');
      fldEngineer = document.getElementById('settingsFldEngineer');
      fldSector = document.getElementById('settingsFldSector');
      fldManager = document.getElementById('settingsFldManager');
      fldGov = document.getElementById('settingsFldGov');
      fldAdmin = document.getElementById('settingsFldAdmin');
      fldDistrict = document.getElementById('settingsFldDistrict');
    }
  }

  function mount(container) {
    containerEl = container;
    container.innerHTML = template();
    cacheDom();

    usersLoadedOnce = false;
    allUsers = [];

    renderProfile();
    bindAvatarUpload();
    bindPreferences();
    bindTabs();

    if (typeof gsap !== 'undefined' && !prefersReducedMotion()) {
      gsap.fromTo([containerEl.querySelector('.settings-module__header'), containerEl.querySelector('.settings-card')],
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' });
    }
  }

  function unmount(container) {
    container.innerHTML = '';
  }

  return { mount, unmount };
})();
