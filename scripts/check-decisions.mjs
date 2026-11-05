#!/usr/bin/env node
// scripts/check-decisions.mjs — decision-record gate (decisions/README.md lifecycle).
// Invariants: every record has required frontmatter, a known kind, a status matching its zone,
// a unique id; archived records are frozen (sha256 must match decisions/archived/MANIFEST.json).
// Exit 0 = conform, 1 = violation, 2 = usage/config error. Self-proof: scripts/test-guardrails.sh.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const base = join(root, 'decisions');
const ZONES = ['proposed', 'implemented', 'rejected', 'archived'];
const KINDS = ['architecture', 'process', 'testing', 'bug-fix', 'feature', 'simplification'];
const REQUIRED = ['id', 'title', 'kind', 'status', 'date'];

if (!existsSync(base)) {
  console.error(
    'check-decisions: decisions/ directory missing — extend the gate or restore the tree',
  );
  process.exit(2);
}
const manifestPath = join(base, 'archived', 'MANIFEST.json');
if (!existsSync(manifestPath)) {
  console.error(
    'check-decisions: decisions/archived/MANIFEST.json missing — the archive freeze needs a committed manifest',
  );
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.md') && entry !== 'README.md') out.push(full);
  }
  return out;
}

function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return fields;
}

const violations = [];
const ids = new Map();
let checked = 0;
for (const zone of ZONES) {
  const zoneDir = join(base, zone);
  if (!existsSync(zoneDir)) {
    violations.push(`  decisions/${zone}/  zone directory missing — expected all four zones`);
    continue;
  }
  for (const file of walk(zoneDir)) {
    checked += 1;
    const rel = relative(root, file);
    const text = readFileSync(file, 'utf8');
    const fm = frontmatter(text);
    if (!fm) {
      violations.push(`  ${rel}  missing YAML frontmatter block`);
      continue;
    }
    for (const key of REQUIRED)
      if (!fm[key]) violations.push(`  ${rel}  frontmatter lacks "${key}"`);
    if (fm.kind && !KINDS.includes(fm.kind))
      violations.push(`  ${rel}  unknown kind "${fm.kind}" — expected one of ${KINDS.join(', ')}`);
    if (fm.status && fm.status !== zone)
      violations.push(
        `  ${rel}  status "${fm.status}" does not match zone "${zone}" — move the file, never edit the status in place`,
      );
    if (fm.id) {
      if (ids.has(fm.id))
        violations.push(`  ${rel}  duplicate id "${fm.id}" (also in ${ids.get(fm.id)})`);
      ids.set(fm.id, rel);
    }
    if (!/^## Alternatives considered/m.test(text))
      violations.push(
        `  ${rel}  missing "## Alternatives considered" — a decision without what it beat invites re-debate`,
      );
    if (zone === 'archived') {
      const hash = createHash('sha256').update(text).digest('hex');
      const key = relative(base, file);
      if (!manifest[key])
        violations.push(
          `  ${rel}  archived record not in MANIFEST.json — archive via the lifecycle skill, which records the hash`,
        );
      else if (manifest[key] !== hash)
        violations.push(
          `  ${rel}  archived record was edited (hash mismatch) — archives are frozen; write a new proposed record instead`,
        );
    }
  }
}
for (const key of Object.keys(manifest)) {
  if (!existsSync(join(base, key)))
    violations.push(
      `  decisions/archived/MANIFEST.json  names ${key} which does not exist — renamed or removed? update the manifest in the same change`,
    );
}

if (violations.length > 0) {
  console.error(`check-decisions: ${violations.length} decision-record violation(s):`);
  for (const v of violations) console.error(v);
  process.exit(1);
}
console.log(`check-decisions: ${checked} records checked, all conform.`);
