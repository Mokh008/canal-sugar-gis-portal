window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Animation Ticker: one requestAnimationFrame loop shared by
   every cosmetic map animation (selection pulse, traveling sweep, ambient
   breathing, idle camera drift) instead of each owning a private rAF loop.
   Tasks register with their own throttle interval, so a slow 6-8s "breathe"
   and a 30fps-capped pulse can share one driver without stepping on each
   other. The whole ticker pauses on `visibilitychange` — a backgrounded tab
   costs nothing instead of running four invisible animation loops. */
MKNexus.AnimationTicker = (function () {
  const tasks = new Map(); // id -> { fn, intervalMs, lastRun }
  let frame = null;
  let running = false;

  function loop(now) {
    tasks.forEach((task) => {
      if (now - task.lastRun >= task.intervalMs) {
        task.lastRun = now;
        try {
          task.fn(now);
        } catch (error) {
          console.error('[MK Nexus] Animation task failed, dropping it', error);
          tasks.delete(task.id);
        }
      }
    });
    frame = running ? requestAnimationFrame(loop) : null;
  }

  function start() {
    if (running) return;
    running = true;
    frame = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (frame) cancelAnimationFrame(frame);
    frame = null;
  }

  // `intervalMs` throttles how often this task's fn actually runs (0 = every
  // frame). `fn` receives the current `performance.now()` timestamp, same as
  // a raw rAF callback would.
  function register(id, fn, { intervalMs = 0 } = {}) {
    tasks.set(id, { id, fn, intervalMs, lastRun: 0 });
    start();
  }

  function unregister(id) {
    tasks.delete(id);
    if (!tasks.size) stop();
  }

  function isRegistered(id) {
    return tasks.has(id);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else if (tasks.size) start();
    });
  }

  return { register, unregister, isRegistered };
})();
