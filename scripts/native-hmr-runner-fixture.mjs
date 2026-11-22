import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { chromium } from '@playwright/test';

if (process.env.NATIVE_RUNNER_PROBE === 'signal') {
  const launch = chromium.launchServer.bind(chromium);
  chromium.launchServer = async (options) => {
    const browser = await launch(options);
    const close = browser.close.bind(browser);
    browser.close = async () => {
      const release = once(process, 'message');
      process.send({ type: 'cleanup-barrier', browserPid: browser.process().pid });
      await release;
      process.disconnect();
      return close();
    };
    return browser;
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    // Acknowledge after every listener, including the runner's, has handled the real signal.
    process.on(signal, () => setImmediate(() => process.send({ type: 'signal', signal })));
  }
}

if (process.env.NATIVE_RUNNER_PROBE === 'post-stop') {
  const append = fs.appendFileSync;
  fs.appendFileSync = (filename, text, ...options) => {
    append(filename, text, ...options);
    if (path.basename(filename) !== 'events.jsonl') return;
    const event = JSON.parse(text);
    if (event.type !== 'server-stopped' || event.phase !== 'cleanup') return;
    // Swap the working cache only after the owned producer has shut down.
    const cache = path.resolve(process.env.NATIVE_RUNNER_LINK);
    fs.renameSync(cache, path.join(path.dirname(filename), 'cache-before-link'));
    fs.symlinkSync(process.env.NATIVE_RUNNER_EXTERNAL_CACHE, cache);
  };
}
