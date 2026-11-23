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

const probe = process.env.NATIVE_RUNNER_PROBE;
const publication = probe?.startsWith('publication-');
if (publication) {
  const append = fs.appendFileSync;
  const signals = ['SIGINT', 'SIGTERM'];
  const before = signals.map((signal) => process.listenerCount(signal));
  const rejected = [];
  const pids = [];
  fs.appendFileSync = (filename, text, ...options) => {
    if (path.basename(filename) === 'events.jsonl') {
      const { type } = JSON.parse(text);
      if (type === 'public-create-evidence' && !rejected.includes(type)) {
        rejected.push(type);
        throw new Error('PRIVATE_CANARY evidence append failure');
      }
      if (type === 'public-create-observation-error' && probe === 'publication-root') {
        rejected.push(type);
        throw new Error('PRIVATE_CANARY fallback append failure');
      }
    }
    return append(filename, text, ...options);
  };
  const launch = chromium.launchServer.bind(chromium);
  chromium.launchServer = async (...args) => {
    const server = await launch(...args);
    pids.push(server.process().pid);
    return server;
  };
  process.once('exit', () => {
    fs.writeFileSync(
      path.join(path.dirname(process.argv[3]), 'publication-exit.json'),
      JSON.stringify({
        before,
        after: signals.map((signal) => process.listenerCount(signal)),
        rejected,
        pids,
      }),
    );
  });
}

if (probe === 'restored-trial' || probe === 'publication-action' || probe === 'publication-root') {
  const connect = chromium.connect.bind(chromium);
  chromium.connect = async (...args) => {
    const browser = await connect(...args);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...contextArgs) => {
      const context = await newContext(...contextArgs);
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        if (probe === 'publication-root') {
          page.goto = async () => {
            throw new Error('Controlled root commit failure');
          };
        } else if (probe === 'publication-action') {
          const getByRole = page.getByRole.bind(page);
          page.getByRole = (role, options) => {
            const button = getByRole(role, options);
            if (role === 'button' && options?.name === '新建导图') {
              button.click = async () => {
                throw new Error('Controlled first-create click failure');
              };
            }
            return button;
          };
        }
        if (probe !== 'restored-trial') return page;
        const locator = page.locator.bind(page);
        let mapClicks = 0;
        page.locator = (selector, ...options) => {
          const target = locator(selector, ...options);
          if (selector.startsWith('a[href="/maps/')) {
            const click = target.click.bind(target);
            target.click = (...clickArgs) => {
              if (++mapClicks === 2)
                return Promise.reject(new Error('Controlled restored trial click failure'));
              return click(...clickArgs);
            };
          }
          return target;
        };
        return page;
      };
      return context;
    };
    return browser;
  };
}
