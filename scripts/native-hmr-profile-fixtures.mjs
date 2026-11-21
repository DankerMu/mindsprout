import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNativeProfile } from './native-hmr-profile-collection.mjs';
import { createBrowserProfiler } from './native-hmr-browser-profile.mjs';

export {
  secret,
  sha,
  digest,
  profileName,
  temporary,
  noSecrets,
  partial,
  cpu,
  span,
  identity,
  collector,
  generationFiles,
  generation,
  deferred,
  browserFixture,
};
const secret = 'PRIVATE_CANARY_cookie-password-body-env';
const sha = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const profileName = (role) => `${role}-2026-11-16T10-00-00.cpuprofile`;
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function noSecrets(value) {
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_CANARY|__proto__|\/private\/|https:\/\//);
}

function partial(value, code) {
  assert.equal(value.status, 'partial');
  assert.ok(value.codes.includes(code), `Expected fixed partial code ${code}`);
  noSecrets(value);
}

function cpu() {
  return {
    nodes: [
      { id: 1, callFrame: { functionName: '(root)', url: '', scriptId: '0' }, children: [2, 3, 4] },
      { id: 2, callFrame: { functionName: secret, url: `/private/${secret}.js`, scriptId: '1' } },
      { id: 3, callFrame: { functionName: '(garbage collector)', url: '', scriptId: '0' } },
      { id: 4, callFrame: { functionName: '(idle)', url: '', scriptId: '0' } },
    ],
    startTime: 8000000000,
    endTime: 8001500000,
    samples: [2, 3, 4, 2],
    timeDeltas: [250000, 250000, 500000, 500000],
    extra: secret,
  };
}

function span(overrides = {}) {
  return {
    name: 'compile-path',
    startTime: 1794823200000,
    timestamp: 4105188000000,
    duration: 125000,
    id: 12,
    parentId: 11,
    tags: { trigger: '/maps/[id]', cookie: secret, [secret]: 42, numeric: 13 },
    traceId: secret,
    ...overrides,
  };
}

function identity() {
  return {
    workflowSha: sha,
    checkoutSha: 'c'.repeat(40),
    prHeadSha: 'd'.repeat(40),
    runId: '1234',
    runAttempt: '2',
    nodeVersion: 'v22.23.4',
    platform: 'darwin',
    arch: 'arm64',
    nativeTarget: 'darwin-arm64',
    nativeDigest: digest,
    mode: 'restored-lifecycle',
    environment: { SECRET: secret },
    repo: `/private/${secret}`,
  };
}

function collector(t, options = {}) {
  const repo = temporary(t);
  const output = path.join(repo, 'output');
  fs.mkdirSync(output);
  const value = createNativeProfile({
    enabled: true,
    repo,
    output,
    identity: identity(),
    ...options,
  });
  return { repo, output, value, directory: path.join(repo, '.next-profiles') };
}

function generationFiles(repo, { trace = `${JSON.stringify([span()])}\n` } = {}) {
  fs.mkdirSync(path.join(repo, '.next/dev'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.next/dev/trace'), trace);
  for (const role of ['dev-main', 'dev-server']) {
    fs.writeFileSync(path.join(repo, '.next-profiles', profileName(role)), JSON.stringify(cpu()));
  }
}

function generation(index = 0) {
  return {
    generation: index,
    trial: index,
    stopped: true,
    launcherPid: 4321,
    processGroup: [4321, 4322],
    before: { epochMs: 1794823201000, elapsedMs: 1000 },
    after: { epochMs: 1794823202000, elapsedMs: 2000 },
    network: { timestamp: 42.125, wallTime: 1794823200.25, request: { url: secret } },
  };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function browserFixture(options = {}) {
  const calls = [];
  const gaps = [];
  const cdp = new EventEmitter();
  cdp.send = async (method) => {
    calls.push(method);
    return method === 'Profiler.stop' ? { profile: cpu(), secret } : {};
  };
  let elapsedMs = 0;
  const profiler = createBrowserProfiler({
    enabled: true,
    cdp,
    clock: () => ({ epochMs: 1794823200000 + elapsedMs, elapsedMs }),
    context: { generation: 0, trial: 0, page: 'retained-editor' },
    onGap: (gap) => gaps.push(gap),
    ...options,
  });
  return {
    calls,
    gaps,
    cdp,
    profiler,
    advance: (ms) => {
      elapsedMs += ms;
    },
  };
}
