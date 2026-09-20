window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Org Chart module (Admin only). THE place where the
   organization is laid out: which regions sit under which administration,
   who manages each administration, and which engineers work each region.
   Everything Expenses / Rent / Attendance show a manager (their team's
   data only) is derived from what is set here — see
   core/data/team-directory.js.

   The Users sheet is descriptive only (name, username, role, EngineerID...);
   it holds NO placement. Placement lives in the backend's Org_Assignments
   sheet, written exclusively through assignOrgMember/unassignOrgMember (see
   backend/mk-nexus-core/org-structure.gs), alongside the Sector/
   Administration/Region CRUD (create|update|deleteOrgSector/...) and the
   existing getUsers (the people to place).

   THREE-COLUMN "MILLER COLUMNS" UI: pick a Sector -> its Administrations
   appear in column 2 -> pick one -> its Regions appear in column 3. The
   Members panel below shows whoever sits at the deepest selected level,
   with a dropdown to place someone new:
     - Sector selected only:        the sector head(s)
     - + Administration selected:   the administration's manager(s)
     - + Region selected:           the region's engineers
   Anyone can be picked at any level — a person's Users.Role is just their
   job title; an "Engineer" can perfectly well be an administration's
   manager. A person is the engineer of ONE region at a time, so placing
   them in a region moves them out of their previous one.

   The "Everyone" panel at the bottom answers "what is this person's job
   in the org?" for every active user, and flags anyone not placed yet. */
MKNexus.OrgChartModule = (function () {
  let containerEl = null;
  let loaderEl, loaderTextEl;
  let sectorsListEl, adminsListEl, regionsListEl, adminsAddBtn, regionsAddBtn;
  let membersHeadEl, membersListEl, assignSelectEl, assignBtn;
  let peopleListEl, unplacedOnlyEl;
  let nameModalEl, nameModalTitleEl, nameInputEl, nameModalSaveBtn, nameModalCancelBtn;

  const escapeHtml = MKNexus.Utils.escapeHtml;
  const animateIn = MKNexus.Utils.animateIn;
  const prefersReducedMotion = MKNexus.Utils.prefersReducedMotion;
  function showLoader(text) { MKNexus.Utils.showLoader(loaderEl, loaderTextEl, text); }
  function hideLoader() { MKNexus.Utils.hideLoader(loaderEl); }

  let sectors = [], administrations = [], regions = [], assignments = [], allUsers = [];
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
          <p class="orgchart-module__subtitle">Sector → Administration → Region — place the managers and engineers here; Expenses, Rent and Attendance reports follow it</p>
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

        <div class="orgchart-members orgchart-people">
          <div class="orgchart-members__head">
            <div>
              <div class="orgchart-members__title">Everyone</div>
              <div class="orgchart-members__breadcrumb">Each person's position in the organization</div>
            </div>
            <label class="orgchart-people__filter"><input type="checkbox" id="orgUnplacedOnly"><span>Not placed yet only</span></label>
          </div>
          <div class="orgchart-member-list" id="orgPeopleList"></div>
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
     Data loading + lookups
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
        assignments = Array.isArray(structure?.assignments) ? structure.assignments : [];
        allUsers = normalizeListResponse(usersData, 'users');
        hideLoader();
        renderAll();
      })
      .catch((error) => {
        hideLoader();
        MKNexus.Toast.error(error?.message || 'Failed to load the organization structure');
      });
  }

  function isActiveUser(u) { return String(u?.IsActive ?? 'TRUE').toUpperCase() !== 'FALSE'; }
  function userName(u) { return u?.FullName || u?.Name || u?.Username || ''; }
  function byName(a, b) { return userName(a).localeCompare(userName(b)); }
  function findUser(id) { return allUsers.find((u) => String(u.ID) === String(id)); }
  function sectorOf(id) { return sectors.find((s) => String(s.ID) === String(id)); }
  function administrationOf(id) { return administrations.find((a) => String(a.ID) === String(id)); }
  function regionOf(id) { return regions.find((r) => String(r.ID) === String(id)); }

  // Everyone placed at one node, as user rows (dangling assignments —
  // a user that no longer exists — are skipped).
  function membersAt(level, nodeId) {
    return assignments
      .filter((a) => a.Level === level && String(a.NodeID) === String(nodeId))
      .map((a) => findUser(a.UserID))
      .filter(Boolean)
      .sort(byName);
  }

  // Human-readable list of every position a person holds, e.g.
  // "Administration manager — Canal › Minya". Empty array = not placed.
  function positionLabels(userId) {
    return assignments.filter((a) => String(a.UserID) === String(userId)).map((a) => {
      if (a.Level === 'sector') {
        return `Sector head — ${sectorOf(a.NodeID)?.Name || '?'}`;
      }
      if (a.Level === 'administration') {
        const admin = administrationOf(a.NodeID);
        return `Administration manager — ${[sectorOf(admin?.SectorID)?.Name, admin?.Name].filter(Boolean).join(' › ') || '?'}`;
      }
      const region = regionOf(a.NodeID);
      const admin = administrationOf(region?.AdministrationID);
      return `Region engineer — ${[admin?.Name, region?.Name].filter(Boolean).join(' › ') || '?'}`;
    });
  }

  function names(list) { return list.map(userName).join('، '); }

  /* -------------------------------------------------------------------
     Rendering — columns
  ------------------------------------------------------------------- */
  function nodeRowHtml(id, name, count, isSelected, sub) {
    return `
      <div class="orgchart-node ${isSelected ? 'is-selected' : ''}" data-id="${escapeHtml(id)}">
        <span class="orgchart-node__text">
          <span class="orgchart-node__name">${escapeHtml(name) || '—'}</span>
          ${sub ? `<span class="orgchart-node__sub">${escapeHtml(sub)}</span>` : ''}
        </span>
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
      const heads = membersAt('sector', s.ID);
      return nodeRowHtml(s.ID, s.Name, count, String(s.ID) === String(selectedSectorId), heads.length ? `Head: ${names(heads)}` : 'No head assigned');
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
      const managers = membersAt('administration', a.ID);
      return nodeRowHtml(a.ID, a.Name, count, String(a.ID) === String(selectedAdministrationId), managers.length ? `Manager: ${names(managers)}` : 'No manager assigned');
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
      const engineers = membersAt('region', r.ID);
      return nodeRowHtml(r.ID, r.Name, engineers.length, String(r.ID) === String(selectedRegionId), engineers.length ? '' : 'No engineers assigned');
    }).join('');
  }

  /* -------------------------------------------------------------------
     Rendering — members panel
  ------------------------------------------------------------------- */
  function memberRowHtml(u, level) {
    // At region level, a missing EngineerID means this person's Rent/
    // Expenses rows can never be matched to them, so flag it right here.
    const engineerNote = level === 'region'
      ? (u.EngineerID
        ? `<span class="orgchart-member-row__id">#${escapeHtml(u.EngineerID)}</span>`
        : '<span class="orgchart-member-row__warn" title="Rent and Expenses reports match people by Engineer ID"><i class="fa-solid fa-triangle-exclamation"></i> no Engineer ID</span>')
      : '';
    return `
      <div class="orgchart-member-row ${isActiveUser(u) ? '' : 'is-inactive'}" data-user-id="${escapeHtml(u.ID || '')}">
        <span>
          <span class="orgchart-member-row__name">${escapeHtml(userName(u)) || '—'}</span>
          <span class="orgchart-member-row__role">${escapeHtml(u.Role) || ''}${isActiveUser(u) ? '' : ' · inactive'}</span>
          ${engineerNote}
        </span>
        <button class="orgchart-icon-btn orgchart-icon-btn--danger" type="button" data-action="remove" title="Remove"><i class="fa-solid fa-user-minus"></i></button>
      </div>`;
  }

  function currentLevel() {
    if (selectedRegionId) return 'region';
    if (selectedAdministrationId) return 'administration';
    if (selectedSectorId) return 'sector';
    return null;
  }

  function currentNodeId() {
    return selectedRegionId || selectedAdministrationId || selectedSectorId;
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

    let title, breadcrumb;
    if (level === 'sector') {
      const sector = sectorOf(selectedSectorId);
      title = `Sector head: ${sector?.Name || ''}`;
      breadcrumb = sector?.Name || '';
    } else if (level === 'administration') {
      const admin = administrationOf(selectedAdministrationId);
      title = `Administration manager: ${admin?.Name || ''}`;
      breadcrumb = `${sectorOf(admin?.SectorID)?.Name || ''} → ${admin?.Name || ''}`;
    } else {
      const region = regionOf(selectedRegionId);
      const admin = administrationOf(region?.AdministrationID);
      title = `Region engineers: ${region?.Name || ''}`;
      breadcrumb = `${sectorOf(admin?.SectorID)?.Name || ''} → ${admin?.Name || ''} → ${region?.Name || ''}`;
    }

    const members = membersAt(level, currentNodeId());
    const memberIds = new Set(members.map((u) => String(u.ID)));
    // Anyone active who isn't already here — the role is deliberately NOT
    // a filter (an Engineer can manage an administration). At region level
    // the option says where they'd be moved from.
    const candidates = allUsers.filter((u) => isActiveUser(u) && !memberIds.has(String(u.ID))).sort(byName);

    membersHeadEl.textContent = title;
    document.getElementById('orgMembersBreadcrumb').textContent = breadcrumb;

    membersListEl.innerHTML = members.length
      ? members.map((u) => memberRowHtml(u, level)).join('')
      : '<div class="orgchart-column__empty">No one placed here yet</div>';

    assignRow.hidden = false;
    assignSelectEl.innerHTML = candidates.length
      ? candidates.map((u) => {
        const current = level === 'region'
          ? assignments.find((a) => String(a.UserID) === String(u.ID) && a.Level === 'region')
          : null;
        const moveNote = current ? ` — now in ${regionOf(current.NodeID)?.Name || 'another region'}` : '';
        return `<option value="${escapeHtml(u.ID)}">${escapeHtml(userName(u))} (${escapeHtml(u.Role)})${escapeHtml(moveNote)}</option>`;
      }).join('')
      : '<option value="">No candidates available</option>';
    assignBtn.disabled = !candidates.length;
  }

  function renderPeople() {
    const unplacedOnly = unplacedOnlyEl.checked;
    const rows = allUsers
      .filter(isActiveUser)
      .map((u) => ({ user: u, labels: positionLabels(u.ID) }))
      .filter((row) => !unplacedOnly || !row.labels.length)
      .sort((a, b) => byName(a.user, b.user));

    peopleListEl.innerHTML = rows.length
      ? rows.map(({ user, labels }) => `
        <div class="orgchart-member-row">
          <span>
            <span class="orgchart-member-row__name">${escapeHtml(userName(user)) || '—'}</span>
            <span class="orgchart-member-row__role">${escapeHtml(user.Role) || ''}</span>
          </span>
          <span class="orgchart-people__positions">
            ${labels.length
    ? labels.map((label) => `<span class="orgchart-chip">${escapeHtml(label)}</span>`).join('')
    : '<span class="orgchart-chip orgchart-chip--muted">Not placed</span>'}
          </span>
        </div>`).join('')
      : `<div class="orgchart-column__empty">${unplacedOnly ? 'Everyone is placed' : 'No users found'}</div>`;
  }

  function renderAll() {
    renderSectors();
    renderAdministrations();
    renderRegions();
    renderMembers();
    renderPeople();
    if (typeof gsap !== 'undefined' && !prefersReducedMotion()) animateIn(containerEl.querySelector('.orgchart-columns'));
  }

  /* -------------------------------------------------------------------
     Assign / remove — straight calls to the placement endpoints; the
     server owns the rules (e.g. moving someone out of a previous region).
  ------------------------------------------------------------------- */
  function assignMember() {
    const userId = assignSelectEl.value;
    const level = currentLevel();
    if (!userId || !level) return;

    showLoader('Adding...');
    MKNexus.ApiClient.assignOrgMember({ userId, level, nodeId: currentNodeId() })
      .then(() => { hideLoader(); MKNexus.Toast.success('Added'); return loadAll(); })
      .catch((error) => { hideLoader(); MKNexus.Toast.error(error?.message || 'Failed to add'); });
  }

  function removeMember(userId) {
    const level = currentLevel();
    if (!level) return;

    showLoader('Removing...');
    MKNexus.ApiClient.unassignOrgMember({ userId, level, nodeId: currentNodeId() })
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
      confirmDelete: (name) => `Delete sector "${name}"? Its head assignment is removed too.`,
    },
    administration: {
      create: (name) => MKNexus.ApiClient.createOrgAdministration({ Name: name, SectorID: selectedSectorId }),
      update: (id, name) => MKNexus.ApiClient.updateOrgAdministration({ id, Name: name }),
      remove: (id) => MKNexus.ApiClient.deleteOrgAdministration({ id }),
      createTitle: 'Add administration', renameTitle: 'Rename administration',
      confirmDelete: (name) => `Delete administration "${name}"? Its manager assignment is removed too.`,
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
      const nodeName = node.querySelector('.orgchart-node__name')?.textContent;

      if (actionBtn?.dataset.action === 'delete') { deleteNode(level, id, nodeName); return; }
      if (actionBtn?.dataset.action === 'rename') { openNameModal(level, 'rename', id, nodeName); return; }
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
    peopleListEl = document.getElementById('orgPeopleList');
    unplacedOnlyEl = document.getElementById('orgUnplacedOnly');
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
    unplacedOnlyEl.addEventListener('change', renderPeople);
  }

  function mount(container) {
    containerEl = container;
    container.innerHTML = template();
    cacheDom();
    bind();

    sectors = []; administrations = []; regions = []; assignments = []; allUsers = [];
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
