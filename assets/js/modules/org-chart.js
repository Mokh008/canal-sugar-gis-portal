window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Org Chart module (Admin only). Lets an Admin build the
   organizational reporting hierarchy — Sector -> Administration ->
   Region — and place users into it, entirely from the website. Talks
   to the mk-nexus-core backend (assets/js/api/config.js's baseUrl) via
   getOrgStructure/create|update|deleteOrgSector/Administration/Region
   (see backend/mk-nexus-core/org-structure.gs) plus the existing
   getUsers/updateUser actions (users.gs) to assign/unassign people.

   THREE-COLUMN "MILLER COLUMNS" UI: pick a Sector -> its Administrations
   appear in column 2 -> pick one -> its Regions appear in column 3. The
   Members panel below shows whoever is currently placed at the deepest
   selected level, with a dropdown to assign someone new:
     - Sector selected only:        Section Manger(s) whose SectorID = this Sector
     - + Administration selected:   Manager(s) whose OrgAdministrationID = this Administration
     - + Region selected:           Engineer/Supervisor(s) whose OrgRegionID = this Region

   ASSIGNING ALSO STAMPS THE LEGACY SectorID/ManagerID FIELDS so the
   existing 2-tier report scoping (core/data/team-directory.js — Rent/
   Expenses admin views) keeps working correctly for anyone placed via
   this tool, without waiting on that file's own migration to the full
   3-tier tree:
     - Assign to a Region  -> also sets SectorID (via Region's
       Administration's SectorID) and, if exactly one Manager currently
       heads that Administration, ManagerID too (ambiguous otherwise —
       left untouched rather than guessing).
     - Assign to an Administration -> also sets SectorID.
   Unassigning clears the field the user was removed from AND every
   legacy field that was auto-stamped alongside it, so nobody is left
   pointing at a scope they're no longer actually part of. */
MKNexus.OrgChartModule = (function () {
  let containerEl = null;
  let loaderEl, loaderTextEl;
  let sectorsListEl, adminsListEl, regionsListEl, adminsAddBtn, regionsAddBtn;
  let membersHeadEl, membersListEl, assignSelectEl, assignBtn;
  let nameModalEl, nameModalTitleEl, nameInputEl, nameModalSaveBtn, nameModalCancelBtn;

  const escapeHtml = MKNexus.Utils.escapeHtml;
  const animateIn = MKNexus.Utils.animateIn;
  const prefersReducedMotion = MKNexus.Utils.prefersReducedMotion;
  function showLoader(text) { MKNexus.Utils.showLoader(loaderEl, loaderTextEl, text); }
  function hideLoader() { MKNexus.Utils.hideLoader(loaderEl); }

  let sectors = [], administrations = [], regions = [], allUsers = [];
  let selectedSectorId = null, selectedAdministrationId = null, selectedRegionId = null;

  // Pending name-modal action: { mode: 'create'|'rename', level, id }
  let pendingNameAction = null;

  /* -------------------------------------------------------------------
     Template
  ------------------------------------------------------------------- */
  function template() {
    return `
      <div class="orgchart-module">
        <div class="orgchart-module__header">
          <span class="type-eyebrow orgchart-module__eyebrow">ORG CHART</span>
          <h1 class="orgchart-module__title">Organization Structure</h1>
          <p class="orgchart-module__subtitle">Sector → Administration → Region — who reports to whom, and who sees whose reports</p>
        </div>

        <div class="orgchart-columns">
          <div class="orgchart-column">
            <div class="orgchart-column__head">
              <span class="orgchart-column__title">Sectors</span>
              <button class="orgchart-column__add" type="button" id="orgSectorsAddBtn" title="Add sector"><i class="fa-solid fa-plus"></i></button>
            </div>
            <div class="orgchart-column__list" id="orgSectorsList"></div>
          </div>
          <div class="orgchart-column">
            <div class="orgchart-column__head">
              <span class="orgchart-column__title">Administrations</span>
              <button class="orgchart-column__add" type="button" id="orgAdminsAddBtn" title="Add administration"><i class="fa-solid fa-plus"></i></button>
            </div>
            <div class="orgchart-column__list" id="orgAdminsList"></div>
          </div>
          <div class="orgchart-column">
            <div class="orgchart-column__head">
              <span class="orgchart-column__title">Regions</span>
              <button class="orgchart-column__add" type="button" id="orgRegionsAddBtn" title="Add region"><i class="fa-solid fa-plus"></i></button>
            </div>
            <div class="orgchart-column__list" id="orgRegionsList"></div>
          </div>
        </div>

        <div class="orgchart-members">
          <div class="orgchart-members__head">
            <div>
              <div class="orgchart-members__title" id="orgMembersTitle">Select a sector, administration, or region</div>
              <div class="orgchart-members__breadcrumb" id="orgMembersBreadcrumb"></div>
            </div>
            <div class="orgchart-members__assign" id="orgAssignRow" hidden>
              <select class="settings-select" id="orgAssignSelect"></select>
              <button class="btn btn--primary" type="button" id="orgAssignBtn"><i class="fa-solid fa-user-plus"></i><span>Add</span></button>
            </div>
          </div>
          <div class="orgchart-member-list" id="orgMembersList"></div>
        </div>

        <div class="orgchart-modal" id="orgNameModal">
          <div class="orgchart-modal__panel">
            <div class="orgchart-modal__title" id="orgNameModalTitle">Add</div>
            <div class="settings-field settings-field--full">
              <label class="settings-label">Name</label>
              <input class="settings-input" id="orgNameInput" type="text">
            </div>
            <div class="orgchart-modal__actions">
              <button class="btn btn--ghost" type="button" id="orgNameModalCancelBtn">Cancel</button>
              <button class="btn btn--primary" type="button" id="orgNameModalSaveBtn">Save</button>
            </div>
          </div>
        </div>

        <div class="orgchart-loader" id="orgLoader">
          <div class="orgchart-spinner"></div>
          <div class="orgchart-loader-text" id="orgLoaderText">Working...</div>
        </div>
      </div>`;
  }

  /* -------------------------------------------------------------------
     Data loading
  ------------------------------------------------------------------- */
  function normalizeListResponse(data, key) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.[key])) return data[key];
    return [];
  }

  function loadAll() {
    showLoader('Loading organization structure...');
    return Promise.all([MKNexus.ApiClient.getOrgStructure(), MKNexus.ApiClient.getUsers()])
      .then(([structure, usersData]) => {
        sectors = Array.isArray(structure?.sectors) ? structure.sectors : [];
        administrations = Array.isArray(structure?.administrations) ? structure.administrations : [];
        regions = Array.isArray(structure?.regions) ? structure.regions : [];
        allUsers = normalizeListResponse(usersData, 'users');
        hideLoader();
        renderAll();
      })
      .catch((error) => {
        hideLoader();
        MKNexus.Toast.error(error?.message || 'Failed to load the organization structure');
      });
  }

  /* -------------------------------------------------------------------
     Rendering — columns
  ------------------------------------------------------------------- */
  function nodeRowHtml(id, name, count, isSelected) {
    return `
      <div class="orgchart-node ${isSelected ? 'is-selected' : ''}" data-id="${escapeHtml(id)}">
        <span class="orgchart-node__name">${escapeHtml(name) || '—'}</span>
        <span class="orgchart-node__count">${count}</span>
        <div class="orgchart-node__actions">
          <button class="orgchart-icon-btn" type="button" data-action="rename" title="Rename"><i class="fa-solid fa-pen"></i></button>
          <button class="orgchart-icon-btn orgchart-icon-btn--danger" type="button" data-action="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
  }

  function renderSectors() {
    if (!sectors.length) {
      sectorsListEl.innerHTML = '<div class="orgchart-column__empty">No sectors yet — add one to get started</div>';
      return;
    }
    sectorsListEl.innerHTML = sectors.map((s) => {
      const count = administrations.filter((a) => String(a.SectorID) === String(s.ID)).length;
      return nodeRowHtml(s.ID, s.Name, count, String(s.ID) === String(selectedSectorId));
    }).join('');
  }

  function renderAdministrations() {
    adminsAddBtn.disabled = !selectedSectorId;
    if (!selectedSectorId) {
      adminsListEl.innerHTML = '<div class="orgchart-column__empty">Select a sector first</div>';
      return;
    }
    const rows = administrations.filter((a) => String(a.SectorID) === String(selectedSectorId));
    if (!rows.length) {
      adminsListEl.innerHTML = '<div class="orgchart-column__empty">No administrations under this sector yet</div>';
      return;
    }
    adminsListEl.innerHTML = rows.map((a) => {
      const count = regions.filter((r) => String(r.AdministrationID) === String(a.ID)).length;
      return nodeRowHtml(a.ID, a.Name, count, String(a.ID) === String(selectedAdministrationId));
    }).join('');
  }

  function renderRegions() {
    regionsAddBtn.disabled = !selectedAdministrationId;
    if (!selectedAdministrationId) {
      regionsListEl.innerHTML = '<div class="orgchart-column__empty">Select an administration first</div>';
      return;
    }
    const rows = regions.filter((r) => String(r.AdministrationID) === String(selectedAdministrationId));
    if (!rows.length) {
      regionsListEl.innerHTML = '<div class="orgchart-column__empty">No regions under this administration yet</div>';
      return;
    }
    regionsListEl.innerHTML = rows.map((r) => {
      const memberCount = allUsers.filter((u) => String(u.OrgRegionID) === String(r.ID)).length;
      return nodeRowHtml(r.ID, r.Name, memberCount, String(r.ID) === String(selectedRegionId));
    }).join('');
  }

  /* -------------------------------------------------------------------
     Rendering — members panel
  ------------------------------------------------------------------- */
  function isActiveUser(u) { return String(u?.IsActive ?? 'TRUE').toUpperCase() !== 'FALSE'; }

  function memberRowHtml(u, onRemove) {
    return `
      <div class="orgchart-member-row" data-user-id="${escapeHtml(u.ID || '')}">
        <span>
          <span class="orgchart-member-row__name">${escapeHtml(u.FullName || u.Name) || '—'}</span>
          <span class="orgchart-member-row__role">${escapeHtml(u.Role) || ''}</span>
        </span>
        <button class="orgchart-icon-btn orgchart-icon-btn--danger" type="button" data-action="${onRemove}" title="Remove"><i class="fa-solid fa-user-minus"></i></button>
      </div>`;
  }

  function currentLevel() {
    if (selectedRegionId) return 'region';
    if (selectedAdministrationId) return 'administration';
    if (selectedSectorId) return 'sector';
    return null;
  }

  function renderMembers() {
    const level = currentLevel();
    const assignRow = document.getElementById('orgAssignRow');

    if (!level) {
      membersHeadEl.textContent = 'Select a sector, administration, or region';
      document.getElementById('orgMembersBreadcrumb').textContent = '';
      membersListEl.innerHTML = '';
      assignRow.hidden = true;
      return;
    }

    let members, candidates, breadcrumb, title;
    if (level === 'sector') {
      const sector = sectors.find((s) => String(s.ID) === String(selectedSectorId));
      title = `Sector head: ${sector?.Name || ''}`;
      breadcrumb = sector?.Name || '';
      members = allUsers.filter((u) => String(u.SectorID) === String(selectedSectorId) && u.Role === 'Section Manger');
      candidates = allUsers.filter((u) => isActiveUser(u) && u.Role === 'Section Manger' && String(u.SectorID) !== String(selectedSectorId));
    } else if (level === 'administration') {
      const admin = administrations.find((a) => String(a.ID) === String(selectedAdministrationId));
      const sector = sectors.find((s) => String(s.ID) === String(admin?.SectorID));
      title = `Administration managers: ${admin?.Name || ''}`;
      breadcrumb = `${sector?.Name || ''} → ${admin?.Name || ''}`;
      members = allUsers.filter((u) => String(u.OrgAdministrationID) === String(selectedAdministrationId));
      candidates = allUsers.filter((u) => isActiveUser(u) && u.Role === 'Manager' && String(u.OrgAdministrationID) !== String(selectedAdministrationId));
    } else {
      const region = regions.find((r) => String(r.ID) === String(selectedRegionId));
      const admin = administrations.find((a) => String(a.ID) === String(region?.AdministrationID));
      const sector = sectors.find((s) => String(s.ID) === String(admin?.SectorID));
      title = `Region members: ${region?.Name || ''}`;
      breadcrumb = `${sector?.Name || ''} → ${admin?.Name || ''} → ${region?.Name || ''}`;
      members = allUsers.filter((u) => String(u.OrgRegionID) === String(selectedRegionId));
      candidates = allUsers.filter((u) => isActiveUser(u) && ['Engineer', 'Supervisor'].includes(u.Role) && String(u.OrgRegionID) !== String(selectedRegionId));
    }

    membersHeadEl.textContent = title;
    document.getElementById('orgMembersBreadcrumb').textContent = breadcrumb;

    membersListEl.innerHTML = members.length
      ? members.map((u) => memberRowHtml(u, 'remove')).join('')
      : '<div class="orgchart-column__empty">No members yet</div>';

    assignRow.hidden = false;
    assignSelectEl.innerHTML = candidates.length
      ? candidates.map((u) => `<option value="${escapeHtml(u.ID)}">${escapeHtml(u.FullName || u.Name)} (${escapeHtml(u.Role)})</option>`).join('')
      : '<option value="">No candidates available</option>';
    assignBtn.disabled = !candidates.length;
  }

  function renderAll() {
    renderSectors();
    renderAdministrations();
    renderRegions();
    renderMembers();
    if (typeof gsap !== 'undefined' && !prefersReducedMotion()) animateIn(containerEl.querySelector('.orgchart-columns'));
  }

  /* -------------------------------------------------------------------
     Assign / remove
  ------------------------------------------------------------------- */
  // Finds the single Manager currently heading an Administration, if
  // exactly one exists — used to also stamp the legacy ManagerID field
  // when placing an Engineer/Supervisor into one of that Administration's
  // Regions (see file header). Ambiguous (0 or 2+ managers) -> null,
  // left untouched rather than guessing wrong.
  function soleManagerIdForAdministration(administrationId) {
    const managers = allUsers.filter((u) => String(u.OrgAdministrationID) === String(administrationId) && u.Role === 'Manager');
    return managers.length === 1 ? managers[0].ID : null;
  }

  function assignMember() {
    const userId = assignSelectEl.value;
    if (!userId) return;
    const level = currentLevel();
    let updates;

    if (level === 'sector') {
      updates = { SectorID: selectedSectorId };
    } else if (level === 'administration') {
      const admin = administrations.find((a) => String(a.ID) === String(selectedAdministrationId));
      updates = { OrgAdministrationID: selectedAdministrationId, SectorID: admin?.SectorID || '' };
    } else {
      const region = regions.find((r) => String(r.ID) === String(selectedRegionId));
      const admin = administrations.find((a) => String(a.ID) === String(region?.AdministrationID));
      updates = { OrgRegionID: selectedRegionId, SectorID: admin?.SectorID || '' };
      const managerId = soleManagerIdForAdministration(region?.AdministrationID);
      if (managerId) updates.ManagerID = managerId;
    }

    showLoader('Adding...');
    MKNexus.ApiClient.updateUser({ id: userId, ...updates })
      .then(() => { hideLoader(); MKNexus.Toast.success('Added'); return loadAll(); })
      .catch((error) => { hideLoader(); MKNexus.Toast.error(error?.message || 'Failed to add'); });
  }

  function removeMember(userId) {
    const level = currentLevel();
    // Clears the field the user was placed in AND every legacy field
    // auto-stamped alongside it on assignment (see file header) — a
    // removed member should end up scoped nowhere, not stuck with a
    // stale SectorID/ManagerID pointing at a team they just left.
    const updates = level === 'sector'
      ? { SectorID: '' }
      : level === 'administration'
        ? { OrgAdministrationID: '', SectorID: '' }
        : { OrgRegionID: '', SectorID: '', ManagerID: '' };

    showLoader('Removing...');
    MKNexus.ApiClient.updateUser({ id: userId, ...updates })
      .then(() => { hideLoader(); MKNexus.Toast.success('Removed'); return loadAll(); })
      .catch((error) => { hideLoader(); MKNexus.Toast.error(error?.message || 'Failed to remove'); });
  }

  /* -------------------------------------------------------------------
     Create / rename / delete per level
  ------------------------------------------------------------------- */
  const LEVEL_META = {
    sector: {
      create: (name) => MKNexus.ApiClient.createOrgSector({ Name: name }),
      update: (id, name) => MKNexus.ApiClient.updateOrgSector({ id, Name: name }),
      remove: (id) => MKNexus.ApiClient.deleteOrgSector({ id }),
      createTitle: 'Add sector', renameTitle: 'Rename sector',
      confirmDelete: (name) => `Delete sector "${name}"?`,
    },
    administration: {
      create: (name) => MKNexus.ApiClient.createOrgAdministration({ Name: name, SectorID: selectedSectorId }),
      update: (id, name) => MKNexus.ApiClient.updateOrgAdministration({ id, Name: name }),
      remove: (id) => MKNexus.ApiClient.deleteOrgAdministration({ id }),
      createTitle: 'Add administration', renameTitle: 'Rename administration',
      confirmDelete: (name) => `Delete administration "${name}"?`,
    },
    region: {
      create: (name) => MKNexus.ApiClient.createOrgRegion({ Name: name, AdministrationID: selectedAdministrationId }),
      update: (id, name) => MKNexus.ApiClient.updateOrgRegion({ id, Name: name }),
      remove: (id) => MKNexus.ApiClient.deleteOrgRegion({ id }),
      createTitle: 'Add region', renameTitle: 'Rename region',
      confirmDelete: (name) => `Delete region "${name}"?`,
    },
  };

  function openNameModal(level, mode, id, currentName) {
    pendingNameAction = { level, mode, id };
    nameModalTitleEl.textContent = mode === 'create' ? LEVEL_META[level].createTitle : LEVEL_META[level].renameTitle;
    nameInputEl.value = currentName || '';
    nameModalEl.classList.add('is-open');
    window.setTimeout(() => nameInputEl.focus(), 50);
  }

  function closeNameModal() {
    nameModalEl.classList.remove('is-open');
    pendingNameAction = null;
  }

  function saveNameModal() {
    const name = nameInputEl.value.trim();
    if (!name) { MKNexus.Toast.warning('Please enter a name'); return; }
    const { level, mode, id } = pendingNameAction;
    const meta = LEVEL_META[level];
    showLoader('Saving...');
    const request = mode === 'create' ? meta.create(name) : meta.update(id, name);
    request
      .then(() => { hideLoader(); MKNexus.Toast.success('Saved'); closeNameModal(); return loadAll(); })
      .catch((error) => { hideLoader(); MKNexus.Toast.error(error?.message || 'Something went wrong while saving'); });
  }

  function deleteNode(level, id, name) {
    const meta = LEVEL_META[level];
    if (!window.confirm(meta.confirmDelete(name))) return;
    showLoader('Deleting...');
    meta.remove(id)
      .then(() => {
        hideLoader();
        MKNexus.Toast.success('Deleted');
        if (level === 'sector' && String(selectedSectorId) === String(id)) { selectedSectorId = null; selectedAdministrationId = null; selectedRegionId = null; }
        if (level === 'administration' && String(selectedAdministrationId) === String(id)) { selectedAdministrationId = null; selectedRegionId = null; }
        if (level === 'region' && String(selectedRegionId) === String(id)) { selectedRegionId = null; }
        return loadAll();
      })
      .catch((error) => {
        hideLoader();
        // HAS_DEPENDENTS from org-structure.gs's delete guards — surfaced as-is.
        MKNexus.Toast.error(error?.message || 'Failed to delete');
      });
  }

  /* -------------------------------------------------------------------
     Column click wiring
  ------------------------------------------------------------------- */
  function bindColumn(listEl, level, onSelect) {
    listEl.addEventListener('click', (e) => {
      const node = e.target.closest('.orgchart-node');
      if (!node) return;
      const id = node.dataset.id;
      const actionBtn = e.target.closest('[data-action]');

      if (actionBtn?.dataset.action === 'delete') {
        deleteNode(level, id, node.querySelector('.orgchart-node__name')?.textContent);
        return;
      }
      if (actionBtn?.dataset.action === 'rename') {
        openNameModal(level, 'rename', id, node.querySelector('.orgchart-node__name')?.textContent);
        return;
      }
      onSelect(id);
    });
  }

  function selectSector(id) {
    selectedSectorId = String(selectedSectorId) === String(id) ? null : id;
    selectedAdministrationId = null;
    selectedRegionId = null;
    renderAll();
  }

  function selectAdministration(id) {
    selectedAdministrationId = String(selectedAdministrationId) === String(id) ? null : id;
    selectedRegionId = null;
    renderAll();
  }

  function selectRegion(id) {
    selectedRegionId = String(selectedRegionId) === String(id) ? null : id;
    renderAll();
  }

  /* -------------------------------------------------------------------
     Mount / unmount
  ------------------------------------------------------------------- */
  function cacheDom() {
    loaderEl = document.getElementById('orgLoader');
    loaderTextEl = document.getElementById('orgLoaderText');
    sectorsListEl = document.getElementById('orgSectorsList');
    adminsListEl = document.getElementById('orgAdminsList');
    regionsListEl = document.getElementById('orgRegionsList');
    adminsAddBtn = document.getElementById('orgAdminsAddBtn');
    regionsAddBtn = document.getElementById('orgRegionsAddBtn');
    membersHeadEl = document.getElementById('orgMembersTitle');
    membersListEl = document.getElementById('orgMembersList');
    assignSelectEl = document.getElementById('orgAssignSelect');
    assignBtn = document.getElementById('orgAssignBtn');
    nameModalEl = document.getElementById('orgNameModal');
    nameModalTitleEl = document.getElementById('orgNameModalTitle');
    nameInputEl = document.getElementById('orgNameInput');
    nameModalSaveBtn = document.getElementById('orgNameModalSaveBtn');
    nameModalCancelBtn = document.getElementById('orgNameModalCancelBtn');
  }

  function bind() {
    document.getElementById('orgSectorsAddBtn').addEventListener('click', () => openNameModal('sector', 'create', null));
    adminsAddBtn.addEventListener('click', () => { if (selectedSectorId) openNameModal('administration', 'create', null); });
    regionsAddBtn.addEventListener('click', () => { if (selectedAdministrationId) openNameModal('region', 'create', null); });

    bindColumn(sectorsListEl, 'sector', selectSector);
    bindColumn(adminsListEl, 'administration', selectAdministration);
    bindColumn(regionsListEl, 'region', selectRegion);

    nameModalSaveBtn.addEventListener('click', saveNameModal);
    nameModalCancelBtn.addEventListener('click', closeNameModal);
    nameModalEl.addEventListener('click', (e) => { if (e.target === nameModalEl) closeNameModal(); });

    assignBtn.addEventListener('click', assignMember);
    membersListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="remove"]');
      if (!btn) return;
      const userId = btn.closest('[data-user-id]')?.dataset.userId;
      if (userId) removeMember(userId);
    });
  }

  function mount(container) {
    containerEl = container;
    container.innerHTML = template();
    cacheDom();
    bind();

    sectors = []; administrations = []; regions = []; allUsers = [];
    selectedSectorId = null; selectedAdministrationId = null; selectedRegionId = null;

    loadAll();

    if (typeof gsap !== 'undefined' && !prefersReducedMotion()) {
      gsap.fromTo(containerEl.querySelector('.orgchart-module__header'),
        { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' });
    }
  }

  function unmount(container) {
    container.innerHTML = '';
  }

  return { mount, unmount };
})();
