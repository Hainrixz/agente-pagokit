#!/usr/bin/env node
'use strict';

/**
 * PagoKit — consolidated validator dispatcher.
 *
 * Invoked by Claude Code's hook system on PreToolUse, PostToolUse, and Stop.
 * Reads tool invocation JSON from stdin, runs the relevant checks, and emits
 * structured results to stderr (one JSON object per line).
 *
 * Exit codes:
 *   0 — all checks passed (no warnings or only warnings).
 *   2 — at least one check denied (tool call is blocked).
 *
 * Argv:
 *   node pagokit-validate.js <pre|post|stop>
 *
 * Stdin (Claude Code hook payload):
 *   {
 *     "session_id": "...",
 *     "tool_name": "Write" | "Edit" | "MultiEdit",
 *     "tool_input": {
 *       "file_path": "...",
 *       "content": "..." | "new_string": "..." | "edits": [...]
 *     },
 *     "tool_response": {...}   // PostToolUse only
 *   }
 */

const fs = require('node:fs');
const path = require('node:path');
const { isAllowlistedTestFile, isSourceCodeFile, relPath } = require('./lib/utils');

const CHECKS_DIR = path.join(__dirname, 'checks');

const PHASE_CHECKS = {
  pre: ['existing-webhook-check', 'gitignore-check'],
  post: [
    'webhook-has-signature',
    'no-hardcoded-keys',
    'idempotency-canonical',
    'raw-body',
    'no-pii-logs',
  ],
  // Stop re-runs the most critical checks against all paths the agent touched.
  // For Phase 1 simplicity, we re-run on the same `filePath` if Stop has one.
  stop: [
    'webhook-has-signature',
    'no-hardcoded-keys',
    'raw-body',
  ],
};

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) {
      // No stdin attached (manual invocation for debugging)
      resolve(null);
      return;
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      if (!data.trim()) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(null);
      }
    });
    // Safety timeout — never block longer than 2 seconds
    setTimeout(() => resolve(null), 2000).unref?.();
  });
}

function extractFileAndContent(toolName, toolInput) {
  if (!toolInput) return { filePath: null, content: null };

  // Write: { file_path, content }
  if (toolName === 'Write') {
    return {
      filePath: toolInput.file_path || null,
      content: toolInput.content || '',
    };
  }

  // Edit: { file_path, old_string, new_string }
  if (toolName === 'Edit') {
    return {
      filePath: toolInput.file_path || null,
      content: toolInput.new_string || '',
    };
  }

  // MultiEdit: { file_path, edits: [{old_string, new_string}, ...] }
  if (toolName === 'MultiEdit') {
    const edits = toolInput.edits || [];
    return {
      filePath: toolInput.file_path || null,
      content: edits.map((e) => e.new_string || '').join('\n'),
    };
  }

  return { filePath: null, content: null };
}

async function main() {
  const phase = process.argv[2];
  if (!PHASE_CHECKS[phase]) {
    // Unknown phase — exit cleanly (don't break the user)
    process.exit(0);
  }

  const payload = await readStdin();

  // If we can't read the payload, exit clean — no input means nothing to check
  if (!payload) {
    process.exit(0);
  }

  const toolName = payload.tool_name;
  const toolInput = payload.tool_input || {};
  const { filePath, content } = extractFileAndContent(toolName, toolInput);

  if (!filePath) {
    process.exit(0);
  }

  // Skip non-source files and allowlisted test files
  if (!isSourceCodeFile(filePath) && !filePath.endsWith('.env') && !filePath.match(/\.env\./)) {
    // Non-code files we still care about: .env files (gitignore-check needs them)
    // .json, .yaml etc. are usually fine.
    const interestingNonCode = path.basename(filePath).startsWith('.env');
    if (!interestingNonCode) {
      process.exit(0);
    }
  }

  if (isAllowlistedTestFile(filePath)) {
    process.exit(0);
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const ctx = { filePath, content, toolName, projectDir, phase };

  const denies = [];
  const warns = [];

  for (const checkName of PHASE_CHECKS[phase]) {
    const checkPath = path.join(CHECKS_DIR, `${checkName}.js`);
    if (!fs.existsSync(checkPath)) continue;

    let check;
    try {
      check = require(checkPath);
    } catch (err) {
      // Check itself failed to load — log to stderr but don't block
      process.stderr.write(
        JSON.stringify({
          tool: 'pagokit-validate',
          rule: checkName,
          level: 'internal',
          code: 'ERR_CHECK_LOAD_FAILED',
          message_en: `Could not load check: ${err.message}`,
          message_es: `No se pudo cargar el check: ${err.message}`,
        }) + '\n'
      );
      continue;
    }

    let result;
    try {
      result = check.run(ctx);
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          tool: 'pagokit-validate',
          rule: checkName,
          level: 'internal',
          code: 'ERR_CHECK_RUNTIME',
          message_en: `Check threw: ${err.message}`,
          message_es: `El check falló: ${err.message}`,
        }) + '\n'
      );
      continue;
    }

    if (!result) continue;
    const enriched = {
      tool: 'pagokit-validate',
      file: relPath(filePath, projectDir),
      ...result,
    };
    if (result.level === 'deny') {
      denies.push(enriched);
    } else if (result.level === 'warn') {
      warns.push(enriched);
    }
  }

  // Emit warnings to stderr (informational, don't block)
  for (const w of warns) {
    process.stderr.write(JSON.stringify(w) + '\n');
  }

  if (denies.length > 0) {
    for (const d of denies) {
      process.stderr.write(JSON.stringify(d) + '\n');
    }
    // Audit log of denied attempts
    try {
      const auditDir = path.join(projectDir, '.pagokit');
      fs.mkdirSync(auditDir, { recursive: true });
      const auditLine =
        `${new Date().toISOString()} ${phase} ${denies.map((d) => d.rule).join(',')} ${filePath}\n`;
      fs.appendFileSync(path.join(auditDir, 'audit.log'), auditLine);
    } catch {
      // Audit log is best-effort; don't break the flow
    }
    process.exit(2);
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({
      tool: 'pagokit-validate',
      level: 'internal',
      code: 'ERR_DISPATCHER_CRASHED',
      message_en: err.message,
      message_es: err.message,
    }) + '\n'
  );
  process.exit(0); // never block on internal errors
});
