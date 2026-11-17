import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { deadline, processGroup, stopOwnedProcessGroup } from './native-hmr-support.mjs';
import { createNativeProfile } from './native-hmr-profile-collection.mjs';
import { createBrowserProfiler } from './native-hmr-browser-profile.mjs';

export function launchNativeBrowser() {
  // Collector-owned teardown must finish; Playwright's SIGINT exit 130 bypasses it.
  const options = { handleSIGINT: false, handleSIGTERM: false };
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  return chromium.launchServer(options);
}

function runtimeIdentity(repo, mode, addon) {
  let checkoutSha;
  try {
    checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Local provenance can be unknown.
  }
  return {
    workflowSha: process.env.NATIVE_PROFILE_WORKFLOW_SHA,
    checkoutSha,
    prHeadSha: process.env.NATIVE_PROFILE_HEAD_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    nativeTarget: addon.target,
    nativeDigest: addon.binarySha256,
    mode,
  };
}

export function createRuntimeProfile(
  { profile: enabled, repo, out: output, mode, started },
  context,
) {
  const profilers = new Set();
  const clock = () => ({ epochMs: Date.now(), elapsedMs: performance.now() - started });
  let profiles,
    serverStart,
    network,
    interrupted = false;

  function prepare(addon, result) {
    if (!enabled) return true;
    profiles = createNativeProfile({
      enabled: true,
      repo,
      output,
      identity: runtimeIdentity(repo, mode, addon),
    });
    const ready = profiles.prepare().status === 'complete';
    if (!ready) result.status = 'profile-refused';
    return ready;
  }

  function beginServer() {
    if (!enabled) return;
    profiles.beginServer(context());
    network = undefined;
    serverStart = clock();
  }

  function serverGroup(pid) {
    if (!enabled) return [];
    try {
      return processGroup(pid).map((item) => item.pid);
    } catch {
      // Unobserved identity remains empty.
      return [];
    }
  }

  async function stopServer(child, exit) {
    const group = serverGroup(child.pid);
    await stopOwnedProcessGroup(child, exit);
    return group;
  }

  async function collectServer(pid, group) {
    if (!enabled) return;
    await profiles.collectServer({
      ...context(),
      stopped: true,
      launcherPid: pid,
      processGroup: group,
      before: serverStart,
      after: clock(),
      network,
    });
  }

  function recordNetwork(data, label) {
    if (enabled) network = { timestamp: data.timestamp, wallTime: data.wallTime, page: label };
  }

  async function attach(page, cdp, label, browser) {
    if (!enabled) return;
    const profiler = createBrowserProfiler({
      enabled: true,
      cdp,
      clock,
      context: () => ({ ...context(), page: label }),
      onInterval: profiles.addBrowserInterval,
      reserve: profiles.reserveBrowserInterval,
    });
    profilers.add(profiler);
    page.on('close', () => profiler.disconnect());
    page.on('crash', () => profiler.disconnect());
    browser.on('disconnected', () => profiler.disconnect());
    await profiler.start();
  }

  async function suspend() {
    if (enabled) await Promise.all([...profilers].map((profiler) => profiler.suspend()));
  }

  async function resume() {
    if (enabled) await Promise.all([...profilers].map((profiler) => profiler.resume()));
  }

  async function closeBrowser(browser, browserServer, errors) {
    try {
      await deadline(
        (async () => {
          if (enabled) await Promise.all([...profilers].map((profiler) => profiler.close()));
          await browser?.close();
        })(),
        5000,
        'Browser close',
      );
      await deadline(browserServer?.close() || Promise.resolve(), 5000, 'Browser process close');
      return undefined;
    } catch (error) {
      errors.push(error.message);
      return browserServer;
    }
  }

  function interrupt() {
    interrupted = true;
    for (const profiler of profilers) profiler.interrupt();
  }

  function registerSignals(reject) {
    const signal = (name) => {
      interrupt();
      reject(new Error(`Interrupted by ${name}`));
    };
    const sigterm = () => signal('SIGTERM');
    const sigint = () => signal('SIGINT');
    process.on('SIGTERM', sigterm);
    process.on('SIGINT', sigint);
    return () => {
      process.off('SIGTERM', sigterm);
      process.off('SIGINT', sigint);
    };
  }

  async function finish(serverStopped) {
    if (!profiles) return;
    for (const profiler of profilers) {
      profiler.finalize();
      profiles.recordBrowserProblems(profiler.snapshot().codes);
    }
    await profiles.finish({ interrupted, serverStopped });
  }

  return {
    prepare,
    beginServer,
    stopServer,
    collectServer,
    recordNetwork,
    attach,
    suspend,
    resume,
    closeBrowser,
    registerSignals,
    finish,
  };
}
