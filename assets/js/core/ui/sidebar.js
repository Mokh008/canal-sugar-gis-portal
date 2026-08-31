/* MK NEXUS — Sidebar: renders nav from Config.MODULES, active state, collapse */
window.MKNexus = window.MKNexus || {};

MKNexus.Sidebar = (function () {
  let navEl = null;

  function render() {
    navEl = document.getElementById('shellSidebarNav');
    if (!navEl) return;
    navEl.innerHTML = '';

    // Only modules the logged-in role is allowed to open — see
    // core/access.js. router.js applies the matching guard on the hash
    // itself, so this and direct URL/hash edits stay in agreement.
    MKNexus.Access.visibleModules().forEach((mod) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shell-nav-item';
      btn.dataset.moduleId = mod.id;
      btn.setAttribute('aria-label', mod.label);
      btn.innerHTML = `
        <i class="${mod.icon} shell-nav-item__icon"></i>
        <span class="shell-nav-item__label">${mod.label}</span>
      `;
      btn.addEventListener('click', () => MKNexus.Router.navigate(mod.id));
      navEl.appendChild(btn);
    });
  }

  function setActive(moduleId) {
    navEl?.querySelectorAll('.shell-nav-item').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.moduleId === moduleId);
    });
  }

  function initCollapse() {
    const collapseBtn = document.getElementById('shellCollapseBtn');
    const sidebar = document.getElementById('shellSidebar');
    const backdrop = document.getElementById('shellSidebarBackdrop');
    const mobileQuery = window.matchMedia('(max-width: 900px)');

    // On a narrow viewport the sidebar renders as a fixed overlay (see
    // shell.css) — show a dismissible scrim behind it whenever it's
    // expanded there, same affordance every header dropdown already has,
    // instead of leaving it pinned open with no obvious way to close it.
    function syncBackdrop() {
      const shouldShow = mobileQuery.matches && !sidebar.classList.contains('is-collapsed');
      backdrop?.classList.toggle('is-visible', shouldShow);
    }

    function setCollapsed(collapsed) {
      sidebar.classList.toggle('is-collapsed', collapsed);
      collapseBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      collapseBtn.querySelector('i').className = collapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left';
      syncBackdrop();
    }

    collapseBtn?.addEventListener('click', () => setCollapsed(!sidebar.classList.contains('is-collapsed')));
    backdrop?.addEventListener('click', () => setCollapsed(true));
    mobileQuery.addEventListener('change', syncBackdrop);
    syncBackdrop();
  }

  function init() {
    render();
    initCollapse();
  }

  // render exposed separately (not just via init) so shell.js can
  // re-filter the nav list against a freshly logged-in role on every
  // re-entry to the shell without re-running initCollapse()'s listener
  // bindings again too — those must stay one-time-only. See shell.js's
  // mount() and core/access.js's visibleModules().
  return { init, setActive, render };
})();