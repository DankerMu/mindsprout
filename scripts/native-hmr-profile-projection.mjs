export const limits = {
  file: 16 * 1024 * 1024,
  bytes: 64 * 1024 * 1024,
  files: 15,
  nodes: 50000,
  samples: 250000,
  buckets: 300,
  records: 20000,
  spans: 2000,
  generations: 5,
  intervals: 8,
  summary: 1024 * 1024,
};
export const modes = ['restored-lifecycle', 'source-change'];
export const pages = ['retained-editor', 'first-navigation', 'fresh-editor'];
export const complete = () => ({ status: 'complete', codes: [] });
export const partial = (code) => ({ status: 'partial', codes: [code] });
export const disabled = () => ({ status: 'disabled', codes: [] });
export const finite = (value) =>
  Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
export const integer = (value) => Number.isSafeInteger(value) && value >= 0;
export const matched = (value, pattern) =>
  typeof value === 'string' && pattern.test(value) ? value : null;
export const boundedInteger = (value, maximum) =>
  integer(value) && value <= maximum ? value : null;
export const finiteOrNull = (value) => (finite(value) ? value : null);

function cpuShapeCode(profile) {
  if (!profile) return 'malformed-profile';
  if (!['nodes', 'samples', 'timeDeltas'].every((key) => Array.isArray(profile[key])))
    return 'malformed-profile';
  if (profile.nodes.length > limits.nodes) return 'node-limit';
  if (profile.samples.length > limits.samples) return 'sample-limit';
  if (!profile.samples.length || !profile.nodes.length) return 'empty-profile';
  return null;
}

function cpuClockCode(profile) {
  if (!finite(profile.startTime) || !finite(profile.endTime)) return 'malformed-profile';
  if (profile.endTime < profile.startTime) return 'malformed-profile';
  if (profile.samples.length !== profile.timeDeltas.length) return 'malformed-profile';
  if (profile.endTime - profile.startTime > limits.buckets * 1000000) return 'bucket-limit';
  return null;
}

function validCpuNode(node) {
  if (!node || !integer(node.id) || !node.callFrame) return false;
  return typeof node.callFrame.functionName === 'string' && typeof node.callFrame.url === 'string';
}

function cpuCategory(frame) {
  if (frame.functionName === '(garbage collector)') return 'gc';
  if (frame.functionName === '(idle)') return 'idle';
  if (frame.url || (frame.scriptId && frame.scriptId !== '0')) return 'javascript';
  return 'other';
}

function cpuNodes(profile) {
  const nodes = new Map();
  for (const node of profile.nodes) {
    if (!validCpuNode(node) || nodes.has(node.id)) return null;
    nodes.set(node.id, cpuCategory(node.callFrame));
  }
  return nodes;
}

function cpuSamples(profile, nodes) {
  const categories = { javascript: 0, gc: 0, idle: 0, other: 0 };
  const counts = new Map();
  let elapsed = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const category = nodes.get(profile.samples[i]);
    const delta = profile.timeDeltas[i];
    // Signed V8 deltas preserve out-of-order samples; reconstructed positions must stay in range.
    if (!category || !Number.isFinite(delta)) return partial('malformed-profile');
    elapsed += delta;
    if (!finite(elapsed) || elapsed > profile.endTime - profile.startTime)
      return partial('malformed-profile');
    const second = Math.floor(elapsed / 1000000);
    if (second >= limits.buckets) return partial('bucket-limit');
    categories[category]++;
    counts.set(second, (counts.get(second) || 0) + 1);
  }
  return {
    ...complete(),
    categories,
    buckets: [...counts]
      .sort(([left], [right]) => left - right)
      .map(([second, samples]) => ({ second, samples })),
  };
}

function cpuClock(start, end) {
  return { origin: 'unspecified-monotonic', unit: 'microseconds', start, end };
}

export function projectCpuProfile(profile) {
  const code = cpuShapeCode(profile) || cpuClockCode(profile);
  if (code) return partial(code);
  const nodes = cpuNodes(profile);
  if (!nodes) return partial('malformed-profile');
  const sampled = cpuSamples(profile, nodes);
  if (sampled.status !== 'complete') return sampled;
  return {
    ...complete(),
    clock: cpuClock(profile.startTime, profile.endTime),
    samples: profile.samples.length,
    categories: sampled.categories,
    buckets: sampled.buckets,
  };
}

function routeValue(name, tags) {
  if (name === 'compile-path') return tags?.trigger;
  if (name === 'ensure-page') return tags?.inputPage;
  return tags?.page ?? tags?.url ?? tags?.path;
}

function routeClass(name, tags) {
  const value = routeValue(name, tags);
  if (typeof value !== 'string') return 'other';
  if (name === 'ensure-page') {
    if (value === '/page') return 'home';
    if (value === '/api/healthz/route') return 'health';
    return /^\/maps\/[^/?#]+\/page$/.test(value) ? 'persisted-map' : 'other';
  }
  if (value === '/') return 'home';
  if (value === '/api/healthz') return 'health';
  return /^\/maps\/[^/?#]+$/.test(value) ? 'persisted-map' : 'other';
}

function* traceBatches(text) {
  let offset = 0;
  while (offset < text.length) {
    const newline = text.indexOf('\n', offset);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(offset, end);
    offset = end + 1;
    if (line.trim()) yield JSON.parse(line);
  }
}

function appendTraceBatch(batch, spans) {
  for (const event of batch) {
    if (!event || typeof event !== 'object') return 'malformed-profile';
    if (!['compile-path', 'ensure-page', 'handle-request', 'render-path'].includes(event.name))
      continue;
    if (![event.startTime, event.timestamp, event.duration].every(finite))
      return 'malformed-profile';
    if (spans.length === limits.spans) return 'trace-span-limit';
    spans.push({
      name: event.name,
      route: routeClass(event.name, event.tags),
      startTimeEpochMs: event.startTime,
      timestampHrtimeUs: event.timestamp,
      durationUs: event.duration,
    });
  }
  return null;
}

export function projectNextTrace(text) {
  if (typeof text !== 'string' || !text.trim()) return partial('empty-profile');
  const spans = [];
  let count = 0;
  try {
    for (const batch of traceBatches(text)) {
      if (!Array.isArray(batch)) return partial('malformed-profile');
      count += batch.length;
      if (count > limits.records) return partial('trace-record-limit');
      const code = appendTraceBatch(batch, spans);
      if (code) return partial(code);
    }
  } catch {
    return partial('malformed-profile');
  }
  if (!spans.length) return partial('empty-profile');
  return { ...complete(), coverage: 'observed-only', spans };
}

export function provenance(input = {}) {
  return {
    workflowSha: matched(input.workflowSha, /^[a-f0-9]{40}$/),
    checkoutSha: matched(input.checkoutSha, /^[a-f0-9]{40}$/),
    prHeadSha: matched(input.prHeadSha, /^[a-f0-9]{40}$/),
    runId: matched(input.runId, /^\d{1,20}$/),
    runAttempt: matched(input.runAttempt, /^\d{1,6}$/),
    nodeVersion: matched(input.nodeVersion, /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/),
    platform: ['darwin', 'linux', 'win32'].includes(input.platform) ? input.platform : null,
    arch: ['arm64', 'x64'].includes(input.arch) ? input.arch : null,
    nativeTarget: [
      'darwin-arm64',
      'linux-x64-gnu',
      'aarch64-apple-darwin',
      'x86_64-unknown-linux-gnu',
    ].includes(input.nativeTarget)
      ? input.nativeTarget
      : null,
    nativeDigest: matched(input.nativeDigest, /^[a-f0-9]{64}$/),
    mode: modes.includes(input.mode) ? input.mode : null,
  };
}

export function bracket(value) {
  return { epochMs: finiteOrNull(value?.epochMs), elapsedMs: finiteOrNull(value?.elapsedMs) };
}

const codes = new Set([
  'cdp-timeout',
  'cdp-failed',
  'cdp-disconnected',
  'interrupted',
  'browser-suspended',
  'browser-interval-limit',
  'renderer-local-coverage',
  'malformed-profile',
  'empty-profile',
  'node-limit',
  'sample-limit',
  'bucket-limit',
]);

export function filteredCodes(value, fallback) {
  return Array.isArray(value) ? value.filter((code) => codes.has(code)).slice(0, 4) : fallback;
}

function copiedCategories(value) {
  const categories = {};
  for (const name of ['javascript', 'gc', 'idle', 'other']) {
    if (!integer(value?.[name])) return null;
    categories[name] = value[name];
  }
  return categories;
}

function validSummaryCpu(value) {
  if (!integer(value.samples) || value.samples > limits.samples) return false;
  if (!Array.isArray(value.buckets) || value.buckets.length > limits.buckets) return false;
  return finite(value.clock?.start) && finite(value.clock?.end);
}

function validCpuBucket(bucket) {
  return (
    integer(bucket.second) &&
    bucket.second < limits.buckets &&
    integer(bucket.samples) &&
    bucket.samples <= limits.samples
  );
}

function safeCpu(value) {
  if (value?.status !== 'complete') {
    return { status: 'partial', codes: filteredCodes(value?.codes, ['malformed-profile']) };
  }
  const categories = copiedCategories(value.categories);
  if (!categories || !validSummaryCpu(value)) return partial('malformed-profile');
  if (!value.buckets.every(validCpuBucket)) return partial('malformed-profile');
  return {
    ...complete(),
    clock: cpuClock(value.clock.start, value.clock.end),
    samples: value.samples,
    categories,
    buckets: value.buckets.map((bucket) => ({ second: bucket.second, samples: bucket.samples })),
  };
}

function safeTransitions(value) {
  const count = integer(value?.count) ? value.count : 0;
  return {
    count,
    first: count ? bracket(value.first) : null,
    last: count ? bracket(value.last) : null,
  };
}

function intervalCodes(value, count) {
  const selected = filteredCodes(value, []);
  if (count && !selected.includes('renderer-local-coverage')) {
    if (selected.length === 4) selected.pop();
    selected.push('renderer-local-coverage');
  }
  return selected;
}

export function safeGap(value) {
  if (!value || !finite(value.fromElapsedMs) || !finite(value.toElapsedMs)) return null;
  return {
    fromElapsedMs: value.fromElapsedMs,
    toElapsedMs: value.toElapsedMs,
    reason: 'browser-suspended',
  };
}

function intervalContext(value) {
  return {
    generation: boundedInteger(value.generation, limits.generations - 1),
    trial: boundedInteger(value.trial, 4),
    page: pages.includes(value.page) ? value.page : null,
  };
}

export function safeInterval(value) {
  const input = value ?? {};
  const cpu = safeCpu(input.cpu);
  const transitions = safeTransitions(input.documentTransitions);
  return {
    status:
      input.status === 'complete' && cpu.status === 'complete' && !transitions.count
        ? 'complete'
        : 'partial',
    codes: intervalCodes(input.codes, transitions.count),
    ...intervalContext(input),
    before: bracket(input.before),
    after: bracket(input.after),
    cpu,
    documentTransitions: transitions,
    gap: safeGap(input.gap),
  };
}
