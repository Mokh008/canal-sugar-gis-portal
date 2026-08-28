/* MK NEXUS — Header: breadcrumb, search, notifications, profile, theme */
window.MKNexus = window.MKNexus || {};

MKNexus.Header = (function () {
  function setBreadcrumb(label) {
    const el = document.getElementById('shellBreadcrumbCurrent');
    if (el) el.textContent = label;
  }

  function togglePanel(panelEl, triggerBtn) {
    const isOpen = panelEl.classList.toggle('is-open');
    triggerBtn.setAttribute('aria-expanded', String(isOpen));
  }

  function closePanels(except) {
    document.querySelectorAll('.shell-notif__panel.is-open, .shell-profile__panel.is-open').forEach((p) => {
      if (p !== except) p.classList.remove('is-open');
    });
  }

  function initNotifications(notifications = []) {
    const btn = document.getElementById('shellNotifBtn');
    const panel = document.getElementById('shellNotifPanel');
    const badge = document.getElementById('shellNotifBadge');
    const list = document.getElementById('shellNotifList');
    if (!btn || !panel) return;

    if (notifications.length) {
      badge.textContent = String(notifications.length);
      badge.classList.remove('is-hidden');
      // Built via textContent, not innerHTML — notification titles are
      // headed toward being backend-driven data, same class of risk as
      // the boundary names fixed in gis-editor-ui.js/geo-module.js.
      list.innerHTML = '';
      notifications.forEach((n) => {
        const item = document.createElement('li');
        item.className = 'shell-notif__item';
        const title = document.createElement('span');
        title.className = 'shell-notif__item-title';
        title.textContent = n.title;
        const time = document.createElement('span');
        time.className = 'shell-notif__item-time';
        time.textContent = n.time;
        item.append(title, time);
        list.appendChild(item);
      });
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePanels(panel);
      togglePanel(panel, btn);
    });
  }

  function initProfile(profile) {
    const btn = document.getElementById('shellProfileBtn');
    const panel = document.getElementById('shellProfilePanel');
    if (!btn || !panel) return;

    if (profile) {
      document.getElementById('shellProfileInitials').textContent = profile.initials;
      document.getElementById('shellProfileName').textContent = profile.name;
      document.getElementById('shellProfileRole').textContent = profile.role;
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePanels(panel);
      togglePanel(panel, btn);
    });

    document.getElementById('shellLogoutBtn')?.addEventListener('click', () => {
      MKNexus.App?.logout?.();
    });
  }

  const THEME_STORAGE_KEY = 'mknexus_theme';

  function initTheme() {
    const btn = document.getElementById('shellThemeBtn');
    if (!btn) return;

    function applyTheme(light) {
      document.body.classList.toggle('theme-light', light);
      btn.querySelector('i').className = light ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      btn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    }

    // Restore the user's choice — the toggle used to silently reset to
    // dark on every reload since nothing persisted it.
    let stored = null;
    try { stored = localStorage.getItem(THEME_STORAGE_KEY); } catch { /* storage unavailable — falls back to dark */ }
    applyTheme(stored === 'light');

    btn.addEventListener('click', () => {
      const light = !document.body.classList.contains('theme-light');
      applyTheme(light);
      try { localStorage.setItem(THEME_STORAGE_KEY, light ? 'light' : 'dark'); } catch { /* non-fatal — just won't persist */ }
    });
  }

  // A real (if intentionally small) quick-jump across the module nav
  // rather than a decorative input that only logged to console — types a
  // module name, Enter jumps straight to it; matching items are
  // highlighted and non-matches dim as you type.
  function initSearch() {
    const input = document.getElementById('shellSearchInput');
    if (!input) return;
    const navItems = () => document.querySelectorAll('#shellSidebarNav .shell-nav-item');

    function clearMatchState() {
      navItems().forEach((btn) => btn.classList.remove('is-search-match', 'is-search-hidden'));
    }

    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      navItems().forEach((btn) => {
        const label = btn.querySelector('.shell-nav-item__label')?.textContent.toLowerCase() || '';
        const matches = label.includes(query);
        btn.classList.toggle('is-search-match', Boolean(query) && matches);
        btn.classList.toggle('is-search-hidden', Boolean(query) && !matches);
      });
    });

    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const query = input.value.trim().toLowerCase();
      if (!query) return;
      // Only modules this role can actually open — see core/access.js.
      // Router.navigate() would silently redirect away from anything
      // else anyway, but matching only the visible list here means the
      // search never even offers a module the sidebar itself hides.
      const match = MKNexus.Access.visibleModules().find((m) => m.label.toLowerCase().includes(query));
      if (!match) return;
      MKNexus.Router.navigate(match.id);
      input.value = '';
      clearMatchState();
      input.blur();
    });

    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (document.activeElement === input) return;
        input.value = '';
        clearMatchState();
      }, 150);
    });
  }

  function init({ profile, notifications } = {}) {
    initNotifications(notifications);
    initProfile(profile);
    initTheme();
    initSearch();
    document.addEventListener('click', () => closePanels());
  }

  return { init, setBreadcrumb };
})();