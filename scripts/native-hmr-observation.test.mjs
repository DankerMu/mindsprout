import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bodyLiterals,
  cacheIdentity,
  headerValue,
  observeNavigation,
  observeScripts,
  probeLiterals,
  probeValue,
  scriptProvenance,
} from './native-hmr-observation.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('document responses and completion are observed before public map creation begins', () => {
  const cdp = new EventEmitter();
  cdp.send = () => assert.fail('Document observation must not issue CDP commands');
  const events = [];
  observeNavigation({ cdp, label: 'setup' }, (type, data, page) =>
    events.push({ type, data, page }),
  );
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'root',
    type: 'Document',
    request: { url: 'http://localhost:3000/' },
    timestamp: 10,
    loaderId: 'root-loader',
  });
  const response = {
    requestId: 'root',
    type: 'Document',
    timestamp: 11,
    response: {
      status: 200,
      timing: { requestTime: 10, sendEnd: 2, receiveHeadersEnd: 900 },
      protocol: 'http/1.1',
      fromDiskCache: false,
    },
  };
  cdp.emit('Network.responseReceived', response);
  cdp.emit('Network.loadingFinished', {
    requestId: 'root',
    timestamp: 12,
    encodedDataLength: 4096,
  });
  cdp.emit('Network.responseReceived', response);
  cdp.emit('Network.loadingFinished', { requestId: 'root', timestamp: 13 });
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'failed',
    type: 'Document',
    request: { url: 'http://localhost:3000/maps/test' },
    timestamp: 20,
    loaderId: 'failed-loader',
  });
  cdp.emit('Network.loadingFailed', {
    requestId: 'failed',
    timestamp: 21,
    errorText: 'net::ERR_ABORTED',
  });
  cdp.emit('Network.responseReceived', { ...response, requestId: 'failed' });
  cdp.emit('Network.loadingFailed', { requestId: 'failed', timestamp: 22 });
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'script',
    type: 'Script',
    request: { url: 'http://localhost:3000/script.js' },
    timestamp: 30,
    loaderId: 'root-loader',
  });
  cdp.emit('Network.responseReceived', { ...response, requestId: 'script', type: 'Script' });
  cdp.emit('Network.loadingFinished', { requestId: 'script', timestamp: 31 });
  assert.deepEqual(events, [
    {
      type: 'public-document-response',
      page: 'setup',
      data: {
        requestId: 'root',
        url: 'http://localhost:3000/',
        type: 'Document',
        requestTimestamp: 10,
        loaderId: 'root-loader',
        timestamp: 11,
        status: 200,
        timing: { requestTime: 10, sendEnd: 2, receiveHeadersEnd: 900 },
        protocol: 'http/1.1',
        fromDiskCache: false,
      },
    },
    {
      type: 'public-document-completion',
      page: 'setup',
      data: {
        requestId: 'root',
        url: 'http://localhost:3000/',
        type: 'Document',
        requestTimestamp: 10,
        loaderId: 'root-loader',
        event: 'Network.loadingFinished',
        timestamp: 12,
        encodedDataLength: 4096,
        errorText: undefined,
      },
    },
    {
      type: 'public-document-completion',
      page: 'setup',
      data: {
        requestId: 'failed',
        url: 'http://localhost:3000/maps/test',
        type: 'Document',
        requestTimestamp: 20,
        loaderId: 'failed-loader',
        event: 'Network.loadingFailed',
        timestamp: 21,
        encodedDataLength: undefined,
        errorText: 'net::ERR_ABORTED',
      },
    },
  ]);
});

test('profiled public creation retains classified PUT and RSC network delivery', async () => {
  const cdp = new EventEmitter();
  const commands = [];
  cdp.send = async (method) => {
    commands.push(method);
    assert.equal(method, 'Performance.getMetrics');
    return { metrics: [] };
  };
  const legacy = [];
  const diagnostics = [];
  const observation = observeNavigation(
    { cdp, label: 'setup' },
    (type, data) => legacy.push({ type, data }),
    {
      origin: 'http://localhost:3000',
      clock: () => ({ elapsedMs: 120, epochMs: 1800000000120 }),
      sink: (data) => diagnostics.push(data),
    },
  );
  await observation.begin();
  for (const request of [
    {
      requestId: 'persist-private-id',
      type: 'Fetch',
      method: 'PUT',
      url: 'http://localhost:3000/api/maps/private-map-id',
      timestamp: 10,
    },
    {
      requestId: 'rsc-private-id',
      type: 'Fetch',
      method: 'GET',
      url: 'http://localhost:3000/maps/private-map-id?_rsc=private-query',
      timestamp: 20,
    },
  ]) {
    cdp.emit('Network.requestWillBeSent', {
      requestId: request.requestId,
      type: request.type,
      request: { method: request.method, url: request.url },
      timestamp: request.timestamp,
    });
    cdp.emit('Network.responseReceived', {
      requestId: request.requestId,
      timestamp: request.timestamp + 0.1,
      response: { status: 200 },
    });
    cdp.emit('Network.dataReceived', {
      requestId: request.requestId,
      timestamp: request.timestamp + 0.2,
      dataLength: 32,
      encodedDataLength: 24,
    });
    cdp.emit('Network.loadingFinished', {
      requestId: request.requestId,
      timestamp: request.timestamp + 0.3,
      encodedDataLength: 48,
    });
  }
  await observation.end();
  assert.deepEqual(
    diagnostics
      .flatMap((entry) => entry.requests ?? [])
      .map((entry) => ({
        ordinal: entry.ordinal,
        requestClass: entry.requestClass,
        method: entry.method,
        requestTimestampSeconds: entry.requestTimestampSeconds,
        responseTimestampSeconds: entry.responseTimestampSeconds,
        responseStatus: entry.responseStatus,
        firstDataTimestampSeconds: entry.firstDataTimestampSeconds,
        dataLength: entry.dataLength,
        completionTimestampSeconds: entry.completionTimestampSeconds,
        completion: entry.completion,
      })),
    [
      {
        ordinal: 1,
        requestClass: 'map-put',
        method: 'PUT',
        requestTimestampSeconds: 10,
        responseTimestampSeconds: 10.1,
        responseStatus: 200,
        firstDataTimestampSeconds: 10.2,
        dataLength: 32,
        completionTimestampSeconds: 10.3,
        completion: 'finished',
      },
      {
        ordinal: 2,
        requestClass: 'editor-rsc',
        method: 'GET',
        requestTimestampSeconds: 20,
        responseTimestampSeconds: 20.1,
        responseStatus: 200,
        firstDataTimestampSeconds: 20.2,
        dataLength: 32,
        completionTimestampSeconds: 20.3,
        completion: 'finished',
      },
    ],
  );
  assert.deepEqual(commands, ['Performance.getMetrics', 'Performance.getMetrics']);
  assert.deepEqual(
    legacy
      .find((entry) => entry.type === 'public-create-network')
      .data.requests.map((entry) => entry.requestId),
    ['rsc-private-id'],
  );
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-|localhost|_rsc/);
});

test('probe literals follow the active qualification mode', () => {
  assert.deepEqual(probeLiterals('source-change'), ['Native HMR A', 'Native HMR B']);
  assert.deepEqual(probeLiterals('restored-lifecycle'), [
    'probe79-A',
    'probe79-B',
    'probe79-C',
    'probe79-D',
  ]);
  assert.throws(() => probeLiterals('other'), /Unknown browser qualification mode: other/);
});

test('body literals report exactly the compiled probe values present', () => {
  const literals = probeLiterals('source-change');
  assert.deepEqual(bodyLiterals(Buffer.from('children: "Native HMR A"'), literals), [
    'Native HMR A',
  ]);
  assert.deepEqual(bodyLiterals(Buffer.from('"Native HMR B" + "Native HMR A"'), literals), [
    'Native HMR A',
    'Native HMR B',
  ]);
  assert.deepEqual(bodyLiterals(Buffer.from('Native HMR C'), literals), []);
});

test('header lookup is case-insensitive and explicit about absence', () => {
  assert.equal(headerValue({ 'Cache-Control': 'no-store' }, 'cache-control'), 'no-store');
  assert.equal(headerValue({ etag: 'W/"1"' }, 'etag'), 'W/"1"');
  assert.equal(headerValue({}, 'etag'), null);
  assert.equal(headerValue(undefined, 'etag'), null);
});

test('script provenance separates memory, disk and network delivery', () => {
  const memory = scriptProvenance(
    {
      servedFromCache: true,
      initiator: { type: 'script', stack: { callFrames: [{ url: 'http://x/runtime.js' }] } },
    },
    { status: 200, fromDiskCache: false, headers: { 'Cache-Control': 'no-store' } },
    { encodedDataLength: 0 },
  );
  assert.deepEqual(memory, {
    servedFromCache: true,
    fromDiskCache: false,
    fromPrefetchCache: false,
    fromServiceWorker: false,
    status: 200,
    cacheControl: 'no-store',
    etag: null,
    lastModified: null,
    encodedDataLength: 0,
    initiator: { type: 'script', url: 'http://x/runtime.js' },
  });
  const disk = scriptProvenance(
    { initiator: { type: 'parser', url: 'http://x/maps/1' } },
    {
      status: 200,
      fromDiskCache: true,
      headers: { ETag: '"abc"', 'Last-Modified': 'Tue, 10 Nov 2026 00:00:00 GMT' },
    },
    { encodedDataLength: 12 },
  );
  assert.equal(disk.fromDiskCache, true);
  assert.equal(disk.servedFromCache, false);
  assert.equal(disk.etag, '"abc"');
  assert.equal(disk.lastModified, 'Tue, 10 Nov 2026 00:00:00 GMT');
  assert.deepEqual(disk.initiator, { type: 'parser', url: 'http://x/maps/1' });
  const network = scriptProvenance(
    {},
    { status: 304, fromServiceWorker: true, fromPrefetchCache: true },
    { encodedDataLength: 9 },
  );
  assert.equal(network.status, 304);
  assert.equal(network.fromServiceWorker, true);
  assert.equal(network.fromPrefetchCache, true);
  assert.equal(network.initiator, null);
});

test('probe value classifies rendered probe text', () => {
  const values = probeLiterals('source-change');
  assert.equal(probeValue([], values), 'absent');
  assert.equal(probeValue(['Native HMR A'], values), 'A');
  assert.equal(probeValue(['Native HMR B', 'Native HMR B'], values), 'B');
  assert.equal(probeValue(['Native HMR'], values), 'other');
  assert.equal(probeValue(['Native HMR A', 'Native HMR B'], values), 'mixed');
});

test('cache identity hashes every file by path, size and content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-cache-identity-'));
  try {
    assert.deepEqual(cacheIdentity(path.join(root, 'missing')), {
      absent: true,
      files: [],
      sha256: null,
    });
    fs.mkdirSync(path.join(root, 'cache/b'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cache/b/z.bin'), 'zz');
    fs.writeFileSync(path.join(root, 'cache/a.txt'), 'a');
    const identity = cacheIdentity(path.join(root, 'cache'));
    const files = [
      { path: 'a.txt', size: 1, sha256: sha256('a') },
      { path: path.join('b', 'z.bin'), size: 2, sha256: sha256('zz') },
    ];
    assert.deepEqual(identity, {
      absent: false,
      files,
      bytes: 3,
      sha256: sha256(files.map((item) => `${item.sha256} ${item.size} ${item.path}\n`).join('')),
    });
    fs.writeFileSync(path.join(root, 'cache/a.txt'), 'b');
    assert.notEqual(cacheIdentity(path.join(root, 'cache')).sha256, identity.sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('script observer keeps per-request bodies, timings and cache provenance', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-script-observer-'));
  try {
    const cdp = new EventEmitter();
    const bodies = { 'r.1': 'children: "Native HMR A"', 'r.2': 'children: "Native HMR B"' };
    cdp.send = async (method, { requestId }) => {
      assert.equal(method, 'Network.getResponseBody');
      return { body: Buffer.from(bodies[requestId]).toString('base64'), base64Encoded: true };
    };
    const events = [];
    const chunks = [];
    const pendingBodies = new Set();
    let clock = 0;
    observeScripts(
      { cdp, label: 'first-navigation' },
      {
        origin: 'http://localhost:3000',
        literals: probeLiterals('source-change'),
        out,
        record: (type, data, page) => events.push({ type, data, page }),
        elapsed: () => ++clock,
        context: () => ({ generation: 0, trial: 0 }),
        chunks,
        pendingBodies,
      },
    );
    const url = 'http://localhost:3000/_next/static/chunks/src_editor._.js';
    for (const [requestId, cached] of [
      ['r.1', false],
      ['r.2', true],
    ]) {
      cdp.emit('Network.requestWillBeSent', {
        requestId,
        type: 'Script',
        request: { url },
        timestamp: 10,
        loaderId: 'L',
        initiator: { type: 'script', url: 'http://localhost:3000/runtime.js' },
      });
      if (cached) cdp.emit('Network.requestServedFromCache', { requestId });
      cdp.emit('Network.responseReceived', {
        requestId,
        type: 'Script',
        timestamp: 11,
        response: { url, status: 200, fromDiskCache: false, headers: {} },
      });
      cdp.emit('Network.loadingFinished', { requestId, timestamp: 12, encodedDataLength: 5 });
    }
    for (const ignored of [
      { requestId: 'x.1', type: 'Script', url: 'http://elsewhere/a.js' },
      { requestId: 'x.2', type: 'Fetch', url: 'http://localhost:3000/a?_rsc=1' },
    ]) {
      cdp.emit('Network.requestWillBeSent', { ...ignored, request: { url: ignored.url } });
      cdp.emit('Network.responseReceived', { ...ignored, response: { url: ignored.url } });
      cdp.emit('Network.loadingFinished', { requestId: ignored.requestId });
    }
    await Promise.all([...pendingBodies]);
    assert.equal(pendingBodies.size, 0);
    assert.deepEqual(
      chunks.map((entry) => [
        entry.requestId,
        entry.page,
        entry.literals,
        entry.provenance.servedFromCache,
        entry.sha256,
        entry.generation,
      ]),
      [
        ['r.1', 'first-navigation', ['Native HMR A'], false, sha256(bodies['r.1']), 0],
        ['r.2', 'first-navigation', ['Native HMR B'], true, sha256(bodies['r.2']), 0],
      ],
    );
    assert.deepEqual(
      [chunks[0].requestMs, chunks[0].responseMs, chunks[0].finishMs],
      [1, 2, 3],
      'Monotonic request/response/finish ordering must be retained',
    );
    assert.deepEqual(
      [chunks[0].requestTimestamp, chunks[0].responseTimestamp, chunks[0].finishTimestamp],
      [10, 11, 12],
    );
    assert.equal(
      fs.readFileSync(path.join(out, `chunk-${sha256(bodies['r.2'])}.js`), 'utf8'),
      bodies['r.2'],
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ['chunk-body', 'chunk-body'],
    );
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('script observer records body failures without throwing', async () => {
  const cdp = new EventEmitter();
  cdp.send = async () => {
    throw new Error('No resource with given identifier found');
  };
  const events = [];
  const pendingBodies = new Set();
  observeScripts(
    { cdp, label: 'retained-editor' },
    {
      origin: 'http://localhost:3000',
      literals: probeLiterals('restored-lifecycle'),
      out: os.tmpdir(),
      record: (type, data) => events.push({ type, data }),
      elapsed: () => 0,
      context: () => ({ generation: 1, trial: 2 }),
      chunks: [],
      pendingBodies,
    },
  );
  const url = 'http://localhost:3000/_next/a.js';
  cdp.emit('Network.responseReceived', { requestId: 'r', type: 'Script', response: { url } });
  cdp.emit('Network.loadingFinished', { requestId: 'r' });
  await Promise.all([...pendingBodies]);
  assert.deepEqual(events, [
    {
      type: 'chunk-body-error',
      data: { requestId: 'r', message: 'No resource with given identifier found' },
    },
  ]);
});
