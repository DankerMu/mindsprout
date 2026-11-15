import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectExpectedResponses } from './support/expected-responses';
import type { ExpectedResponse } from './support/expected-responses';

const RESOURCE_ERROR =
  'Failed to load resource: the server responded with a status of 401 (Unauthorized)';

async function fetchSession(page: Page, path = '/api/auth/session') {
  const target = new URL(path, page.url());
  target.hash = '';
  const sessionUrl = target.href;
  const responseObserved = page.waitForEvent('response', {
    predicate: (response) => response.url() === sessionUrl,
  });
  const resourceErrorObserved = page.waitForEvent('console', {
    predicate: (message) =>
      message.type() === 'error' &&
      message.location().url === sessionUrl &&
      message.text() === RESOURCE_ERROR,
  });

  const [response, resourceError] = await Promise.all([
    responseObserved,
    resourceErrorObserved,
    page.evaluate(async (url) => {
      await fetch(url);
    }, path),
  ]);

  expect(response.status()).toBe(401);
  expect(resourceError.type()).toBe('error');
}

test('declared observed session 401 produces no console noise', async ({ page }) => {
  const collector = collectExpectedResponses(page, [{ url: '/api/auth/session', status: 401 }]);
  await page.goto('/api/healthz');
  await fetchSession(page);
  expect(await collector.noise()).toEqual([]);
});

test('undeclared session 401 remains console noise', async ({ page }) => {
  const collector = collectExpectedResponses(page, []);
  await page.goto('/api/healthz');
  await fetchSession(page);
  expect(await collector.noise()).toEqual([`error: ${RESOURCE_ERROR}`]);
});

const mismatches: { name: string; declaration: ExpectedResponse; unused: string }[] = [
  {
    name: 'wrong status',
    declaration: { url: '/api/auth/session', status: 404 },
    unused: 'unused expected response: 404 /api/auth/session',
  },
  {
    name: 'truncated pathname',
    declaration: { url: '/api/auth/sessio', status: 401 },
    unused: 'unused expected response: 401 /api/auth/sessio',
  },
  {
    name: 'substring regex',
    declaration: { url: /auth\/session/, status: 401 },
    unused: 'unused expected response: 401 /auth\\/session/',
  },
];

for (const { name, declaration, unused } of mismatches) {
  test(`${name} retains the resource error and unused declaration`, async ({ page }) => {
    const collector = collectExpectedResponses(page, [declaration]);
    await page.goto('/api/healthz');
    await fetchSession(page);
    expect(await collector.noise()).toEqual([`error: ${RESOURCE_ERROR}`, unused]);
  });
}

test('unrequested declarations remain in declaration order', async ({ page }) => {
  const collector = collectExpectedResponses(page, [
    { url: '/api/auth/session', status: 401 },
    { url: '/api/auth/session?unused=true#unused', status: 404 },
  ]);
  await page.goto('/api/healthz');
  expect(await collector.noise()).toEqual([
    'unused expected response: 401 /api/auth/session',
    'unused expected response: 404 /api/auth/session',
  ]);
});

test('unrelated console error beside a declared session 401 remains noise', async ({ page }) => {
  const collector = collectExpectedResponses(page, [{ url: '/api/auth/session', status: 401 }]);
  await page.goto('/api/healthz');
  await fetchSession(page);
  const errorObserved = page.waitForEvent('console', {
    predicate: (message) => message.type() === 'error' && message.text() === 'session view failed',
  });
  await page.evaluate(() => {
    console.error('session view failed');
  });
  await errorObserved;
  expect(await collector.noise()).toEqual(['error: session view failed']);
});

const pathCases: {
  name: string;
  url: string | RegExp;
  absolute?: boolean;
  request?: string;
}[] = [
  { name: 'relative pathname', url: '/api/auth/session' },
  { name: 'absolute URL', url: '/api/auth/session', absolute: true },
  { name: 'declaration query', url: '/api/auth/session?declared=true' },
  { name: 'declaration fragment', url: '/api/auth/session#declared' },
  {
    name: 'absolute declaration query and fragment',
    url: '/api/auth/session?declared=true#declared',
    absolute: true,
  },
  {
    name: 'different request query',
    url: '/api/auth/session?declared=true#declared',
    request: '/api/auth/session?observed=true',
  },
  {
    name: 'whole-path regex ignores request query',
    url: /\/api\/auth\/session/g,
    request: '/api/auth/session?observed=true',
  },
];

for (const { name, url, absolute, request } of pathCases) {
  test(`${name} matches the observed session pathname`, async ({ page }) => {
    await page.goto('/api/healthz');
    const pattern = absolute && typeof url === 'string' ? new URL(url, page.url()).href : url;
    const collector = collectExpectedResponses(page, [{ url: pattern, status: 401 }]);
    await fetchSession(page, request);
    expect(await collector.noise()).toEqual([]);
  });
}

test('request fragment preserves unmatched full-URL resource noise', async ({ page }) => {
  const collector = collectExpectedResponses(page, [{ url: '/api/auth/session', status: 401 }]);
  await page.goto('/api/healthz');
  const responseUrl = new URL('/api/auth/session?observed=true', page.url()).href;
  const consoleUrl = new URL('/api/auth/session?observed=true#observed', page.url()).href;
  const responseObserved = page.waitForEvent('response', {
    predicate: (response) => response.url() === responseUrl && response.status() === 401,
  });
  const consoleObserved = page.waitForEvent('console', {
    predicate: (message) =>
      message.type() === 'error' &&
      message.location().url === consoleUrl &&
      message.text() === RESOURCE_ERROR,
  });
  const [response, resourceError] = await Promise.all([
    responseObserved,
    consoleObserved,
    page.evaluate(async () => {
      await fetch('/api/auth/session?observed=true#observed');
    }),
  ]);
  expect(response.url()).toBe(responseUrl);
  expect(resourceError.location().url).toBe(consoleUrl);
  expect(response.url()).not.toBe(resourceError.location().url);
  expect(response.status()).toBe(401);
  expect(resourceError.type()).toBe('error');
  expect(await collector.noise()).toEqual([
    `error: ${RESOURCE_ERROR}`,
    'outstanding expected response: 401 /api/auth/session (missing console event)',
    'outstanding expected response: 401 /api/auth/session (missing response event)',
  ]);
});

test('warnings and uncaught page errors beside a declared 401 remain ordered noise', async ({
  page,
}) => {
  const collector = collectExpectedResponses(page, [{ url: '/api/auth/session', status: 401 }]);
  await page.goto('/api/healthz');
  await fetchSession(page);
  const warningObserved = page.waitForEvent('console', {
    predicate: (message) =>
      message.type() === 'warning' && message.text() === 'session view warning',
  });
  await page.evaluate(() => {
    console.warn('session view warning');
  });
  await warningObserved;

  const pageErrorObserved = page.waitForEvent('pageerror');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('session view crashed');
    }, 0);
  });
  const pageError = await pageErrorObserved;
  expect(pageError.message).toBe('session view crashed');
  expect(await collector.noise()).toEqual([
    'warning: session view warning',
    'pageerror: Error: session view crashed',
  ]);
});

test('duplicate session responses do not consume a declared regex', async ({ page }) => {
  const collector = collectExpectedResponses(page, [
    { url: /\/api\/auth\/session/gy, status: 401 },
  ]);
  await page.goto('/api/healthz');
  await fetchSession(page);
  await fetchSession(page);
  expect(await collector.noise()).toEqual([]);
  expect(await collector.noise()).toEqual([]);
});

test('reading at the first session event reconciles response and console', async ({ page }) => {
  const collector = collectExpectedResponses(page, [{ url: '/api/auth/session', status: 401 }]);
  await page.goto('/api/healthz');
  const sessionUrl = new URL('/api/auth/session', page.url()).href;
  const order: string[] = [];
  page.on('response', (response) => {
    if (response.url() === sessionUrl && response.status() === 401) order.push('response');
  });
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      message.location().url === sessionUrl &&
      message.text() === RESOURCE_ERROR
    )
      order.push('console');
  });
  const responseObserved = page.waitForResponse(
    (response) => response.url() === sessionUrl && response.status() === 401,
  );
  const consoleObserved = page.waitForEvent('console', {
    predicate: (message) =>
      message.type() === 'error' &&
      message.location().url === sessionUrl &&
      message.text() === RESOURCE_ERROR,
  });
  const readAtFirstEvent = Promise.race([responseObserved, consoleObserved]).then(async () => {
    const noise = await collector.noise();
    expect(order).toHaveLength(2);
    expect(order).toEqual(expect.arrayContaining(['response', 'console']));
    return noise;
  });
  const [noise] = await Promise.all([readAtFirstEvent, fetchSession(page)]);
  await Promise.all([responseObserved, consoleObserved]);
  expect(noise).toEqual([]);
  test.info().annotations.push({ type: 'resource-event-order', description: order.join(' -> ') });
});
