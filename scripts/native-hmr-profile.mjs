import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  modes,
  matched,
  limits,
  boundedInteger,
  finite,
} from './native-hmr-profile-projection.mjs';
import { readBounded } from './native-hmr-profile-collection.mjs';

const ambient = [
  'NEXT_CPU_PROF',
  'NEXT_CPU_PROF_DIR',
  '__NEXT_PRIVATE_CPU_PROFILE',
  'NEXT_TURBOPACK_TRACING',
  'NEXT_TURBOPACK_TRACING_PATH',
];

export function parseNativeBrowserArgs(args, environment = process.env) {
  const fail = (code) => {
    throw Object.assign(new Error(code), { code });
  };
  if (ambient.some((key) => Object.hasOwn(environment, key))) fail('ambient-profiling');
  const profile = args.at(-1) === '--profile';
  const positional = profile ? args.slice(0, -1) : args;
  if (
    positional.length < 2 ||
    positional.length > 3 ||
    !modes.includes(positional[0]) ||
    positional.some((item) => typeof item !== 'string' || !item || item.startsWith('-'))
  )
    fail('invalid-arguments');
  return { mode: positional[0], output: positional[1], candidateManifest: positional[2], profile };
}

function failedMode(outcomes) {
  if (outcomes?.restored === 'failure') return 'restored-lifecycle';
  if (outcomes?.restored === 'success' && outcomes?.source === 'failure') return 'source-change';
  return null;
}

function readQualification(directory, budget) {
  const result = readBounded(path.join(directory, 'result.json'), budget);
  const cleanup = readBounded(path.join(directory, 'cleanup.json'), budget);
  if (result.status !== 'complete' || cleanup.status !== 'complete') return null;
  return { result: JSON.parse(result.text), cleanup: JSON.parse(cleanup.text) };
}

function validFailedResult(result, mode) {
  if (!result || result.mode !== mode || result.status !== 'failed') return false;
  return Array.isArray(result.failures) && result.failures.length > 0;
}

function validCleanup(item, sourceHash) {
  if (!item || !Array.isArray(item.errors) || item.errors.length) return false;
  return (
    item.sourceRestored === true &&
    item.cacheRestored === true &&
    Boolean(matched(item.sourceHash, /^[a-f0-9]{64}$/)) &&
    item.sourceHash === item.expectedSourceHash &&
    item.sourceHash === sourceHash
  );
}

const navigationPhases = [
  'public-map-setup',
  'retained-document-setup',
  'source-preparation',
  'source-observation',
  'spa-preparation',
];

function validEventEnvelope(event) {
  return (
    event !== null &&
    typeof event === 'object' &&
    !Array.isArray(event) &&
    typeof event.type === 'string' &&
    event.type.length <= 128
  );
}

function validCollectorEvent(event) {
  return (
    typeof event.phase === 'string' &&
    event.page === 'collector' &&
    boundedInteger(event.generation, limits.generations - 1) !== null &&
    boundedInteger(event.trial, 4) !== null &&
    finite(event.at) &&
    finite(event.ms)
  );
}

function observeResume(state, event) {
  if (!validCollectorEvent(event)) return false;
  if (!['restart-observation', 'cleanup'].includes(event.phase)) return false;
  if (event.phase === 'restart-observation')
    state.resumed.add(`${event.generation}:${event.trial}`);
  return true;
}

function observeQualificationEvent(state, event) {
  if (!validEventEnvelope(event)) return false;
  if (event.type === 'browser-resumed') return observeResume(state, event);
  if (event.type !== 'failure') return true;
  if (state.failure || !validCollectorEvent(event)) return false;
  state.failure = {
    phase: event.phase,
    resumed: state.resumed.has(`${event.generation}:${event.trial}`),
  };
  return true;
}

function eligibleBrowserFailure(failure) {
  if (!failure) return false;
  if (navigationPhases.includes(failure.phase)) return true;
  return failure.phase === 'restart-observation' && failure.resumed;
}

function validDefaultCreateEvent(event) {
  return (
    event.phase === 'public-map-setup' &&
    event.page === 'retained-editor' &&
    event.generation === 0 &&
    event.trial === 0 &&
    finite(event.at) &&
    finite(event.ms) &&
    event.data !== null &&
    typeof event.data === 'object' &&
    !Array.isArray(event.data)
  );
}

function validPublicationNotice(event) {
  return (
    validDefaultCreateEvent(event) &&
    Object.keys(event.data).length === 2 &&
    event.data.stage === 'publication' &&
    event.data.message === 'Public-create evidence publication failed'
  );
}

function countReplayEvent(state, event) {
  switch (event.type) {
    case 'public-create-evidence':
      if (state.createEvidence || !validDefaultCreateEvent(event)) return false;
      state.createEvidence = true;
      return true;
    case 'public-create-observation-error':
      if (state.publicationNotice || !validPublicationNotice(event)) return false;
      state.publicationNotice = true;
      return true;
    default:
      return ++state.legacy <= limits.records;
  }
}

function browserFailure(events) {
  if (!Array.isArray(events) || !events.length || events.length > limits.records + 2) return false;
  const state = {
    failure: null,
    resumed: new Set(),
    legacy: 0,
    createEvidence: false,
    publicationNotice: false,
  };
  for (const event of events) {
    if (!observeQualificationEvent(state, event) || !countReplayEvent(state, event)) return false;
  }
  return (
    (!state.publicationNotice || state.createEvidence) && eligibleBrowserFailure(state.failure)
  );
}

function qualificationCode(evidence, mode) {
  if (!validFailedResult(evidence.result, mode)) return 'invalid-qualification-evidence';
  const sourceHash = evidence.cleanup?.sourceHash;
  if (![evidence.cleanup, evidence.result.cleanup].every((item) => validCleanup(item, sourceHash)))
    return 'cleanup-not-verified';
  if (!browserFailure(evidence.result.events)) return 'non-browser-failure';
  return null;
}

function matchingSource(source, sourceHash, budget) {
  const current = readBounded(source, budget);
  return (
    current.status === 'complete' &&
    createHash('sha256').update(current.text).digest('hex') === sourceHash
  );
}

export function selectNativeDiagnostic({
  platform,
  cancelled,
  outcomes,
  evidenceDirectory,
  source,
}) {
  const refuse = (code) => ({ eligible: false, mode: null, code });
  if (platform !== 'darwin' || cancelled) return refuse('diagnostic-not-selected');
  const mode = failedMode(outcomes);
  if (!mode) return refuse('diagnostic-not-selected');
  const budget = { files: 0, bytes: 0 };
  try {
    const evidence = readQualification(evidenceDirectory, budget);
    if (!evidence) return refuse('invalid-qualification-evidence');
    const code = qualificationCode(evidence, mode);
    if (code) return refuse(code);
    if (!matchingSource(source, evidence.cleanup.sourceHash, budget))
      return refuse('source-identity-changed');
    return { eligible: true, mode, code: null };
  } catch {
    return refuse('invalid-qualification-evidence');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.length !== 3 || process.argv[2] !== '--select-diagnostic') {
    process.stderr.write('invalid-arguments\n');
    process.exitCode = 2;
  } else {
    const restored = process.env.NATIVE_RESTORED_OUTCOME;
    const source = process.env.NATIVE_SOURCE_OUTCOME;
    const restoredFailed = restored === 'failure';
    const decision = selectNativeDiagnostic({
      platform: process.platform,
      cancelled: process.env.NATIVE_PROFILE_CANCELLED === 'true',
      outcomes: { restored, source },
      evidenceDirectory: path.resolve(
        '.run/native-installed',
        restoredFailed ? 'restored' : 'source',
      ),
      source: path.resolve(
        restoredFailed
          ? 'src/app/providers/MapRepositoryProvider.tsx'
          : 'src/app/maps/[id]/MapEditor.tsx',
      ),
    });
    if (decision.eligible) process.stdout.write(decision.mode + '\n');
    else process.stderr.write(decision.code + '\n');
  }
}
