import fs from 'node:fs';
import path from 'node:path';
import {
  limits,
  pages,
  complete,
  partial,
  disabled,
  integer,
  boundedInteger,
  finiteOrNull,
  projectCpuProfile,
  projectNextTrace,
  provenance,
  bracket,
  safeInterval,
  filteredCodes,
  safeGap,
  safePublicCreate,
  compactPublicCreate,
} from './native-hmr-profile-projection.mjs';

const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const cpuRoles = ['dev-main', 'dev-server'];
const profileLimitations = [
  'observed-trace-only',
  'cpu-samples-not-utilization',
  'clock-origins-not-correlated',
  'producer-and-cdp-allocation-unbounded',
];

function ownsDirectory(filename, expected) {
  try {
    const current = fs.lstatSync(filename);
    return Boolean(expected && current.isDirectory() && same(expected, current));
  } catch {
    return false;
  }
}

function cacheDirectoryCode(filename) {
  try {
    const entry = fs.lstatSync(filename, { throwIfNoEntry: false });
    return entry && !entry.isDirectory() ? 'unsafe-file' : null;
  } catch {
    return 'trace-isolation-failed';
  }
}

export function sourceCacheParentCode(repo) {
  return cacheDirectoryCode(path.join(repo, '.next'));
}

function sourceCacheCode(repo) {
  return sourceCacheParentCode(repo) ?? cacheDirectoryCode(path.join(repo, '.next', 'dev'));
}

function absent(filename) {
  try {
    fs.lstatSync(filename);
    return false;
  } catch (error) {
    return error.code === 'ENOENT';
  }
}

function inspectedFileCode(stat, budget) {
  if (!stat.isFile()) return 'unsafe-file';
  if (stat.size > limits.file) return 'file-byte-limit';
  if (budget.files >= limits.files) return 'file-count-limit';
  if (budget.bytes + stat.size > limits.bytes) return 'run-byte-limit';
  return null;
}

function openedFileCode(before, inspected) {
  if (!before.isFile() || !same(before, inspected)) return 'unsafe-file';
  if (before.size > limits.file) return 'file-byte-limit';
  return null;
}

function fillBuffer(fd, bytes) {
  let size = 0;
  while (size < bytes.length) {
    const count = fs.readSync(fd, bytes, size, bytes.length - size, null);
    if (!count) break;
    size += count;
  }
  return size;
}

function stableFile(before, after, current, size) {
  return (
    same(before, after) &&
    same(before, current) &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs &&
    size === before.size
  );
}

function readFileCode(before, fd, filename, size, budget) {
  const after = fs.fstatSync(fd);
  const current = fs.lstatSync(filename);
  if (!stableFile(before, after, current, size)) return 'unstable-file';
  if (size > limits.file) return 'file-byte-limit';
  if (budget.bytes > limits.bytes) return 'run-byte-limit';
  if (!size) return 'empty-profile';
  return null;
}

function fileErrorCode(error) {
  if (error.code === 'ENOENT') return 'missing-profile';
  if (error.code === 'ELOOP') return 'unsafe-file';
  return 'file-read-failed';
}

function closeDescriptor(fd) {
  if (fd === undefined) return;
  try {
    fs.closeSync(fd);
  } catch {
    // Descriptor closure must not escape the diagnostic boundary.
  }
}

export function readBounded(filename, budget) {
  let fd;
  try {
    const inspected = fs.lstatSync(filename);
    const inspectionCode = inspectedFileCode(inspected, budget);
    if (inspectionCode) return partial(inspectionCode);
    fd = fs.openSync(
      filename,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    const before = fs.fstatSync(fd);
    const openingCode = openedFileCode(before, inspected);
    if (openingCode) return partial(openingCode);
    budget.files++;
    const bytes = Buffer.alloc(Math.min(before.size + 1, limits.file + 1));
    const size = fillBuffer(fd, bytes);
    budget.bytes += size;
    const code = readFileCode(before, fd, filename, size, budget);
    if (code) return partial(code);
    return { ...complete(), text: bytes.subarray(0, size).toString('utf8') };
  } catch (error) {
    return partial(fileErrorCode(error));
  } finally {
    closeDescriptor(fd);
  }
}

const knownProfileEntry = (name) =>
  name === '.gitignore' ||
  /^(dev-main|dev-server)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.cpuprofile$/.test(name);

export function createNativeProfile({ enabled, repo, output, identity = {} }) {
  const directory = path.join(repo, '.next-profiles');
  const privateRoot = path.join(output, 'profile-private');
  const budget = { files: 0, bytes: 0 };
  const generations = [];
  const intervals = [];
  const gaps = [];
  const problems = new Set();
  const blockedTraces = new Set();
  const ownership = { stat: undefined, privateStat: undefined };
  let prepared = false,
    reservations = 0;
  const note = (code) => {
    problems.add(code);
    return partial(code);
  };
  const owns = () =>
    ownsDirectory(privateRoot, ownership.privateStat) && ownsDirectory(directory, ownership.stat);
  function entries() {
    const names = [];
    const dir = fs.opendirSync(directory);
    try {
      let entry;
      while ((entry = dir.readSync())) {
        if (names.length === 32) return null;
        names.push(entry.name);
      }
    } finally {
      dir.closeSync();
    }
    return names;
  }
  function readCpuProfile(filename) {
    if (!enabled) return disabled();
    const read = readBounded(filename, budget);
    if (read.status !== 'complete') return read;
    try {
      return projectCpuProfile(JSON.parse(read.text));
    } catch {
      return partial('malformed-profile');
    }
  }
  function prepare() {
    if (!enabled) return disabled();
    // Refuse a linked parent before the runner backs up or copies its working cache.
    const cacheCode = sourceCacheParentCode(repo);
    if (cacheCode) return note(cacheCode);
    try {
      try {
        fs.lstatSync(directory);
        return note('profile-directory-exists');
      } catch (error) {
        if (error.code !== 'ENOENT') return note('profile-directory-exists');
      }
      fs.mkdirSync(privateRoot, { mode: 0o700 });
      ownership.privateStat = fs.lstatSync(privateRoot);
      if (!ownership.privateStat.isDirectory()) return note('profile-prepare-failed');
      fs.mkdirSync(directory, { mode: 0o700 });
      ownership.stat = fs.lstatSync(directory);
      if (!owns()) return note('profile-prepare-failed');
      prepared = true;
      return complete();
    } catch {
      return note('profile-prepare-failed');
    }
  }
  function beginServer({ generation }) {
    if (!enabled) return disabled();
    if (!prepared || !owns()) return note('profile-ownership-changed');
    if (boundedInteger(generation, limits.generations - 1) === null)
      return note('generation-limit');
    return isolatePrestartTrace(generation);
  }
  function isolatePrestartTrace(generation) {
    const cacheCode = sourceCacheCode(repo);
    if (cacheCode) {
      blockedTraces.add(generation);
      return note(cacheCode);
    }
    const trace = path.join(repo, '.next/dev/trace');
    let stat;
    try {
      stat = fs.lstatSync(trace);
    } catch (error) {
      if (error.code === 'ENOENT') return complete();
      blockedTraces.add(generation);
      return note('trace-isolation-failed');
    }
    try {
      if (!stat.isFile()) {
        blockedTraces.add(generation);
        return note('unsafe-file');
      }
      const destination = path.join(privateRoot, `prestart-${generation}.trace`);
      if (!owns() || !absent(destination)) {
        blockedTraces.add(generation);
        return note('profile-ownership-changed');
      }
      fs.renameSync(trace, destination);
    } catch {
      blockedTraces.add(generation);
      return note('trace-isolation-failed');
    }
    return complete();
  }
  function addBrowserInterval(interval) {
    if (!enabled) return disabled();
    if (intervals.length >= limits.intervals) return note('browser-interval-limit');
    const safe = safeInterval(interval);
    intervals.push(safe);
    return safe;
  }
  function addBrowserGap(gap) {
    if (!enabled) return disabled();
    if (gaps.length >= limits.intervals) return note('browser-gap-limit');
    const safe = safeGap(gap);
    if (!safe) return note('malformed-profile');
    gaps.push(safe);
    return safe;
  }
  function recordBrowserProblems(codes) {
    if (!enabled) return;
    for (const code of filteredCodes(codes, [])) problems.add(code);
  }
  function reserveBrowserInterval() {
    if (!enabled) return false;
    if (reservations >= limits.intervals) {
      note('browser-interval-limit');
      return false;
    }
    reservations++;
    return true;
  }
  const state = {
    enabled,
    repo,
    output,
    identity,
    directory,
    privateRoot,
    budget,
    generations,
    intervals,
    gaps,
    problems,
    blockedTraces,
    ownership,
    note,
    owns,
    entries,
    readCpuProfile,
  };
  return {
    prepare,
    beginServer,
    readCpuProfile,
    addBrowserInterval,
    addBrowserGap,
    reserveBrowserInterval,
    recordBrowserProblems,
    addPublicCreate(value) {
      if (!enabled || state.publicCreate) return;
      state.publicCreate = safePublicCreate(value);
    },
    collectServer: (context) => collectServerProfile(state, context),
    finish: (options) => finishNativeProfile(state, options),
  };
}

function serverCollectionCode(state, context) {
  if (!context.stopped) return 'server-not-stopped';
  if (
    !integer(context.generation) ||
    context.generation >= limits.generations ||
    state.generations.length >= limits.generations
  )
    return 'generation-limit';
  if (!state.owns()) return 'profile-ownership-changed';
  return null;
}

function profileEntriesCode(names) {
  if (!names) return 'directory-entry-limit';
  if (names.some((name) => !knownProfileEntry(name))) return 'unexpected-profile-entry';
  return null;
}

function isolateCpuProfiles(state, generation) {
  const directory = path.join(state.privateRoot, `generation-${generation}`);
  if (!state.owns()) return null;
  fs.mkdirSync(directory, { mode: 0o700 });
  const destination = { directory, stat: fs.lstatSync(directory) };
  if (!ownsDestination(state, destination) || !absent(path.join(directory, 'cpu'))) return null;
  fs.renameSync(state.directory, path.join(directory, 'cpu'));
  state.ownership.stat = undefined;
  fs.mkdirSync(state.directory, { mode: 0o700 });
  state.ownership.stat = fs.lstatSync(state.directory);
  return ownsDestination(state, destination) ? destination : null;
}

function ownsDestination(state, destination) {
  return state.owns() && ownsDirectory(destination.directory, destination.stat);
}

function collectCpuRole(state, destination, names, role) {
  const matches = names.filter(
    (name) => name.startsWith(role + '-') && name.endsWith('.cpuprofile'),
  );
  if (matches.length > 1) return { role, ...partial('ambiguous-profile') };
  if (!matches.length) return { role, ...partial('missing-profile') };
  return {
    role,
    ...state.readCpuProfile(path.join(destination.directory, 'cpu', matches[0])),
  };
}

function collectTrace(state, destination, generation) {
  const cacheCode = sourceCacheCode(state.repo);
  if (cacheCode) return { ...state.note(cacheCode), coverage: 'observed-only' };
  const filename = path.join(state.repo, '.next/dev/trace');
  const raw = state.blockedTraces.has(generation)
    ? partial('stale-trace')
    : readBounded(filename, state.budget);
  const projected = raw.status === 'complete' ? projectNextTrace(raw.text) : raw;
  try {
    if (!ownsDestination(state, destination))
      return { ...state.note('profile-ownership-changed'), coverage: 'observed-only' };
    const target = path.join(destination.directory, 'trace');
    if (!absent(target))
      return { ...state.note('profile-ownership-changed'), coverage: 'observed-only' };
    if (!fs.lstatSync(filename).isFile())
      return { ...projected, ...state.note('unsafe-file'), coverage: 'observed-only' };
    fs.renameSync(filename, target);
  } catch {
    state.note('trace-isolation-failed');
    return {
      ...projected,
      status: 'partial',
      codes: [...projected.codes, 'trace-isolation-failed'],
      coverage: 'observed-only',
    };
  }
  return { ...projected, coverage: 'observed-only' };
}

function serverProcess(context) {
  return {
    launcherPid: boundedInteger(context.launcherPid, Number.MAX_SAFE_INTEGER),
    processGroup: Array.isArray(context.processGroup)
      ? context.processGroup.filter(integer).slice(0, 64)
      : [],
    profilePid: null,
  };
}

function serverNetwork(context) {
  return {
    network: {
      monotonicSeconds: finiteOrNull(context.network?.timestamp),
      epochSeconds: finiteOrNull(context.network?.wallTime),
    },
    networkPage: pages.includes(context.network?.page) ? context.network.page : null,
    networkObservation: 'last-observed-in-generation',
  };
}

function serverSummary(context, cpu, trace) {
  return {
    status:
      cpu.every((item) => item.status === 'complete') && trace.status === 'complete'
        ? 'complete'
        : 'partial',
    codes: [],
    generation: context.generation,
    trial: boundedInteger(context.trial, 4),
    process: serverProcess(context),
    collector: { before: bracket(context.before), after: bracket(context.after) },
    ...serverNetwork(context),
    cpu,
    trace,
  };
}

async function collectServerProfile(state, context) {
  if (!state.enabled) return disabled();
  const code = serverCollectionCode(state, context);
  if (code) return state.note(code);
  try {
    const names = state.entries();
    const entryCode = profileEntriesCode(names);
    if (entryCode) return state.note(entryCode);
    const destination = isolateCpuProfiles(state, context.generation);
    if (!destination) return state.note('profile-ownership-changed');
    const cpu = cpuRoles.map((role) => collectCpuRole(state, destination, names, role));
    const trace = collectTrace(state, destination, context.generation);
    const result = serverSummary(context, cpu, trace);
    state.generations.push(result);
    return result;
  } catch {
    return state.note('generation-collection-failed');
  }
}

function preserveOwnedProfiles(state, serverStopped) {
  if (!state.ownership.stat) return null;
  if (!serverStopped) return 'server-not-stopped';
  if (!state.owns()) return 'profile-ownership-changed';
  try {
    const code = profileEntriesCode(state.entries());
    if (code) return code;
    const destination = path.join(state.privateRoot, 'remaining');
    if (!state.owns() || !absent(destination)) return 'profile-ownership-changed';
    fs.renameSync(state.directory, destination);
    state.ownership.stat = undefined;
    return null;
  } catch {
    return 'profile-cleanup-failed';
  }
}

function withPublicCreate(summary, value) {
  if (!value) return summary;
  summary.publicCreate = value;
  if (value.status !== 'complete') summary.status = 'partial';
  return summary;
}

function profileSummary(state) {
  const { problems, generations, intervals } = state;
  const summary = {
    status:
      problems.size ||
      !generations.length ||
      !intervals.length ||
      generations.some((item) => item.status !== 'complete') ||
      intervals.some((item) => item.status !== 'complete')
        ? 'partial'
        : 'complete',
    codes: [...problems],
    identity: provenance(state.identity),
    generations,
    intervals,
    gaps: state.gaps,
    limitations: profileLimitations.slice(),
  };
  if (!generations.length) summary.codes.push('missing-profile');
  if (!intervals.length) summary.codes.push('missing-browser-profile');
  return withPublicCreate(summary, state.publicCreate);
}

function omittedStatus(value) {
  const codes = value.codes.slice();
  if (!codes.includes('summary-too-large')) codes.push('summary-too-large');
  return { status: 'partial', codes };
}

function compactGeneration(value) {
  return {
    generation: boundedInteger(value.generation, limits.generations - 1),
    trial: boundedInteger(value.trial, 4),
    ...omittedStatus(value),
    cpu: value.cpu
      .slice(0, cpuRoles.length)
      .filter((item) => cpuRoles.includes(item.role))
      .map((item) => ({ role: item.role, ...omittedStatus(item) })),
    trace: omittedStatus(value.trace),
  };
}

function compactInterval(value) {
  return {
    generation: boundedInteger(value.generation, limits.generations - 1),
    trial: boundedInteger(value.trial, 4),
    page: pages.includes(value.page) ? value.page : null,
    ...omittedStatus(value),
  };
}

function compactSummary(summary) {
  return {
    ...omittedStatus(summary),
    identity: provenance(summary.identity),
    limitations: profileLimitations.slice(),
    generations: summary.generations.slice(0, limits.generations).map(compactGeneration),
    intervals: summary.intervals.slice(0, limits.intervals).map(compactInterval),
    gaps: summary.gaps.slice(0, limits.intervals).map(safeGap),
    ...(summary.publicCreate ? { publicCreate: compactPublicCreate(summary.publicCreate) } : {}),
  };
}

function ownedPending(filename, expected) {
  const current = fs.lstatSync(filename);
  return current.isFile() && same(expected, current);
}

function removeOwnedPending(filename, expected) {
  if (!expected) return;
  try {
    if (ownedPending(filename, expected)) fs.unlinkSync(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function writeProfileSummary(state, summary) {
  let json = JSON.stringify(summary);
  if (Buffer.byteLength(json) + 1 > limits.summary) {
    summary = compactSummary(summary);
    json = JSON.stringify(summary);
  }
  const safe = path.join(state.output, 'safe');
  fs.mkdirSync(safe, { mode: 0o700 });
  const stat = fs.lstatSync(safe);
  if (!stat.isDirectory()) return state.note('safe-output-conflict');
  const pending = path.join(safe, 'summary.pending');
  const fd = fs.openSync(
    pending,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  );
  let pendingStat;
  try {
    pendingStat = fs.fstatSync(fd);
    fs.writeFileSync(fd, json + '\n');
    if (!ownsDirectory(safe, stat) || !ownedPending(pending, pendingStat))
      return state.note('safe-output-conflict');
    fs.linkSync(pending, path.join(safe, 'summary.json'));
    return summary;
  } finally {
    closeDescriptor(fd);
    removeOwnedPending(pending, pendingStat);
  }
}

async function finishNativeProfile(state, { interrupted = false, serverStopped = true } = {}) {
  if (!state.enabled) return disabled();
  if (interrupted) state.problems.add('interrupted');
  const code = preserveOwnedProfiles(state, serverStopped);
  if (code) state.problems.add(code);
  const summary = profileSummary(state);
  try {
    return writeProfileSummary(state, summary);
  } catch {
    return state.note('safe-output-conflict');
  }
}
