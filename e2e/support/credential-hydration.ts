import type { Page } from '@playwright/test';

declare global {
  interface Window {
    credentialHydration: { queued: (() => void)[]; release: () => void };
  }
}

export async function holdCredentialHydration(page: Page) {
  await page.addInitScript(() => {
    const queued: (() => void)[] = [];
    let held = true;
    window.credentialHydration = {
      queued,
      release: () => {
        held = false;
        for (const send of queued.splice(0)) send();
      },
    };
    // React Scheduler posts null to wake its MessageChannel; hold the wakeup, not the scripts.
    window.MessageChannel = class extends MessageChannel {
      constructor() {
        super();
        this.port2.postMessage = new Proxy(this.port2.postMessage.bind(this.port2), {
          apply(send, _port, args: [unknown]) {
            if (held && args[0] === null) {
              queued.push(() => {
                send(...args);
              });
            } else send(...args);
          },
        });
      }
    };
  });
}

export async function waitForCredentialHydrationWakeup(page: Page) {
  await page.waitForFunction(() => window.credentialHydration.queued.length > 0);
}

export async function releaseCredentialHydration(page: Page) {
  await page.evaluate(() => {
    window.credentialHydration.release();
  });
}
