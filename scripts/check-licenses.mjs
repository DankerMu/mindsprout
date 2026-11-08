import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readPolicy(root) {
  let policy;
  try {
    policy = parse(readFileSync(join(root, 'constraints.yaml'), 'utf8'));
  } catch {
    throw new Error('Cannot read or parse constraints.yaml');
  }
  const rules = policy?.dependencies?.allowed_licenses;
  validatePolicyMetadata(rules);
  const allowed = rules?.value;
  if (!Array.isArray(allowed) || allowed.length === 0 || !allowed.every(nonemptyString)) {
    throw new Error('dependencies.allowed_licenses.value must be a nonempty array of license IDs');
  }
  if (!Array.isArray(rules.exceptions)) {
    throw new Error('dependencies.allowed_licenses.exceptions must be an array');
  }
  for (const exception of rules.exceptions) validateException(exception);
  return { allowed: new Set(allowed), exceptions: rules.exceptions };
}

function validatePolicyMetadata(rules) {
  if (rules?.scope !== 'installed-all') {
    throw new Error('dependencies.allowed_licenses.scope must be installed-all');
  }
  if (rules.severity !== 'block') {
    throw new Error('dependencies.allowed_licenses.severity must be block');
  }
  if (!nonemptyString(rules.enforced_by)) {
    throw new Error('dependencies.allowed_licenses.enforced_by must be nonempty text');
  }
}

function validateException(exception) {
  if (!exception || typeof exception !== 'object' || Array.isArray(exception)) {
    throw new Error('License exceptions must be package/version/license policy groups');
  }
  if (
    !Array.isArray(exception.packages) ||
    exception.packages.length === 0 ||
    !exception.packages.every(nonemptyString)
  ) {
    throw new Error(
      'License exception packages must be a nonempty array of complete package names',
    );
  }
  const required = ['version', 'license', 'reason', 'exit_condition'];
  if (!required.every((field) => nonemptyString(exception[field]))) {
    throw new Error(
      'License exceptions require version, license, reason and exit_condition strings',
    );
  }
}

function isApproved(policy, name, version, license) {
  return (
    policy.allowed.has(license) ||
    policy.exceptions.some(
      (exception) =>
        exception.packages.includes(name) &&
        exception.version === version &&
        exception.license === license,
    )
  );
}

function collectInventory(root) {
  const result = spawnSync('pnpm', ['licenses', 'list', '--json'], {
    cwd: root,
    shell: false,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(`Inventory acquisition failed (${result.error.code ?? 'spawn error'})`);
  }
  if (result.signal) {
    throw new Error(`Inventory producer terminated by ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(`Inventory producer failed (exit ${result.status})`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('Inventory producer returned invalid JSON');
  }
}

function validatePackage(entry) {
  if (!nonemptyString(entry?.name) || !nonemptyString(entry?.license)) {
    throw new Error('Inventory packages must have a name and declared license');
  }
  if (
    !Array.isArray(entry.versions) ||
    entry.versions.length === 0 ||
    !entry.versions.every(nonemptyString)
  ) {
    throw new Error('Inventory packages must have nonempty resolved version strings');
  }
}

function checkInventory(inventory, policy) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    throw new Error('Inventory must be an object of package arrays');
  }
  let checked = 0;
  const violations = [];
  for (const packages of Object.values(inventory)) {
    if (!Array.isArray(packages)) {
      throw new Error('Inventory license groups must be package arrays');
    }
    for (const entry of packages) {
      validatePackage(entry);
      for (const version of entry.versions) {
        checked += 1;
        if (!isApproved(policy, entry.name, version, entry.license)) {
          violations.push(`${entry.name}@${version}: unapproved license ${entry.license}`);
        }
      }
    }
  }
  if (checked === 0) {
    throw new Error('Inventory contains no installed package versions');
  }
  return { checked, violations };
}

try {
  const root = process.cwd();
  const policy = readPolicy(root);
  const { checked, violations } = checkInventory(collectInventory(root), policy);
  if (violations.length > 0) {
    for (const violation of violations) console.error(`check-licenses: ${violation}`);
    process.exitCode = 1;
  } else {
    console.log(
      `check-licenses: ${checked} installed package versions comply with the license policy`,
    );
  }
} catch (error) {
  console.error(`check-licenses: ${error.message}`);
  process.exitCode = 2;
}
