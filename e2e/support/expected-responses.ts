import type { ConsoleMessage, Page } from '@playwright/test';

/** Strings resolve against the page URL; strings and regexes match the whole pathname only. */
export interface ExpectedResponse {
  readonly url: string | RegExp;
  readonly status: number;
}

interface Observation {
  url: string;
  status: number;
  responses: number;
  consoles: number;
}

interface NoiseEntry {
  text: string;
  resource?: Observation | undefined;
}

// Bound missing counterpart events without delaying already-reconciled reads.
const RECONCILIATION_TIMEOUT_MS = 5_000;
const RESOURCE_ERROR =
  /^Failed to load resource: the server responded with a status of (\d{3}) \([^\r\n]*\)$/;

function pathname(url: string, base: string): string {
  return new URL(url, base).pathname;
}

function declarationMatcher(declaration: ExpectedResponse, page: Page) {
  const pattern = declaration.url;
  const regex =
    pattern instanceof RegExp
      ? new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace(/[gy]/g, ''))
      : null;
  return (url: string, status: number) => {
    if (status !== declaration.status) return false;
    const path = pathname(url, page.url());
    if (typeof pattern === 'string') return path === pathname(pattern, page.url());
    const match = regex?.exec(path);
    return match?.index === 0 && match[0] === path;
  };
}

function resourceStatus(message: ConsoleMessage): number | undefined {
  if (message.type() !== 'error' || message.args().length !== 0) return undefined;
  const match = RESOURCE_ERROR.exec(message.text());
  return match ? Number(match[1]) : undefined;
}

function outstanding(observation: Observation): boolean {
  return (
    observation.responses > observation.consoles ||
    (observation.responses === 0 && observation.consoles > 0)
  );
}

/**
 * Register before navigation/fetch; listeners live as long as this page.
 * Query/fragment and origin are ignored only for declaration matching. Resource
 * suppression requires identical full console/response URLs and all three statuses.
 * Regexes must match the entire pathname; global/sticky state is ignored.
 *
 * Await the request's response AND Chromium resource-error console event before
 * asserting noise(). A read also waits up to 5 seconds for outstanding observed
 * counterparts, reporting diagnostics on expiry rather than an early empty result.
 * Duplicate responses are counted; suppression never consumes an observation.
 *
 * Known limitations: only this page's response events count, not page.request.
 * Reads cannot anticipate requests not yet started. Messages retain observation
 * order, followed by unused declarations in declaration order and outstanding pairs.
 * Diagnostics omit query strings, credentials and response bodies.
 */
export function collectExpectedResponses(page: Page, declarations: readonly ExpectedResponse[]) {
  const expected = declarations.map((declaration) => ({
    declaration,
    matches: declarationMatcher(declaration, page),
    used: false,
  }));
  const observations = new Map<string, Observation>();
  const entries: NoiseEntry[] = [];
  const readers = new Set<() => void>();

  function observation(url: string, status: number): Observation | undefined {
    if (!expected.some((item) => item.matches(url, status))) return undefined;
    const key = `${String(status)} ${url}`;
    let result = observations.get(key);
    if (!result) {
      result = { url, status, responses: 0, consoles: 0 };
      observations.set(key, result);
    }
    return result;
  }

  function notify() {
    for (const reader of readers) reader();
  }

  page.on('response', (response) => {
    const url = response.url();
    const status = response.status();
    for (const item of expected) {
      if (item.matches(url, status)) item.used = true;
    }
    const observed = observation(url, status);
    if (observed) observed.responses += 1;
    notify();
  });
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const status = resourceStatus(message);
    const resource = status === undefined ? undefined : observation(message.location().url, status);
    if (resource) resource.consoles += 1;
    entries.push({ text: `${message.type()}: ${message.text()}`, resource });
    notify();
  });
  page.on('pageerror', (error) => {
    entries.push({ text: `pageerror: ${String(error)}` });
  });

  function pending() {
    return [...observations.values()].filter(outstanding);
  }

  async function reconcile() {
    if (pending().length === 0) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, RECONCILIATION_TIMEOUT_MS);
      function finish() {
        clearTimeout(timer);
        readers.delete(check);
        resolve();
      }
      function check() {
        if (pending().length === 0) finish();
      }
      readers.add(check);
    });
  }

  return {
    async noise(): Promise<string[]> {
      await reconcile();
      const noise = entries
        .filter((entry) => !entry.resource?.responses)
        .map((entry) => entry.text);
      for (const item of expected) {
        if (item.used) continue;
        const { url, status } = item.declaration;
        const label = typeof url === 'string' ? pathname(url, page.url()) : String(url);
        noise.push(`unused expected response: ${String(status)} ${label}`);
      }
      for (const item of pending()) {
        const missing = item.responses === 0 ? 'response' : 'console';
        noise.push(
          `outstanding expected response: ${String(item.status)} ${pathname(item.url, page.url())} (missing ${missing} event)`,
        );
      }
      return noise;
    },
  };
}
