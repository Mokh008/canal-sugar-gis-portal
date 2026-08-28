/* MK NEXUS — Router: hash-based module navigation, zero page reloads.
   Modules register a mount/unmount pair; router swaps #shellContent. */
window.MKNexus = window.MKNexus || {};

MKNexus.Router = (function () {
  const registry = new Map();
  let activeModuleId = null;
  let container = null;
  let onNavigateCb = null;

  function register(moduleId, handlers) {
    registry.set(moduleId, handlers);
  }

  function parseHash() {
    const raw = window.location.hash.replace(/^#\/?/, '');
    // A hash naming a real, registered module the current role isn't
    // allowed into (manually typed/bookmarked, or a stale link from
    // before a role change) falls back to the same default-module logic
    // as "no hash at all" — see MKNexus.Access.defaultModuleId().
    if (raw && registry.has(raw) && MKNexus.Access.canAccessModule(raw)) return raw;
    return MKNexus.Access.defaultModuleId()
      || MKNexus.Config.MODULES.find((m) => m.default)?.id
      || MKNexus.Config.MODULES[0].id;
  }

  function navigate(moduleId, { pushState = true } = {}) {
    const moduleDef = MKNexus.Config.MODULES.find((m) => m.id === moduleId);
    if (!moduleDef) return;

    // Defense in depth against a direct MKNexus.Router.navigate() call
    // bypassing the sidebar's already-filtered list (e.g. devtools, a
    // stale bookmark) — redirect to whatever this role can actually see
    // instead of mounting a module it shouldn't.
    if (!MKNexus.Access.canAccessModule(moduleId)) {
      const fallback = MKNexus.Access.defaultModuleId();
      if (fallback && fallback !== moduleId) navigate(fallback, { pushState });
      return;
    }

    if (pushState) {
      window.location.hash = '/' + moduleId; // triggers hashchange → re-enters navigate()
      return;
    }

    if (activeModuleId && registry.has(activeModuleId)) {
      registry.get(activeModuleId).unmount?.(container);
    }

activeModuleId = moduleId;
    container.classList.remove('shell-content--flush');
    registry.get(moduleId)?.mount(container);
    onNavigateCb?.(moduleId, moduleDef);
  }

  function handleHashChange() {
    navigate(parseHash(), { pushState: false });
  }

  function init(contentEl, { onNavigate } = {}) {
    container = contentEl;
    onNavigateCb = onNavigate;
    window.addEventListener('hashchange', handleHashChange);
    navigate(parseHash(), { pushState: false });
  }

  function current() {
    return activeModuleId;
  }

  return { register, navigate, init, current };
})();