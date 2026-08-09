/* =====================================================================
   MK NEXUS — Geo Intelligence & Operations Platform
   APP.JS — Feature 01: Loading Screen + Landing Page
   =====================================================================
   Table of contents:
     1. Config & DOM refs
     2. Utilities
     3. Loading screen sequence
     4. Landing page intro animation
     5. Coordinate telemetry ticker
     6. Ambient backdrop parallax
     7. CTA button handlers
     8. Init
   ===================================================================== */

(function () {
  'use strict';

  /* -------------------------------------------------------------------
     1. CONFIG & DOM REFS
  ------------------------------------------------------------------- */
  const DOM = {
    loadingScreen: document.getElementById('loading-screen'),
    loaderLogo: document.getElementById('loaderLogo'),
    loaderRing: document.getElementById('loaderRing'),
    loaderBarFill: document.getElementById('loaderBarFill'),
    loaderPercent: document.getElementById('loaderPercent'),
    consoleLine: document.getElementById('consoleLine'),
    landing: document.getElementById('landing'),
    coordReadout: document.getElementById('coordReadout'),
    contourPaths: null, // set at init (NodeList)
    launchBtn: document.getElementById('launchBtn'),
    learnBtn: document.getElementById('learnBtn'),
    shellHomeBtn: document.getElementById('shellHomeBtn'),
  };

  // Boot console lines shown one-by-one while the loader progresses.
  const BOOT_LINES = [
    'INITIALIZING GEO INTELLIGENCE ENGINE…',
    'LOADING SUGAR BEET FIELD BOUNDARIES…',
    'CALIBRATING HARVEST TELEMETRY…',
    'SYNCING FACTORY OPERATIONS NODES…',
    'MK NEXUS READY.',
  ];

  const RING_CIRCUMFERENCE = 2 * Math.PI * 64; // r=64, matches CSS/SVG

  // Reference point for the coordinate ticker: Canal Sugar's operating
  // region (Minya, Egypt). Values drift slightly to feel "live".
  const BASE_COORDS = { lat: 28.1099, lng: 30.7503 };

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* -------------------------------------------------------------------
     2. UTILITIES
  ------------------------------------------------------------------- */
  function formatCoords(lat, lng) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lngDir = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}\u00B0 ${latDir}, ${Math.abs(lng).toFixed(4)}\u00B0 ${lngDir}`;
  }

  /* -------------------------------------------------------------------
     3. LOADING SCREEN SEQUENCE
  ------------------------------------------------------------------- */
  function runLoadingSequence(onComplete) {
    if (prefersReducedMotion) {
      // Skip straight to landing for users who opt out of motion.
      DOM.loadingScreen.style.display = 'none';
      onComplete();
      return;
    }

    const tl = gsap.timeline({
      defaults: { ease: 'power3.out' },
      onComplete: () => {
        DOM.loadingScreen.classList.add('is-done');
        gsap.to(DOM.loadingScreen, {
          opacity: 0,
          duration: 0.7,
          ease: 'power2.inOut',
          onComplete: () => {
            DOM.loadingScreen.style.display = 'none';
            onComplete();
          },
        });
      },
    });

    // Logo + ring reveal
    if (DOM.loaderLogo) {
      tl.fromTo(DOM.loaderLogo, { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0);
    }
    tl.to('.loading-screen__wordmark', { opacity: 1, duration: 0.5 }, 0.2)
      .to(DOM.loaderPercent, { opacity: 1, duration: 0.4 }, 0.3);

    // Progress bar + ring + percent counter, driven together
    const progress = { value: 0 };
    tl.to(progress, {
      value: 100,
      duration: 2.6,
      ease: 'power1.inOut',
      onUpdate: () => {
        const pct = Math.round(progress.value);
        DOM.loaderBarFill.style.width = pct + '%';
        DOM.loaderPercent.textContent = pct + '%';
        const offset = RING_CIRCUMFERENCE * (1 - progress.value / 100);
        DOM.loaderRing.style.strokeDashoffset = offset;
      },
    }, 0.3);

    // Cycle boot console lines across the same duration
    BOOT_LINES.forEach((line, i) => {
      tl.call(() => {
        gsap.to(DOM.consoleLine, {
          opacity: 0,
          duration: 0.15,
          onComplete: () => {
            DOM.consoleLine.textContent = line;
            gsap.to(DOM.consoleLine, { opacity: 1, duration: 0.25 });
          },
        });
      }, null, 0.3 + i * 0.52);
    });

    // Brief hold once complete before hand-off
    tl.to({}, { duration: 0.35 });
  }

  /* -------------------------------------------------------------------
     4. LANDING PAGE INTRO ANIMATION
  ------------------------------------------------------------------- */
  function playLandingIntro() {
    DOM.landing.removeAttribute('aria-hidden');

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    tl.to(DOM.landing, { opacity: 1, duration: 0.5 }, 0)

      // Contour lines draw themselves in, like a map rendering
      .to(DOM.contourPaths, {
        strokeDashoffset: 0,
        duration: 2.2,
        ease: 'power2.inOut',
        stagger: 0.15,
      }, 0)

      .fromTo('.landing__topbar', { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.1)

      .fromTo('[data-anim="hero-eyebrow"]', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55 }, 0.25)

      .fromTo('.landing__title-line', { y: 46, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.8, stagger: 0.1,
      }, 0.4)

      .fromTo('[data-anim="hero-subtitle"]', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.75)

      .fromTo('[data-anim="hero-desc"]', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.85)

      .fromTo('[data-anim="hero-cta"]', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.95)

      .fromTo('.landing__footer', { opacity: 0 }, { opacity: 1, duration: 0.6 }, 1.1);
  }

  /* -------------------------------------------------------------------
     5. COORDINATE TELEMETRY TICKER
     Purely cosmetic "live system" feel — drifts the readout slightly
     on an interval to imply a connected geospatial feed.
  ------------------------------------------------------------------- */
  function startCoordTicker() {
    if (!DOM.coordReadout || prefersReducedMotion) return;

    setInterval(() => {
      const jitterLat = (Math.random() - 0.5) * 0.02;
      const jitterLng = (Math.random() - 0.5) * 0.02;
      DOM.coordReadout.textContent = formatCoords(
        BASE_COORDS.lat + jitterLat,
        BASE_COORDS.lng + jitterLng
      );
    }, 2400);
  }

  /* -------------------------------------------------------------------
     6. AMBIENT BACKDROP PARALLAX
     Subtle pointer-driven parallax on the glow layers only —
     kept light so it reads as "premium ambience", not a gimmick.
  ------------------------------------------------------------------- */
  function initParallax() {
    if (prefersReducedMotion) return;

    const glows = document.querySelectorAll('.landing__glow');
    if (!glows.length) return;

    window.addEventListener('pointermove', (e) => {
      const xRatio = e.clientX / window.innerWidth - 0.5;
      const yRatio = e.clientY / window.innerHeight - 0.5;

      gsap.to(glows[0], { x: xRatio * 40, y: yRatio * 40, duration: 1.2, ease: 'power2.out' });
      gsap.to(glows[1], { x: xRatio * -30, y: yRatio * -30, duration: 1.2, ease: 'power2.out' });
    });
  }

  /* -------------------------------------------------------------------
     7. CTA BUTTON HANDLERS
     The application shell (sidebar / header / map / panel) is a
     later feature. For now these hook into a single entry point,
     launchPlatform(), so the next feature can extend it in place.
  ------------------------------------------------------------------- */
 function launchPlatform() {
    gsap.to(DOM.launchBtn, {
      scale: 0.96,
      duration: 0.12,
      yoyo: true,
      repeat: 1,
      ease: 'power1.inOut',
    });

    const tl = gsap.timeline({
      defaults: { ease: 'power3.inOut' },
      onComplete: () => {
        DOM.landing.style.display = 'none';
        MKNexus.Shell.mount();
      },
    });

    tl.to('.landing__hero > *', { opacity: 0, y: -12, duration: 0.35, stagger: 0.04 }, 0)
      .to('.landing__topbar, .landing__footer', { opacity: 0, duration: 0.35 }, 0)
      .to(DOM.landing, { opacity: 0, duration: 0.4 }, 0.1);
  }

  // Reverse of launchPlatform() — the shell header's Home button, so
  // "back to the page with Launch Platform on it" is always one click
  // away instead of a dead end once you're inside the shell.
  function exitToLanding() {
    const shell = document.getElementById('app-shell');
    gsap.to(shell, {
      opacity: 0,
      duration: 0.4,
      ease: 'power2.inOut',
      onComplete: () => {
        shell.style.display = 'none';
        DOM.landing.style.display = '';
        playLandingIntro();
      },
    });
  }

  // The header profile menu's "Log out" — clears the stored session
  // token (both storages login.js may have written it to) and drops the
  // user back at the login gate, instead of the previous no-op that left
  // an authenticated session sitting in storage indefinitely.
  function logout() {
    try {
      const key = MKNexus.ApiConfig.sessionStorageKey;
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    } catch { /* storage unavailable — nothing to clear */ }

    const shell = document.getElementById('app-shell');
    gsap.to(shell, {
      opacity: 0,
      duration: 0.4,
      ease: 'power2.inOut',
      onComplete: () => {
        shell.style.display = 'none';
        DOM.landing.style.display = 'none';
        DOM.landing.style.opacity = 0;
        MKNexus.Login.show({
          onSuccess: () => {
            DOM.landing.style.display = '';
            playLandingIntro();
            startCoordTicker();
          },
        });
      },
    });
  }

  function showHowItWorks() {
    gsap.to(DOM.learnBtn, {
      scale: 0.96,
      duration: 0.12,
      yoyo: true,
      repeat: 1,
      ease: 'power1.inOut',
    });
    console.info('[MK Nexus] "See how it works" requested — content not yet built.');
  }

  function bindCtaHandlers() {
    DOM.launchBtn?.addEventListener('click', launchPlatform);
    DOM.learnBtn?.addEventListener('click', showHowItWorks);
    DOM.shellHomeBtn?.addEventListener('click', exitToLanding);
  }

  // Exposed so header.js's Log out button can trigger it without app.js
  // reaching into the header module, or vice versa.
  window.MKNexus.App = { logout };

  /* -------------------------------------------------------------------
     8. INIT
     Boot sequence -> Login gate -> Landing page -> (Launch Platform) -> Shell.
  ------------------------------------------------------------------- */
  function init() {
    DOM.contourPaths = document.querySelectorAll('.contour-path');
    DOM.coordReadout.textContent = formatCoords(BASE_COORDS.lat, BASE_COORDS.lng);

    bindCtaHandlers();
    initParallax();

    runLoadingSequence(() => {
      MKNexus.Login.show({
        onSuccess: () => {
          playLandingIntro();
          startCoordTicker();
        },
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
