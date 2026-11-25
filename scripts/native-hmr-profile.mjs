import { modes } from './native-hmr-profile-projection.mjs';

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
