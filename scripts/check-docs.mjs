#!/usr/bin/env node
// scripts/check-docs.mjs — documentation gate (AGENTS.md ## Conventions → Documentation discipline).
// One invariant per run: committed Markdown under README.md + docs/ has no dead relative links and
// every durable consumer surface carries its required sections (docs/.docgate.json). Read-only.
// Exit 0 = conform, 1 = violation, 2 = usage/config error. Self-proof: scripts/test-guardrails.sh.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';

const root = process.cwd();
const configPath = join(root, 'docs', '.docgate.json');
if (!existsSync(configPath)) {
  console.error(
    `check-docs: config missing: ${relative(root, configPath)} — extend the gate before adding docs without one`,
  );
  process.exit(2);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const allowlisted = new Map((config.allowlist ?? []).map((e) => [e.path, e]));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

const files = ['README.md', ...walk(join(root, 'docs')).map((f) => relative(root, f))].filter((f) =>
  existsSync(join(root, f)),
);
const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const violations = [];

for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const match of line.matchAll(linkRe)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const clean = target.split('#')[0];
      if (!clean) continue;
      const resolved = resolve(root, dirname(file), clean);
      if (!existsSync(resolved)) {
        violations.push(
          `  ${file}:${i + 1}  dead link "${target}" — expected an existing file, got nothing at ${relative(root, resolved)}`,
        );
      }
    }
  });
  for (const [surface, sections] of Object.entries(config.requiredSections ?? {})) {
    if (surface !== file) continue;
    for (const section of sections) {
      const present = new RegExp(`^##+\\s+${section}\\s*$`, 'm').test(text);
      const allow = allowlisted.get(file);
      if (!present && !allow) {
        violations.push(
          `  ${file}  missing required section "## ${section}" — add it, or allowlist the file in docs/.docgate.json with a reason and exit condition`,
        );
      }
      if (!present && allow && (!allow.reason || !allow.exitCondition)) {
        violations.push(
          `  docs/.docgate.json  allowlist entry for ${file} lacks reason/exitCondition`,
        );
      }
    }
  }
}
for (const entry of allowlisted.values()) {
  if (!existsSync(join(root, entry.path))) {
    violations.push(
      `  docs/.docgate.json  allowlist names ${entry.path} which does not exist — renamed or removed? update the list in the same change`,
    );
  }
}

if (violations.length > 0) {
  console.error(`check-docs: ${violations.length} documentation violation(s):`);
  for (const v of violations) console.error(v);
  process.exit(1);
}
console.log(`check-docs: ${files.length} files checked, all conform.`);
