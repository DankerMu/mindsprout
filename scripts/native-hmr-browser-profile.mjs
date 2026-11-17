import { deadline } from './native-hmr-support.mjs';
import {
  disabled,
  partial,
  bracket,
  safeInterval,
  projectCpuProfile,
} from './native-hmr-profile-projection.mjs';

function recordProfileTransition(active, clock, event) {
  if (!active || !event?.frame || event.frame.parentId) return;
  const observed = bracket(clock());
  const transitions = active.documentTransitions;
  transitions.count = Math.min(Number.MAX_SAFE_INTEGER, transitions.count + 1);
  if (!transitions.first) transitions.first = observed;
  transitions.last = observed;
}

export function createBrowserProfiler({
  enabled,
  cdp,
  clock = () => ({ epochMs: Date.now(), elapsedMs: 0 }),
  context = {},
  onInterval = () => undefined,
  reserve = () => true,
}) {
  let state = 'idle',
    configured = false,
    epoch = 0,
    active,
    pauseAt,
    pendingGap;
  const intervals = [],
    gaps = [],
    problems = new Set();
  const snapshot = () =>
    !enabled
      ? disabled()
      : {
          status:
            problems.size || intervals.some((interval) => interval.status === 'partial')
              ? 'partial'
              : 'complete',
          codes: [...problems],
          intervals,
          gaps,
        };
  const frameNavigated = (event) => recordProfileTransition(active, clock, event);
  if (enabled) cdp.on('Page.frameNavigated', frameNavigated);
  function abandon(code) {
    if (!enabled || state === 'abandoned' || state === 'closed') return;
    epoch++;
    state = 'abandoned';
    problems.add(code);
    cdp.off('Page.frameNavigated', frameNavigated);
    if (active) {
      const interval = safeInterval({
        ...active,
        after: bracket(clock()),
        ...partial(code),
        cpu: partial(code),
      });
      intervals.push(interval);
      onInterval(interval);
      active = undefined;
    }
  }
  async function command(method) {
    const current = epoch;
    try {
      const reply = await deadline(cdp.send(method), 1000, 'Profiler operation');
      return current === epoch && state !== 'abandoned' ? { ok: true, reply } : { ok: false };
    } catch (error) {
      if (current === epoch)
        abandon(
          error?.message === 'Profiler operation exceeded 1000ms' ? 'cdp-timeout' : 'cdp-failed',
        );
      return { ok: false };
    }
  }
  async function start() {
    if (!enabled || state !== 'idle') return;
    if (!reserve()) {
      abandon('browser-interval-limit');
      return;
    }
    state = 'starting';
    const observed = typeof context === 'function' ? context() : context;
    active = {
      generation: observed.generation,
      trial: observed.trial,
      page: observed.page,
      before: bracket(clock()),
      gap: pendingGap,
      documentTransitions: { count: 0, first: null, last: null },
    };
    pendingGap = undefined;
    if (!configured) {
      if (!(await command('Profiler.enable')).ok) return;
      configured = true;
    }
    if (!(await command('Profiler.start')).ok) return;
    state = 'active';
  }
  async function stop() {
    if (!enabled || state !== 'active') return;
    state = 'stopping';
    const result = await command('Profiler.stop');
    if (!result.ok) return;
    const cpu = projectCpuProfile(result.reply?.profile);
    const interval = safeInterval({
      ...active,
      after: bracket(clock()),
      status: cpu.status,
      codes: cpu.codes,
      cpu,
    });
    intervals.push(interval);
    onInterval(interval);
    active = undefined;
    state = 'idle';
  }
  async function suspend() {
    if (!enabled || ['abandoned', 'closed', 'suspended'].includes(state)) return;
    if (state === 'starting' || state === 'stopping') {
      abandon('browser-suspended');
      return;
    }
    await stop();
    if (state === 'abandoned') return;
    pauseAt = bracket(clock()).elapsedMs;
    state = 'suspended';
  }
  async function resume() {
    if (!enabled || state !== 'suspended') return;
    pendingGap = {
      fromElapsedMs: pauseAt,
      toElapsedMs: bracket(clock()).elapsedMs,
      reason: 'browser-suspended',
    };
    gaps.push(pendingGap);
    const gap = pendingGap;
    state = 'idle';
    await start();
    gap.toElapsedMs = bracket(clock()).elapsedMs;
  }
  async function close() {
    if (!enabled || state === 'closed' || state === 'abandoned') return;
    if (state === 'starting' || state === 'stopping') abandon('interrupted');
    else if (state === 'suspended') abandon('browser-suspended');
    else {
      await stop();
      if (state !== 'abandoned') state = 'closed';
    }
    cdp.off('Page.frameNavigated', frameNavigated);
  }
  return {
    start,
    stop,
    suspend,
    resume,
    close,
    snapshot,
    disconnect: () => abandon('cdp-disconnected'),
    interrupt: () => abandon('interrupted'),
  };
}
