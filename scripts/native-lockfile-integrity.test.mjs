// Guard for decision 0021: every committed native override that points at this repository's release
// assets must install with sha512 integrity verification. Reads the committed root pnpm-lock.yaml.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockText = fs.readFileSync(path.join(repository, 'pnpm-lock.yaml'), 'utf8');
const NATIVE_RELEASES = 'https://github.com/DankerMu/mindsprout/releases/download/native-next-';
// SRI form of a 64-byte digest.
const SHA512_SRI = /^sha512-[A-Za-z0-9+/]{86}==$/;

function violations(text) {
  const lockfile = parse(text);
  const natives = Object.entries(lockfile?.overrides ?? {}).filter(
    ([, url]) => typeof url === 'string' && url.startsWith(NATIVE_RELEASES),
  );
  if (natives.length === 0) return [`no lockfile override points at ${NATIVE_RELEASES}`];
  return natives.flatMap(([key, url]) => {
    // Override keys carry a version selector (`<name>@<range>`); packages keys use `<name>@<url>`.
    const separator = key.lastIndexOf('@');
    const packageKey = `${separator > 0 ? key.slice(0, separator) : key}@${url}`;
    const resolution = lockfile.packages?.[packageKey]?.resolution;
    if (!resolution) return [`${key}: no packages entry '${packageKey}'`];
    const found = [];
    if (resolution.tarball !== url) {
      found.push(
        `${key}: resolution.tarball ${resolution.tarball ?? 'missing'} differs from the override URL`,
      );
    }
    if (!SHA512_SRI.test(resolution.integrity ?? '')) {
      found.push(
        `${key}: resolution.integrity ${resolution.integrity ?? 'missing'} is not a sha512 SRI value`,
      );
    }
    return found;
  });
}

test('the committed lockfile installs every native override with sha512 integrity', () => {
  assert.deepEqual(violations(lockText), []);
});

// Fixtures are edits of the committed lockfile text, located independently of the YAML parser.
function nativeOverride(name) {
  const line = lockText
    .split('\n')
    .find((candidate) => candidate.startsWith(`  '${name}@`) && candidate.includes("': https://"));
  assert.ok(line, `the committed lockfile overrides ${name}`);
  const separator = line.indexOf("': ");
  const url = line.slice(separator + 3);
  return { key: line.slice(3, separator), url, entry: `  '${name}@${url}':` };
}

function edit(text, from, to) {
  const edited = text.replace(from, to);
  assert.notEqual(edited, text, `fixture edit ${String(from)} must change the lockfile`);
  return edited;
}

const RESOLUTION = '    resolution: {';

// Index of the packages entry key line: the entry line directly followed by its resolution line.
function packagesEntry(lines, { entry }) {
  const index = lines.findIndex(
    (line, at) => line === entry && lines[at + 1]?.startsWith(RESOLUTION),
  );
  assert.notEqual(index, -1, `the lockfile has the packages entry ${entry}`);
  return index;
}

// Replaces the `{...}` body of the native packages entry's resolution line with rewrite(body).
function editResolution(text, native, rewrite) {
  const lines = text.split('\n');
  const index = packagesEntry(lines, native) + 1;
  assert.ok(lines[index].endsWith('}'), lines[index]);
  const body = lines[index].slice(RESOLUTION.length, -1);
  lines[index] = `${RESOLUTION}${rewrite(body)}}`;
  const edited = lines.join('\n');
  assert.notEqual(edited, text, `fixture edit of ${native.entry} must change the lockfile`);
  return edited;
}

// Removes the packages entry key line and every following four-space-indented line.
function deletePackagesEntry(text, native) {
  const lines = text.split('\n');
  const index = packagesEntry(lines, native);
  let end = index + 1;
  while (lines[end].startsWith('    ')) end += 1;
  lines.splice(index, end - index);
  return lines.join('\n');
}

const mutations = [
  {
    title: 'integrity removed, as a warm-store re-resolution writes it',
    apply: (text, native) => editResolution(text, native, () => `tarball: ${native.url}`),
    reason: /integrity/,
  },
  {
    title: 'integrity replaced with a sha1 value',
    apply: (text, native) =>
      editResolution(
        text,
        native,
        () => `integrity: sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk=, tarball: ${native.url}`,
      ),
    reason: /integrity/,
  },
  {
    title: 'tarball differs from the override URL',
    apply: (text, native) =>
      editResolution(text, native, (body) =>
        body.replace(`tarball: ${native.url}`, 'tarball: https://example.com/x.tgz'),
      ),
    reason: /tarball/,
  },
  {
    title: 'packages entry deleted',
    apply: deletePackagesEntry,
    reason: /packages entry/,
  },
];

for (const name of ['@next/swc-darwin-arm64', '@next/swc-linux-x64-gnu']) {
  for (const { title, apply, reason } of mutations) {
    test(`${name}: ${title} fails naming that override`, () => {
      const native = nativeOverride(name);
      const found = violations(apply(lockText, native));
      assert.equal(found.length, 1, `expected exactly one violation, got ${JSON.stringify(found)}`);
      assert.ok(found[0].startsWith(`${native.key}: `), found[0]);
      assert.match(found[0], reason);
    });
  }
}

const vacuous = [
  {
    title: 'no overrides block',
    text: () => edit(lockText, /\noverrides:\n( {2}.*\n)+/, '\n'),
  },
  {
    title: 'overrides pointing at another release host',
    text: () =>
      edit(lockText, /^overrides:\n( {2}.*\n)+/m, (block) =>
        block.replaceAll('https://github.com/DankerMu/mindsprout/', 'https://example.com/'),
      ),
  },
];

for (const { title, text } of vacuous) {
  test(`${title} fails instead of passing vacuously`, () => {
    assert.deepEqual(violations(text()), [
      'no lockfile override points at https://github.com/DankerMu/mindsprout/releases/download/native-next-',
    ]);
  });
}
