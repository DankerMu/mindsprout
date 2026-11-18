import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { deadline } from './native-hmr-support.mjs';
import { bracket, finiteOrNull, limits } from './native-hmr-profile-projection.mjs';
import { createReadinessSampler } from './native-hmr-readiness-sampler.mjs';

function diagnosticGetClass(url, type) {
  if (type === 'Script') return 'script';
  if (/^\/maps\/[^/]+$/.test(url.pathname) && url.searchParams.has('_rsc')) return 'editor-rsc';
  return undefined;
}

function diagnosticRequestMethod(request) {
  return ['PUT', 'GET'].includes(request?.method) ? request.method : 'unavailable';
}

function diagnosticRequestClass(request, type, origin) {
  if (diagnosticRequestMethod(request) === 'unavailable') return undefined;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return undefined;
  if (/^\/api\/maps\/[^/]+$/.test(url.pathname))
    return request.method === 'PUT' ? 'map-put' : 'map-get';
  if (request.method !== 'GET') return undefined;
  return diagnosticGetClass(url, type);
}

function originalClock(input) {
  const value = typeof input === 'function' ? input() : input;
  return bracket({ epochMs: value.at, elapsedMs: value.ms });
}

function createNavigationDiagnostic(state, options) {
  if (!options) return undefined;
  const requests = [];
  const pending = new Map();
  let omittedRequests = 0;
  let phase = 'armed';
  const attempt = {};
  const problems = new Set();
  let finalization;
  let claimed = false;
  const receipt = () => {
    const clock = options.clock();
    return {
      elapsedMs: finiteOrNull(clock.elapsedMs),
      epochMs: finiteOrNull(clock.epochMs),
      phase,
    };
  };
  const sampler = options.claim ? createReadinessSampler(state, options, receipt) : undefined;
  function redirect(data) {
    const previous = pending.get(data.requestId);
    if (!previous || !data.redirectResponse) return false;
    previous.responseStatus = finiteOrNull(data.redirectResponse.status);
    previous.redirectTimestampSeconds = finiteOrNull(data.timestamp);
    previous.redirectReceipt = receipt();
    previous.completion = 'redirected';
    return true;
  }
  function publish() {
    options.sink({
      ...attempt,
      ...sampler?.snapshot(),
      requests,
      omittedRequests,
      status: problems.size ? 'partial' : 'complete',
      codes: [...problems],
    });
  }
  function finalize(code) {
    if (phase === 'finalized') return finalization;
    if (code === 'page-closed') code = phase === 'armed' ? 'cdp-disconnected' : undefined;
    if (code) problems.add(code);
    if (omittedRequests) problems.add('request-limit');
    phase = 'finalized';
    pending.clear();
    const stopped = sampler?.stop(code);
    if (stopped) finalization = stopped.then(publish);
    else publish();
    return finalization;
  }
  function start(value) {
    if (phase !== 'armed') return;
    const start = originalClock(value);
    attempt.budget = {
      start,
      deadline: {
        epochMs: finiteOrNull(start.epochMs + 5000),
        elapsedMs: finiteOrNull(start.elapsedMs + 5000),
      },
    };
    phase = 'observing';
  }
  const acceptsRequest = (id) =>
    ['observing', 'failed-tail'].includes(phase) && pending.get(id) !== null;
  return {
    start,
    arm() {
      if (claimed || phase !== 'armed') return;
      claimed = true;
      if (options.claim && !options.claim(finalize)) phase = 'finalized';
    },
    async begin() {
      if (phase !== 'armed') return;
      if (!options.claim) phase = 'observing';
      await sampler?.begin();
    },
    actionSettled(status, value) {
      if (phase !== 'observing' || attempt.action) return;
      attempt.action = {
        status: status === 'fulfilled' ? 'fulfilled' : 'rejected',
        at: originalClock(value),
      };
    },
    outcome(status, value) {
      if (phase !== 'observing' || attempt.outcome) return;
      attempt.outcome = {
        status: ['ready', 'action-failed', 'readiness-failed'].includes(status)
          ? status
          : 'unavailable',
        at: originalClock(value),
      };
      if (status === 'ready') finalize();
      else phase = 'failed-tail';
    },
    request(data) {
      if (!acceptsRequest(data.requestId)) return;
      const redirected = redirect(data);
      const requestClass = diagnosticRequestClass(data.request, data.type, options.origin);
      if (!requestClass && !redirected) return;
      if (requests.length >= limits.createRequests) {
        omittedRequests = Math.min(Number.MAX_SAFE_INTEGER, omittedRequests + 1);
        if (pending.has(data.requestId)) pending.set(data.requestId, null);
        return;
      }
      const row = {
        ordinal: requests.length + 1,
        requestClass: requestClass ?? 'redirect-out-of-scope',
        method: diagnosticRequestMethod(data.request),
        requestTimestampSeconds: finiteOrNull(data.timestamp),
        requestReceipt: receipt(),
        packets: 0,
        dataLength: 0,
        encodedDataLength: 0,
      };
      requests.push(row);
      if (!requestClass) row.completion = 'out-of-scope';
      pending.set(data.requestId, requestClass ? row : null);
    },
    response(data) {
      const row = pending.get(data.requestId);
      if (!row) return;
      row.responseTimestampSeconds = finiteOrNull(data.timestamp);
      row.responseStatus = finiteOrNull(data.response.status);
      row.responseReceipt = receipt();
    },
    data(data) {
      const row = pending.get(data.requestId);
      if (!row) return;
      row.firstDataTimestampSeconds ??= finiteOrNull(data.timestamp);
      row.lastDataTimestampSeconds = finiteOrNull(data.timestamp);
      row.packets++;
      row.dataLength = finiteOrNull(row.dataLength + finiteOrNull(data.dataLength));
      row.encodedDataLength = finiteOrNull(
        row.encodedDataLength + finiteOrNull(data.encodedDataLength),
      );
    },
    completion(data, event) {
      const row = pending.get(data.requestId);
      if (!row) return;
      row.completionTimestampSeconds = finiteOrNull(data.timestamp);
      row.completion = event === 'Network.loadingFinished' ? 'finished' : 'failed';
      row.completionReceipt = receipt();
      row.completionEncodedDataLength = finiteOrNull(data.encodedDataLength);
      pending.delete(data.requestId);
    },
    end() {
      if (!options.claim) return finalize();
      return finalization;
    },
  };
}

export function observeNavigation(state, record, diagnosticOptions) {
  let active = false;
  let omittedRequests = 0;
  const requests = new Map();
  const documents = new Map();
  const { cdp, label } = state;
  const diagnostic = createNavigationDiagnostic(state, diagnosticOptions);
  cdp.on('Network.requestWillBeSent', (data) => {
    if (data.type === 'Document') {
      documents.set(data.requestId, {
        requestId: data.requestId,
        url: data.request.url,
        type: data.type,
        requestTimestamp: data.timestamp,
        loaderId: data.loaderId,
      });
    }
    diagnostic?.request(data);
    if (!active) return;
    let url;
    try {
      url = new URL(data.request.url);
    } catch {
      return;
    }
    if (data.type !== 'Script' && !url.searchParams.has('_rsc')) return;
    if (requests.size >= 256) {
      omittedRequests++;
      return;
    }
    requests.set(data.requestId, {
      requestId: data.requestId,
      url: data.request.url,
      type: data.type,
      requestTimestamp: data.timestamp,
      loaderId: data.loaderId,
      packets: 0,
      dataLength: 0,
      encodedDataLength: 0,
    });
  });
  cdp.on('Network.responseReceived', (data) => {
    diagnostic?.response(data);
    const document = documents.get(data.requestId);
    if (document) {
      record(
        'public-document-response',
        {
          ...document,
          timestamp: data.timestamp,
          status: data.response.status,
          timing: data.response.timing,
          protocol: data.response.protocol,
          fromDiskCache: data.response.fromDiskCache,
        },
        label,
      );
    }
    const request = requests.get(data.requestId);
    if (!request) return;
    request.response = {
      timestamp: data.timestamp,
      status: data.response.status,
      timing: data.response.timing,
      protocol: data.response.protocol,
      fromDiskCache: data.response.fromDiskCache,
    };
  });
  cdp.on('Network.dataReceived', (data) => {
    diagnostic?.data(data);
    const request = requests.get(data.requestId);
    if (!request) return;
    request.firstDataTimestamp ??= data.timestamp;
    request.lastDataTimestamp = data.timestamp;
    request.packets++;
    request.dataLength += data.dataLength;
    request.encodedDataLength += data.encodedDataLength;
  });
  for (const event of ['Network.loadingFinished', 'Network.loadingFailed']) {
    cdp.on(event, (data) => {
      diagnostic?.completion(data, event);
      const document = documents.get(data.requestId);
      if (document) {
        documents.delete(data.requestId);
        record(
          'public-document-completion',
          {
            ...document,
            event,
            timestamp: data.timestamp,
            encodedDataLength: data.encodedDataLength,
            errorText: data.errorText,
          },
          label,
        );
      }
      const request = requests.get(data.requestId);
      if (request) request.completion = { event, ...data };
    });
  }
  const snapshot = async (stage) => {
    try {
      const metrics = await deadline(
        cdp.send('Performance.getMetrics'),
        1000,
        'Performance snapshot',
      );
      record('public-create-performance', { stage, ...metrics }, label);
    } catch (error) {
      record('public-create-observation-error', { stage, message: error.message }, label);
    }
  };
  return {
    start: (value) => diagnostic?.start(value),
    actionSettled: (status, value) => diagnostic?.actionSettled(status, value),
    outcome: (status, value) => diagnostic?.outcome(status, value),
    async begin() {
      diagnostic?.arm();
      await snapshot('before');
      if (diagnostic) await diagnostic.begin();
      active = true;
    },
    async end() {
      active = false;
      if (diagnostic) await diagnostic.end();
      record('public-create-outcome', {}, label);
      await snapshot('after');
      record('public-create-network', { requests: [...requests.values()], omittedRequests }, label);
      requests.clear();
    },
  };
}

function failedEditorVisit(navigation, actionOutcome, now) {
  navigation?.actionSettled(actionOutcome, now);
  navigation?.outcome(actionOutcome === 'rejected' ? 'action-failed' : 'readiness-failed', now);
}

export async function observeEditorVisit(state, action, expectedPath, { guard, readiness, now }) {
  const navigation = expectedPath === undefined ? state.navigationObservation : undefined;
  if (navigation) await navigation.begin();
  let actionOutcome = 'rejected';
  try {
    const start = now();
    navigation?.start(start);
    await guard(action());
    actionOutcome = 'fulfilled';
    navigation?.actionSettled(actionOutcome, now);
    await guard(readiness(state, start, 'public-navigation', expectedPath));
    navigation?.outcome('ready', now);
    assert.equal(
      await state.page.getByText('保存失败', { exact: true }).count(),
      0,
      'Map must be persisted',
    );
  } catch (error) {
    failedEditorVisit(navigation, actionOutcome, now);
    throw error;
  } finally {
    if (navigation) await navigation.end();
  }
}

const probeValues = {
  'source-change': ['Native HMR A', 'Native HMR B'],
  'restored-lifecycle': ['probe79-A', 'probe79-B', 'probe79-C', 'probe79-D'],
};

export function probeLiterals(mode) {
  const literals = probeValues[mode];
  assert(literals, `Unknown browser qualification mode: ${mode}`);
  return literals;
}

export function bodyLiterals(bytes, literals) {
  const text = bytes.toString('utf8');
  return literals.filter((value) => text.includes(value));
}

export function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name);
  return key === undefined ? null : headers[key];
}

export function scriptProvenance(request, response, finished) {
  return {
    servedFromCache: Boolean(request.servedFromCache),
    fromDiskCache: Boolean(response.fromDiskCache),
    fromPrefetchCache: Boolean(response.fromPrefetchCache),
    fromServiceWorker: Boolean(response.fromServiceWorker),
    status: response.status,
    cacheControl: headerValue(response.headers, 'cache-control'),
    etag: headerValue(response.headers, 'etag'),
    lastModified: headerValue(response.headers, 'last-modified'),
    encodedDataLength: finished.encodedDataLength,
    initiator: request.initiator
      ? {
          type: request.initiator.type,
          url: request.initiator.url ?? request.initiator.stack?.callFrames?.[0]?.url ?? null,
        }
      : null,
  };
}

export function probeValue(texts, [valueA, valueB]) {
  const found = new Set(
    texts.map((text) => (text === valueA ? 'A' : text === valueB ? 'B' : 'other')),
  );
  if (found.size === 0) return 'absent';
  return found.size === 1 ? [...found][0] : 'mixed';
}

const ownScript = (origin, type, url) => type === 'Script' && url.startsWith(origin + '/');

function saveBody(state, options, script, finished) {
  const { cdp, label } = state;
  const { out, record, chunks, pendingBodies, literals } = options;
  const pending = cdp
    .send('Network.getResponseBody', { requestId: finished.requestId })
    .then((body) => {
      const bytes = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8');
      const entry = {
        ...script.context,
        page: label,
        requestId: finished.requestId,
        url: script.url,
        requestMs: script.request.requestMs ?? null,
        responseMs: script.responseMs,
        finishMs: script.finishMs,
        requestTimestamp: script.request.timestamp ?? null,
        responseTimestamp: script.responseTimestamp,
        finishTimestamp: finished.timestamp,
        loaderId: script.request.loaderId ?? null,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        literals: bodyLiterals(bytes, literals),
        provenance: scriptProvenance(script.request, script.response, finished),
      };
      fs.writeFileSync(path.join(out, `chunk-${entry.sha256}.js`), bytes);
      chunks.push(entry);
      record('chunk-body', entry, label);
    })
    .catch((error) =>
      record('chunk-body-error', { requestId: finished.requestId, message: error.message }, label),
    )
    .finally(() => pendingBodies.delete(pending));
  pendingBodies.add(pending);
}

// Passive: response bodies and cache provenance of same-origin scripts, read after load.
export function observeScripts(state, options) {
  const { origin, elapsed, context } = options;
  const requests = new Map();
  const scripts = new Map();
  state.cdp.on('Network.requestWillBeSent', (data) => {
    if (!ownScript(origin, data.type, data.request.url)) return;
    requests.set(data.requestId, {
      requestMs: elapsed(),
      timestamp: data.timestamp,
      loaderId: data.loaderId,
      initiator: data.initiator,
      servedFromCache: false,
    });
  });
  state.cdp.on('Network.requestServedFromCache', ({ requestId }) => {
    const request = requests.get(requestId);
    if (request) request.servedFromCache = true;
  });
  state.cdp.on('Network.responseReceived', (data) => {
    if (!ownScript(origin, data.type, data.response.url)) return;
    scripts.set(data.requestId, {
      url: data.response.url,
      context: context(),
      response: data.response,
      responseMs: elapsed(),
      responseTimestamp: data.timestamp,
    });
  });
  state.cdp.on('Network.loadingFinished', (data) => {
    const script = scripts.get(data.requestId);
    if (!script) return;
    scripts.delete(data.requestId);
    script.request = requests.get(data.requestId) || {};
    requests.delete(data.requestId);
    script.finishMs = elapsed();
    saveBody(state, options, script, data);
  });
}

// Passive DOM read of the probe; never part of any asserted wait.
export async function probeSnapshot(state, probe, values, stage, elapsed) {
  const ms = elapsed();
  const [frame, dom] = await Promise.all([
    deadline(state.cdp.send('Page.getFrameTree'), 1000, 'Probe frame'),
    deadline(
      state.page.evaluate(
        (id) => ({
          texts: [...globalThis.document.querySelectorAll(`[data-testid="${id}"]`)].map(
            (node) => node.textContent,
          ),
          scripts: [...globalThis.document.scripts].map((script) => script.src).filter(Boolean),
        }),
        probe,
      ),
      1000,
      'Probe DOM',
    ),
  ]);
  return {
    stage,
    ms,
    url: state.page.url(),
    loaderId: frame.frameTree.frame.loaderId,
    value: probeValue(dom.texts, values),
    texts: dom.texts,
    scripts: dom.scripts,
  };
}

function cacheFiles(root, directory = root) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return cacheFiles(root, full);
      const bytes = fs.readFileSync(full);
      return [
        {
          path: path.relative(root, full),
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      ];
    });
}

export function cacheIdentity(directory) {
  if (!fs.existsSync(directory)) return { absent: true, files: [], sha256: null };
  const files = cacheFiles(directory);
  return {
    absent: false,
    files,
    bytes: files.reduce((sum, item) => sum + item.size, 0),
    sha256: createHash('sha256')
      .update(files.map((item) => `${item.sha256} ${item.size} ${item.path}\n`).join(''))
      .digest('hex'),
  };
}

// Passive probe timeline: a snapshot at readiness, then at intervals until stopped.
export function probeTimeline(state, { probe, values, elapsed, record, intervalMs = 500 }) {
  const samples = [];
  const stopped = new AbortController();
  const take = async (stage) => {
    try {
      const snapshot = await probeSnapshot(state, probe, values, stage, elapsed);
      samples.push(snapshot);
      record('probe-snapshot', snapshot, state.label);
    } catch (error) {
      record('probe-snapshot-error', { stage, message: error.message }, state.label);
    }
  };
  // stop() aborts the interval sleep; the AbortError is the intended wake-up, not a failure.
  const pause = () =>
    sleep(intervalMs, true, { signal: stopped.signal }).catch(() => stopped.signal.aborted);
  let following = Promise.resolve();
  const finish = async () => {
    stopped.abort();
    await following;
  };
  return {
    samples,
    stop: () => stopped.abort(),
    finish,
    follow(ready, endMs) {
      following = (async () => {
        if (
          !(await ready.then(
            () => true,
            () => false,
          ))
        )
          return;
        await take('ready');
        while (!stopped.signal.aborted && elapsed() < endMs) {
          await pause();
          if (!stopped.signal.aborted) await take('sample');
        }
      })();
    },
    // Failure evidence: final probe state plus a target screenshot/DOM; capture errors are recorded.
    async failure(capture) {
      await finish();
      await take('failure');
      await capture().catch((error) =>
        record('target-capture-error', { message: error.message }, state.label),
      );
    },
  };
}

export function saveCacheIdentity(directory, filename) {
  const { files, ...identity } = cacheIdentity(directory);
  fs.writeFileSync(filename, JSON.stringify({ ...identity, files }, null, 2) + '\n');
  return { ...identity, files: files.length };
}
