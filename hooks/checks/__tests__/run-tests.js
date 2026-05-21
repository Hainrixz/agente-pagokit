#!/usr/bin/env node
'use strict';

/**
 * Minimal test runner for the validator checks. No external deps.
 *
 * Each .test.js file in this directory exports an array of test cases:
 *   module.exports = [
 *     { name: '...', check: 'webhook-has-signature', ctx: {...}, expected: 'pass'|'deny'|'warn' }
 *   ]
 *
 * Run with `node hooks/checks/__tests__/run-tests.js`.
 */

const fs = require('node:fs');
const path = require('node:path');

const TESTS_DIR = __dirname;
const CHECKS_DIR = path.join(__dirname, '..');

let passCount = 0;
let failCount = 0;
const failures = [];

function loadCheck(name) {
  const checkPath = path.join(CHECKS_DIR, `${name}.js`);
  return require(checkPath);
}

function runCase(testCase) {
  const check = loadCheck(testCase.check);
  const result = check.run(testCase.ctx);

  const actual =
    result == null ? 'pass' : result.level === 'deny' ? 'deny' : result.level === 'warn' ? 'warn' : 'unknown';

  if (actual === testCase.expected) {
    passCount++;
    process.stdout.write(`  [OK]   ${testCase.name}\n`);
  } else {
    failCount++;
    failures.push({
      name: testCase.name,
      check: testCase.check,
      expected: testCase.expected,
      actual,
      result,
    });
    process.stdout.write(`  [FAIL] ${testCase.name} — expected ${testCase.expected}, got ${actual}\n`);
    if (result) {
      process.stdout.write(`         message: ${result.message_en?.slice(0, 100) || '(no message)'}\n`);
    }
  }
}

function main() {
  const files = fs
    .readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.test.js'))
    .sort();

  for (const file of files) {
    process.stdout.write(`\n${file}\n`);
    const cases = require(path.join(TESTS_DIR, file));
    for (const c of cases) {
      runCase(c);
    }
  }

  process.stdout.write(`\n----\n${passCount} passed, ${failCount} failed\n`);

  if (failCount > 0) {
    process.stdout.write(`\nFailures:\n`);
    for (const f of failures) {
      process.stdout.write(`  - ${f.check}: ${f.name}\n`);
      process.stdout.write(`      expected=${f.expected} actual=${f.actual}\n`);
      if (f.result) {
        process.stdout.write(`      result.code=${f.result.code}\n`);
      }
    }
    process.exit(1);
  }
  process.exit(0);
}

main();
