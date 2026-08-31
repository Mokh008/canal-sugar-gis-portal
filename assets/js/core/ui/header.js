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

  // Split out of initProfile() so shell.js can refresh just the display
  // (name/role/avatar) on every re-entry to the shell, without re-running
  // initProfile()'s own event-listener bindings below — those must stay
  // one-time-only or they'd stack up across repeated logout→login
  // cycles in the same page load. See shell.js's mount().
  function updateProfileDisplay(profile) {
    if (!profile) return;
    const avatarEl = document.getElementById('shellProfileInitials');
    // A real uploaded photo (see modules/settings.js's Profile tab)
    // takes over the same circle that used to only ever show initials —
    // background-image rather than swapping in an <img> so the existing
    // sizing/border CSS on .shell-profile__avatar applies unchanged.
    // isSafeHttpsUrl guards the interpolation below the same way it
    // already guards PDF links in rent.js/expenses.js — avatarUrl always
    // comes from our own backend today, but this costs nothing and means
    // a malformed or future-changed value can never break out of the
    // url('...') it's placed into.
    if (profile.avatarUrl && MKNexus.Utils.isSafeHttpsUrl(profile.avatarUrl)) {
      avatarEl.style.backgroundImage = `url('${profile.avatarUrl}')`;
      avatarEl.classList.add('has-photo');
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.classList.remove('has-photo');
      avatarEl.textContent = profile.initials;
    }
    document.getElementById('shellProfileName').textContent = profile.name;
    document.getElementById('shellProfileRole').textContent = profile.role;
  }

  function initProfile(profile) {
    const btn = document.getElementById('shellProfileBtn');
    const panel = document.getElementById('shellProfilePanel');
    if (!btn || !panel) return;

    updateProfileDisplay(profile);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePanels(panel);
      togglePanel(panel, btn);
    });

    // Was permanently `disabled` with a "Soon" badge — modules/settings.js
    // is a real module now. Router.navigate() itself redirects away for
    // any role Settings isn't listed for in core/config.js (Supervisor),
    // so no extra role check is needed here.
    document.getElementById('shellSettingsBtn')?.addEventListener('click', () => {
      closePanels();
      MKNexus.Router.navigate('settings');
    });

    document.getElementById('shellLogoutBtn')?.addEventListener('click', () => {
      MKNexus.App?.logout?.();
    });
  }

  const THEME_STORAGE_KEY = 'mknexus_theme';

  // Applies the theme to <body> + persists it + updates the header
  // button's own icon/label if it's on the page. Exposed (see the
  // returned object at the bottom of this file) so modules/settings.js's
  // Preferences tab can flip the theme too and have the header's button
  // stay in sync, instead of duplicating this logic with its own
  // separate body-class/localStorage handling that could drift from it.
  function applyTheme(light) {
    document.body.classList.toggle('theme-light', light);
    const btn = document.getElementById('shellThemeBtn');
    if (btn) {
      btn.querySelector('i').className = light ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      btn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    }
    try { localStorage.setItem(THEME_STORAGE_KEY, light ? 'light' : 'dark'); } catch { /* non-fatal — just won't persist */ }
  }

  function isLightTheme() {
    return document.body.classList.contains('theme-light');
  }

  function initTheme() {
    const btn = document.getElementById('shellThemeBtn');
    if (!btn) return;

    // Restore the user's choice — the toggle used to silently reset to
    // dark on every reload since nothing persisted it.
    let stored = null;
    try { stored = localStorage.getItem(THEME_STORAGE_KEY); } catch { /* storage unavailable — falls back to dark */ }
    applyTheme(stored === 'light');

    btn.addEventListener('click', () => applyTheme(!isLightTheme()));
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

  return { init, setBreadcrumb, applyTheme, isLightTheme, updateProfileDisplay };
})();