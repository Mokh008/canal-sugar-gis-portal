window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Toast: shared corner-notification system, replacing raw
   window.alert() calls and silent-catch error handling across every
   module. Always builds nodes via textContent, never innerHTML — a
   toast message may itself contain backend-sourced text (an error
   message, a boundary name), so this is a second, independent XSS
   guard on top of the escapeHtml() call sites already use elsewhere. */
MKNexus.Toast = (function () {
  let stackEl = null;

  const ICONS = {
    success: 'fa-solid fa-circle-check',
    error: 'fa-solid fa-circle-exclamation',
    warning: 'fa-solid fa-triangle-exclamation',
    info: 'fa-solid fa-circle-info',
  };

  function ensureStack() {
    if (stackEl) return stackEl;
    stackEl = document.createElement('div');
    stackEl.className = 'mk-toast-stack';
    stackEl.setAttribute('role', 'status');
    stackEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(stackEl);
    return stackEl;
  }

  function show({ type = 'info', message, duration = 5500 } = {}) {
    if (!message) return () => {};
    const stack = ensureStack();

    const toast = document.createElement('div');
    toast.className = `mk-toast mk-toast--${type}`;

    const icon = document.createElement('i');
    icon.className = ICONS[type] || ICONS.info;
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'mk-toast__text';
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mk-toast__close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    const closeIcon = document.createElement('i');
    closeIcon.className = 'fa-solid fa-xmark';
    closeIcon.setAttribute('aria-hidden', 'true');
    closeBtn.appendChild(closeIcon);

    toast.append(icon, text, closeBtn);
    stack.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));

    let dismissed = false;
    let timer = null;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      if (timer) window.clearTimeout(timer);
      toast.classList.remove('is-visible');
      window.setTimeout(() => toast.remove(), 320);
    }
    closeBtn.addEventListener('click', dismiss);
    if (duration > 0) timer = window.setTimeout(dismiss, duration);
    return dismiss;
  }

  return {
    show,
    success: (message, opts) => show({ ...opts, type: 'success', message }),
    error: (message, opts) => show({ ...opts, type: 'error', message }),
    warning: (message, opts) => show({ ...opts, type: 'warning', message }),
    info: (message, opts) => show({ ...opts, type: 'info', message }),
  };
})();
