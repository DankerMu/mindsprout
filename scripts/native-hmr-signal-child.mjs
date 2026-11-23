import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { createRuntimeProfile, launchNativeBrowser } from './native-hmr-runtime-profile.mjs';

async function run() {
  const [mode, directory] = process.argv.slice(2);
  const started = performance.now();
  function milestone(type, browserPid) {
    process.send({ type, browserPid, elapsedMs: Math.round(performance.now() - started) });
  }
  const profiling = createRuntimeProfile(
    {
      profile: mode === 'profile',
      repo: directory,
      out: directory,
      mode: 'source-change',
      started,
    },
    () => ({ generation: 0, trial: 0 }),
  );
  let rejectInterrupt, releaseCleanup;
  const interrupted = new Promise((_, reject) => {
    rejectInterrupt = reject;
  });
  interrupted.catch(() => undefined);
  const cleanupReleased = new Promise((resolve) => {
    releaseCleanup = resolve;
  });
  let signalReceived = false;
  const removeSignals = profiling.registerSignals((error) => {
    signalReceived = true;
    rejectInterrupt(error);
  });
  const onMessage = (message) => {
    if (message.type === 'finish-cleanup') releaseCleanup();
    if (message.type === 'cleanup') rejectInterrupt(new Error('Test cleanup'));
  };
  process.on('message', onMessage);
  const errors = [];
  let browserServer, browser, browserProcess;
  try {
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||= chromium.executablePath();
    browserServer = await launchNativeBrowser();
    browserProcess = browserServer.process();
    milestone('browser-launched', browserProcess.pid);
    milestone('connecting');
    browser = await Promise.race([chromium.connect(browserServer.wsEndpoint()), interrupted]);
    milestone('ready', browserProcess.pid);
    await interrupted;
  } catch (error) {
    if (!signalReceived) throw error;
  } finally {
    browserServer = await profiling.closeBrowser(browser, browserServer, errors);
    process.send({ type: 'browser-closed' });
    await cleanupReleased;
    const browserExited =
      browserProcess !== undefined &&
      (browserProcess.exitCode !== null || browserProcess.signalCode !== null);
    fs.writeFileSync(
      path.join(directory, 'cleanup.json'),
      JSON.stringify({
        cleanupCompleted: browserServer === undefined && browserExited && errors.length === 0,
        signalReceived,
        browserExited,
        errors: errors.length ? ['Browser signal fixture cleanup failed'] : [],
      }),
    );
    removeSignals();
    process.off('message', onMessage);
    process.disconnect();
  }
  process.exitCode = 1;
}

run().catch(() => {
  process.stderr.write('Browser signal fixture failed\n');
  process.exitCode = 2;
});
