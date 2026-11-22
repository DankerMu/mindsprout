import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { observeNavigation } from './native-hmr-observation.mjs';

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

test('redirect responses stay with preceding hops and excluded replacements terminate attribution', async () => {
  const cdp = new EventEmitter();
  cdp.send = async () => ({ metrics: [] });
  const diagnostics = [];
  const observation = observeNavigation({ cdp, label: 'setup' }, () => undefined, {
    origin: 'http://localhost:3000',
    clock: () => ({ elapsedMs: 120, epochMs: 1800000000120 }),
    sink: (data) => diagnostics.push(data),
  });
  await observation.begin();
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'private-chain',
    type: 'Fetch',
    request: { method: 'PUT', url: 'http://localhost:3000/api/maps/private-id' },
    timestamp: 10,
  });
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'private-chain',
    type: 'Fetch',
    request: { method: 'GET', url: 'http://localhost:3000/api/maps/private-id' },
    timestamp: 11,
    redirectResponse: { status: 303 },
  });
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'private-chain',
    type: 'Fetch',
    request: { method: 'GET', url: 'https://foreign.invalid/api/maps/private-id' },
    timestamp: 12,
    redirectResponse: { status: 307 },
  });
  cdp.emit('Network.responseReceived', {
    requestId: 'private-chain',
    timestamp: 12.1,
    response: { status: 418 },
  });
  cdp.emit('Network.dataReceived', {
    requestId: 'private-chain',
    timestamp: 12.2,
    dataLength: 999,
    encodedDataLength: 999,
  });
  cdp.emit('Network.loadingFinished', {
    requestId: 'private-chain',
    timestamp: 12.3,
    encodedDataLength: 999,
  });
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'private-chain',
    type: 'Fetch',
    request: { method: 'GET', url: 'http://localhost:3000/api/maps/private-id' },
    timestamp: 13,
    redirectResponse: { status: 302 },
  });
  await observation.end();
  assert.deepEqual(
    diagnostics
      .flatMap((entry) => entry.requests)
      .map((entry) => ({
        ordinal: entry.ordinal,
        requestClass: entry.requestClass,
        method: entry.method,
        responseStatus: entry.responseStatus,
        redirectTimestampSeconds: entry.redirectTimestampSeconds,
        completion: entry.completion,
        dataLength: entry.dataLength,
      })),
    [
      {
        ordinal: 1,
        requestClass: 'map-put',
        method: 'PUT',
        responseStatus: 303,
        redirectTimestampSeconds: 11,
        completion: 'redirected',
        dataLength: 0,
      },
      {
        ordinal: 2,
        requestClass: 'map-get',
        method: 'GET',
        responseStatus: 307,
        redirectTimestampSeconds: 12,
        completion: 'redirected',
        dataLength: 0,
      },
      {
        ordinal: 3,
        requestClass: 'redirect-out-of-scope',
        method: 'GET',
        responseStatus: undefined,
        redirectTimestampSeconds: undefined,
        completion: 'out-of-scope',
        dataLength: 0,
      },
    ],
  );
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-|foreign|localhost/);
});

test('hop 65 closes retained redirect attribution without charging standalone excluded requests', async () => {
  const cdp = new EventEmitter();
  cdp.send = async () => ({ metrics: [] });
  const diagnostics = [];
  const observation = observeNavigation({ cdp, label: 'setup' }, () => undefined, {
    origin: 'http://localhost:3000',
    clock: () => ({ elapsedMs: 120, epochMs: 1800000000120 }),
    sink: (data) => diagnostics.push(data),
  });
  await observation.begin();
  for (let index = 0; index < 70; index++) {
    for (const request of [
      { method: 'GET', url: 'https://foreign.invalid/api/maps/private-id' },
      { method: 'POST', url: 'http://localhost:3000/api/maps/private-id' },
    ]) {
      cdp.emit('Network.requestWillBeSent', {
        requestId: `ignored-${index}-${request.method}`,
        type: 'Fetch',
        request,
        timestamp: 1,
      });
    }
  }
  for (let hop = 1; hop <= 65; hop++) {
    cdp.emit('Network.requestWillBeSent', {
      requestId: 'private-chain',
      type: 'Fetch',
      request: { method: 'PUT', url: 'http://localhost:3000/api/maps/private-id' },
      timestamp: 10 + hop,
      ...(hop > 1 ? { redirectResponse: { status: 307 } } : {}),
    });
  }
  cdp.emit('Network.responseReceived', {
    requestId: 'private-chain',
    timestamp: 75.1,
    response: { status: 418 },
  });
  cdp.emit('Network.dataReceived', {
    requestId: 'private-chain',
    timestamp: 75.2,
    dataLength: 999,
    encodedDataLength: 999,
  });
  cdp.emit('Network.loadingFinished', {
    requestId: 'private-chain',
    timestamp: 75.3,
    encodedDataLength: 999,
  });
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'private-chain',
    type: 'Fetch',
    request: { method: 'PUT', url: 'http://localhost:3000/api/maps/private-id' },
    timestamp: 76,
    redirectResponse: { status: 302 },
  });
  await observation.end();
  const [snapshot] = diagnostics;
  assert.equal(snapshot.requests.length, 64);
  assert.equal(snapshot.requests[0].ordinal, 1);
  const last = snapshot.requests[63];
  assert.deepEqual(
    {
      ordinal: last.ordinal,
      responseStatus: last.responseStatus,
      redirectTimestampSeconds: last.redirectTimestampSeconds,
      completion: last.completion,
      dataLength: last.dataLength,
      firstDataTimestampSeconds: last.firstDataTimestampSeconds,
    },
    {
      ordinal: 64,
      responseStatus: 307,
      redirectTimestampSeconds: 75,
      completion: 'redirected',
      dataLength: 0,
      firstDataTimestampSeconds: undefined,
    },
  );
  assert.equal(snapshot.omittedRequests, 1);
  assert.equal(snapshot.status, 'partial');
  assert.deepEqual(snapshot.codes, ['request-limit']);
});
