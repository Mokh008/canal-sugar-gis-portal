/* MK NEXUS — Shell: mounts sidebar/header/router together. Called once,
   by app.js, after the landing → platform transition completes. */
window.MKNexus = window.MKNexus || {};

MKNexus.Shell = (function () {
  let mounted = false;

function registerModuleStubs() {
    MKNexus.Config.MODULES.forEach((mod) => {
      if (mod.id === 'geo' || mod.id === 'rent' || mod.id === 'expenses' || mod.id === 'attendance') return; // real modules — registered separately below
      MKNexus.Router.register(mod.id, {
        mount(container) {
          container.innerHTML = `
            <div class="module-stub">
              <span class="module-stub__eyebrow type-eyebrow">${mod.label.toUpperCase()}</span>
              <h2 class="module-stub__title type-h2">${mod.label} module initializing</h2>
              <p class="module-stub__desc type-body">This module mounts into the shell once its build step begins.</p>
            </div>
          `;
        },
        unmount(container) {
          container.innerHTML = '';
        },
      });
    });
    MKNexus.Router.register('geo', MKNexus.GeoModule);
    MKNexus.Router.register('rent', MKNexus.RentModule);
    MKNexus.Router.register('expenses', MKNexus.ExpensesModule);
    MKNexus.Router.register('attendance', MKNexus.AttendanceModule);
  }

  // Re-reveals the (already-initialized) shell with its entrance
  // animation — the part that must run on every mount(), not just the
  // first one. See mount() below: the shell used to only ever do this
  // once (gated behind the same `mounted` guard as the one-time setup),
  // so using the header's Home button to exit to the landing page and
  // then clicking "Launch Platform" again left the shell permanently
  // `display: none` — a dead end with no recovery short of a full reload.
  function reveal() {
    const shell = document.getElementById('app-shell');
    gsap.set(shell, { display: 'flex', opacity: 0 });
    gsap.fromTo(shell, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' });
    gsap.fromTo('#shellSidebar', { x: -24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out', delay: 0.1 });
    gsap.fromTo('#shellHeader', { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out', delay: 0.15 });
    gsap.fromTo('#shellContent', { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out', delay: 0.25 });
    requestAnimationFrame(() => MKNexus.MapEngine.getMap()?.resize());
  }

  function mount() {
    if (!mounted) {
      mounted = true;
      document.getElementById('shellSidebar')?.classList.add('is-collapsed');
      document.getElementById('shellBreadcrumbCompany').textContent = MKNexus.Config.COMPANY_NAME;

      registerModuleStubs();
      MKNexus.Sidebar.init();
      MKNexus.Header.init({
        profile: MKNexus.SessionData.profile,
        notifications: MKNexus.SessionData.notifications,
      });
      MKNexus.Router.init(document.getElementById('shellContent'), {
        onNavigate(moduleId, moduleDef) {
          MKNexus.Sidebar.setActive(moduleId);
          MKNexus.Header.setBreadcrumb(moduleDef.label);
        },
      });
    }
    reveal();
  }

  return { mount };
})();