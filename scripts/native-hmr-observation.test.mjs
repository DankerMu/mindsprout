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
  saveCacheIdentity,
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
      { path: 'a.txt', type: 'file', size: 1, sha256: sha256('a') },
      { path: path.join('b', 'z.bin'), type: 'file', size: 2, sha256: sha256('zz') },
    ];
    assert.deepEqual(identity, {
      absent: false,
      files,
      bytes: 3,
      sha256: sha256(
        `file ${sha256('a')} 1 a.txt\nfile ${sha256('zz')} 2 ${path.join('b', 'z.bin')}\n`,
      ),
    });
    fs.writeFileSync(path.join(root, 'cache/a.txt'), 'b');
    assert.notEqual(cacheIdentity(path.join(root, 'cache')).sha256, identity.sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('warm cache identity includes files and a terminal directory link, not its target', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-warm-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = path.join(root, 'cache');
  const sentinel = path.join(root, 'external', 'sentinel.txt');
  fs.mkdirSync(path.join(cache, 'b'), { recursive: true });
  fs.writeFileSync(path.join(cache, 'a.txt'), 'a');
  fs.writeFileSync(path.join(cache, 'b', 'z.bin'), 'zz');
  fs.mkdirSync(path.dirname(sentinel));
  fs.writeFileSync(sentinel, 'outside the cache');
  fs.symlinkSync('../external', path.join(cache, 'modules'), 'dir');

  const identity = cacheIdentity(cache);
  assert.deepEqual(identity.files, [
    { path: 'a.txt', type: 'file', size: 1, sha256: sha256('a') },
    { path: path.join('b', 'z.bin'), type: 'file', size: 2, sha256: sha256('zz') },
    { path: 'modules', type: 'symlink', size: 11, sha256: sha256('../external') },
  ]);
  assert.equal(identity.absent, false);
  assert.equal(identity.bytes, 14);
  fs.writeFileSync(sentinel, 'different external contents');
  assert.deepEqual(cacheIdentity(cache), identity);
});

test('saveCacheIdentity persists warm-cache entries without exposing link text', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-cache-persistence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = path.join(root, 'cache');
  const output = path.join(root, 'cache-identity.json');
  fs.mkdirSync(cache);
  fs.mkdirSync(path.join(root, 'external'));
  fs.writeFileSync(path.join(root, 'external', 'sentinel.txt'), 'outside the cache');
  fs.writeFileSync(path.join(cache, 'a.txt'), 'a');
  fs.symlinkSync('../external', path.join(cache, 'modules'), 'dir');

  const summary = {
    absent: false,
    bytes: 12,
    sha256: 'a9a9c779556119b2cff2853cdbf9af1853dda1be4b795f50458284a75ae51268',
  };
  assert.deepEqual(saveCacheIdentity(cache, output), { ...summary, files: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), {
    ...summary,
    files: [
      { path: 'a.txt', type: 'file', size: 1, sha256: sha256('a') },
      { path: 'modules', type: 'symlink', size: 11, sha256: sha256('../external') },
    ],
  });
});

test('cache identity distinguishes a file and link with the same path and bytes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-cache-entry-type-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = path.join(root, 'cache');
  const entry = path.join(cache, 'entry');
  const linkText = '../peer.txt';
  fs.mkdirSync(cache);
  fs.writeFileSync(path.join(root, 'peer.txt'), 'different target contents');
  fs.writeFileSync(entry, linkText);
  const file = cacheIdentity(cache);
  fs.unlinkSync(entry);
  fs.symlinkSync(linkText, entry);
  const link = cacheIdentity(cache);

  assert.notEqual(file.sha256, link.sha256);
  const fields = {
    path: 'entry',
    size: 11,
    sha256: '76b0e9e2cb4364014e528256da58b317a36c632c1be90aed68648919c44c038f',
  };
  assert.deepEqual(file.files, [{ ...fields, type: 'file' }]);
  assert.deepEqual(link.files, [{ ...fields, type: 'symlink' }]);
});

test('changing only the link text changes cache identity for the same target', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-cache-link-text-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = path.join(root, 'cache');
  const link = path.join(cache, 'link');
  fs.mkdirSync(cache);
  fs.writeFileSync(path.join(root, 'target.txt'), 'unchanged');
  fs.symlinkSync('../target.txt', link);
  const before = cacheIdentity(cache);
  fs.unlinkSync(link);
  fs.symlinkSync('.././target.txt', link);
  assert.notEqual(cacheIdentity(cache).sha256, before.sha256);
});

test('cache identity records a dangling link using its link text byte length', (t) => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-dangling-cache-link-'));
  t.after(() => fs.rmSync(cache, { recursive: true, force: true }));
  fs.symlinkSync('missing-缺失', path.join(cache, 'dangling'));
  assert.deepEqual(cacheIdentity(cache).files, [
    { path: 'dangling', type: 'symlink', size: 14, sha256: sha256('missing-缺失') },
  ]);
});

test('cache identity stops at a link to an ancestor directory', (t) => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-cache-ancestor-link-'));
  t.after(() => fs.rmSync(cache, { recursive: true, force: true }));
  const nested = path.join(cache, 'nested');
  fs.mkdirSync(nested);
  fs.symlinkSync('..', path.join(nested, 'ancestor'), 'dir');
  assert.deepEqual(cacheIdentity(cache).files, [
    { path: path.join('nested', 'ancestor'), type: 'symlink', size: 2, sha256: sha256('..') },
  ]);
});

test('cache identity keeps both aliases without duplicating an external directory', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-cache-link-aliases-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = path.join(root, 'cache');
  fs.mkdirSync(cache);
  fs.mkdirSync(path.join(root, 'external'));
  fs.writeFileSync(path.join(root, 'external', 'sentinel.txt'), 'outside the cache');
  fs.symlinkSync('../external', path.join(cache, 'z-link'), 'dir');
  fs.symlinkSync('../external', path.join(cache, 'a-link'), 'dir');
  const entry = { type: 'symlink', size: 11, sha256: sha256('../external') };
  const identity = cacheIdentity(cache);
  assert.deepEqual(identity.files, [
    { path: 'a-link', ...entry },
    { path: 'z-link', ...entry },
  ]);
  assert.equal(identity.bytes, 22);
});

function assertRootIdentity(cache, output, identity) {
  const { files, ...summary } = identity;
  assert.deepEqual(
    {
      direct: cacheIdentity(cache),
      saved: saveCacheIdentity(cache, output),
      persisted: JSON.parse(fs.readFileSync(output, 'utf8')),
    },
    { direct: identity, saved: { ...summary, files: files.length }, persisted: identity },
  );
}

test('direct and persisted cache identity record a directory root link without following it', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-cache-root-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = path.join(root, 'cache');
  const external = path.join(root, 'external');
  const sentinel = path.join(external, 'sentinel.txt');
  const output = path.join(root, 'identity.json');
  fs.mkdirSync(external);
  fs.writeFileSync(sentinel, 'outside the cache');
  fs.symlinkSync('external', cache, 'dir');

  const identity = {
    absent: false,
    files: [{ path: '.', type: 'symlink', size: 8, sha256: sha256('external') }],
    bytes: 8,
    sha256: '62359607e4ece01e5ec68019a2c8c604d1048364e0898ece19fa49b790c8258c',
  };
  assertRootIdentity(cache, output, identity);
  const directory = cacheIdentity(external);
  assert.deepEqual(directory.files, [
    { path: 'sentinel.txt', type: 'file', size: 17, sha256: sha256('outside the cache') },
  ]);
  assert.notEqual(directory.sha256, identity.sha256);

  fs.writeFileSync(sentinel, 'different external contents');
  assertRootIdentity(cache, output, identity);
});

test('a trailing separator does not turn a cache root link into its target directory', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-cache-root-separator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = path.join(root, 'cache');
  const output = path.join(root, 'identity.json');
  fs.mkdirSync(path.join(root, 'external'));
  fs.symlinkSync('external', cache, 'dir');

  assertRootIdentity(cache + path.sep, output, {
    absent: false,
    files: [{ path: '.', type: 'symlink', size: 8, sha256: sha256('external') }],
    bytes: 8,
    sha256: '62359607e4ece01e5ec68019a2c8c604d1048364e0898ece19fa49b790c8258c',
  });
});

test('direct and persisted cache identity change when only root link text changes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-cache-root-link-text-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = path.join(root, 'cache');
  const output = path.join(root, 'identity.json');
  fs.mkdirSync(path.join(root, 'external'));
  fs.symlinkSync('external', cache, 'dir');
  const fingerprints = () => ({
    direct: cacheIdentity(cache).sha256,
    persisted: saveCacheIdentity(cache, output).sha256,
  });
  const before = fingerprints();

  fs.unlinkSync(cache);
  fs.symlinkSync('./external', cache, 'dir');
  const after = fingerprints();
  assert.notEqual(after.direct, before.direct);
  assert.notEqual(after.persisted, before.persisted);
});

const unresolvedRootLinks = [
  {
    kind: 'dangling',
    text: 'missing-缺失',
    size: 14,
    digest: 'ffa944bf5a88c51cb8b69c5246d837c4e40ef5d27b850588c7a67653578d309d',
  },
  {
    kind: 'self-cyclic',
    text: 'cache',
    size: 5,
    digest: '00325bd9100697ed805dfb19092bbd5ec3d92475323f9bc368c576d028fe354c',
  },
];

for (const { kind, text, size, digest } of unresolvedRootLinks) {
  test(`direct and persisted cache identity distinguish a ${kind} root link from absence`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-unresolved-cache-root-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const cache = path.join(root, 'cache');
    const output = path.join(root, 'identity.json');
    assertRootIdentity(cache, output, { absent: true, files: [], sha256: null });

    fs.symlinkSync(text, cache);
    assertRootIdentity(cache, output, {
      absent: false,
      files: [{ path: '.', type: 'symlink', size, sha256: sha256(text) }],
      bytes: size,
      sha256: digest,
    });
  });
}

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
