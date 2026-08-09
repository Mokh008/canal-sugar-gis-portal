/* MK NEXUS — Login: authentication gate shown between the boot sequence
   and the landing page. Talks to the real backend via MKNexus.ApiClient
   (action: 'login', already wired in api/client.js). On success it
   hydrates MKNexus.SessionData.profile from the backend response (when
   present) and hands control back to app.js via the onSuccess callback. */
window.MKNexus = window.MKNexus || {};

MKNexus.Login = (function () {
  let onSuccessCb = null;
  let dom = {};
  let bound = false;

  function cacheDom() {
    dom.screen = document.getElementById('login-screen');
    dom.form = document.getElementById('loginForm');
    dom.username = document.getElementById('loginUsername');
    dom.password = document.getElementById('loginPassword');
    dom.remember = document.getElementById('loginRemember');
    dom.toggle = document.getElementById('loginPasswordToggle');
    dom.submit = document.getElementById('loginSubmit');
    dom.error = document.getElementById('loginError');
    dom.demoBtn = document.getElementById('loginDemoBtn');
    dom.card = dom.screen?.querySelector('.login-card');
  }

  function setError(message) {
    if (!dom.error) return;
    dom.error.textContent = message || '';
    dom.error.classList.toggle('is-visible', Boolean(message));
  }

  function shake() {
    dom.card.classList.remove('is-shake');
    void dom.card.offsetWidth; // restart the animation on repeated failures
    dom.card.classList.add('is-shake');
  }

  function setLoading(loading) {
    dom.submit.classList.toggle('is-loading', loading);
    dom.submit.disabled = loading;
  }

  function togglePasswordVisibility() {
    const showing = dom.password.type === 'text';
    dom.password.type = showing ? 'password' : 'text';
    dom.toggle.innerHTML = showing ? '<i class="fa-regular fa-eye"></i>' : '<i class="fa-regular fa-eye-slash"></i>';
    dom.toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  }

  function deriveInitials(name) {
    if (!name) return null;
    return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
  }

  function applySessionProfile(data) {
    const user = data?.user || data?.profile;
    if (!user) return;
    const name = user.name || user.fullName || MKNexus.SessionData.profile.name;
    MKNexus.SessionData.profile = {
      name,
      role: user.role || user.title || MKNexus.SessionData.profile.role,
      initials: user.initials || deriveInitials(name) || MKNexus.SessionData.profile.initials,
    };
  }

  // The token is always written to sessionStorage by ApiClient.login().
  // "Remember me" additionally mirrors it into localStorage (which
  // createUrl()/request() already check as a fallback) so the session
  // survives a browser restart; unchecking clears any stale copy.
  function persistRemember(remember) {
    const key = MKNexus.ApiConfig.sessionStorageKey;
    const token = sessionStorage.getItem(key);
    if (remember && token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const username = dom.username.value.trim();
    const password = dom.password.value;

    dom.username.closest('.login-field').classList.toggle('is-invalid', !username);
    dom.password.closest('.login-field').classList.toggle('is-invalid', !password);

    if (!username || !password) {
      setError('Enter both your username and password to continue.');
      shake();
      return;
    }

    setError(null);
    dom.demoBtn.hidden = true;
    setLoading(true);

    try {
      const data = await MKNexus.ApiClient.login({ username, password });
      applySessionProfile(data);
      persistRemember(dom.remember.checked);
      hide();
      onSuccessCb?.();
    } catch (error) {
      setLoading(false);
      setError(error?.message || 'Sign-in failed. Check your credentials and try again.');
      shake();
      dom.password.value = '';
      dom.password.focus();

      // Wrong/expired credentials should still block — only offer the
      // bypass when the backend itself couldn't be reached at all, so
      // the site remains browsable while that's being fixed separately.
      if (error?.code === 'NETWORK_ERROR' || error?.code === 'TIMEOUT') {
        dom.demoBtn.hidden = false;
      }
    }
  }

  function handleDemoContinue() {
    setError(null);
    hide();
    onSuccessCb?.();
  }

  function clearFieldError(input) {
    input.closest('.login-field').classList.remove('is-invalid');
    setError(null);
  }

  function bind() {
    dom.form.addEventListener('submit', handleSubmit);
    dom.toggle.addEventListener('click', togglePasswordVisibility);
    dom.demoBtn.addEventListener('click', handleDemoContinue);
    dom.username.addEventListener('input', () => clearFieldError(dom.username));
    dom.password.addEventListener('input', () => clearFieldError(dom.password));
    bound = true;
  }

  function show({ onSuccess } = {}) {
    onSuccessCb = onSuccess;
    if (!dom.screen) cacheDom();
    if (!bound) bind();

    dom.screen.removeAttribute('aria-hidden');
    dom.screen.classList.add('is-visible');
    dom.demoBtn.hidden = true;
    setError(null);

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion || typeof gsap === 'undefined') {
      dom.screen.style.opacity = 1;
      dom.card.style.opacity = 1;
      dom.username.focus();
      return;
    }

    gsap.to(dom.screen, { opacity: 1, duration: 0.5, ease: 'power2.out' });
    gsap.fromTo(dom.card, { y: 22, opacity: 0 }, {
      y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', delay: 0.15,
      onComplete: () => dom.username.focus(),
    });
    gsap.fromTo('.login-screen__corner-brand', { opacity: 0 }, { opacity: 1, duration: 0.6, delay: 0.3 });
  }

  function hide() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finish = () => {
      dom.screen.classList.remove('is-visible');
      dom.screen.setAttribute('aria-hidden', 'true');
    };

    if (prefersReducedMotion || typeof gsap === 'undefined') {
      finish();
      return;
    }
    gsap.to(dom.screen, { opacity: 0, duration: 0.5, ease: 'power2.inOut', onComplete: finish });
  }

  return { show, hide };
})();
