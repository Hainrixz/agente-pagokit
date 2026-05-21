'use strict';

/**
 * SECURITY_RULES Rule 2 — .env must be gitignored before any env file is
 * created.
 *
 * Pre-write check. If the file being written is named `.env`, `.env.local`,
 * `.env.production`, etc. (anything matching `.env*` EXCEPT
 * `.env.example`/`.env.sample`/`.env.template`), require `.gitignore` covers it.
 *
 * Walks up from the project directory looking for `.gitignore` (handles
 * monorepos). If found and `.env` is covered, allow. Otherwise deny with a
 * specific suggestion.
 *
 * Bypass: `// pagokit-ignore: gitignore-check -- <reason>`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { hasIgnoreTag, walkUpForFile } = require('../lib/utils');

const RULE_ID = 'gitignore-check';

const ENV_ALLOWLIST = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.development.example',
  '.env.local.example',
]);

function isEnvFile(filePath) {
  const base = path.basename(filePath);
  if (base === '.env') return true;
  if (base.startsWith('.env.')) return true;
  return false;
}

function gitignoreCovers(gitignoreContent, envFilename) {
  if (!gitignoreContent) return false;
  const lines = gitignoreContent
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  let covered = false;
  for (const line of lines) {
    // Negation un-ignores
    if (line.startsWith('!')) {
      const pattern = line.slice(1);
      if (matchGitignorePattern(pattern, envFilename)) {
        covered = false;
      }
      continue;
    }
    if (matchGitignorePattern(line, envFilename)) {
      covered = true;
    }
  }
  return covered;
}

function matchGitignorePattern(pattern, target) {
  // Simple gitignore match — handles `.env`, `.env*`, `*.env`, `**/.env`.
  if (pattern === target) return true;
  if (pattern === '.env' && target === '.env') return true;
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    if (target.startsWith(prefix)) return true;
  }
  if (pattern.startsWith('**/')) {
    return matchGitignorePattern(pattern.slice(3), target);
  }
  // `.env*` covers `.env`, `.env.local`, `.env.production`
  if (pattern === '.env*') {
    return target.startsWith('.env');
  }
  if (pattern === '.env' && target.startsWith('.env')) return true;
  return false;
}

function run(ctx) {
  const { filePath, content, toolName, projectDir } = ctx;
  if (!filePath) return null;
  if (!isEnvFile(filePath)) return null;
  if (content && hasIgnoreTag(content, RULE_ID)) return null;

  const base = path.basename(filePath);

  // Allowlisted env files (.env.example, etc.) — always allow
  if (ENV_ALLOWLIST.has(base)) return null;

  // Find .gitignore by walking up from the file's directory
  const startDir = path.dirname(filePath);
  const gitignorePath = walkUpForFile(startDir, '.gitignore');

  let gitignoreContent = '';
  if (gitignorePath) {
    try {
      gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    } catch {
      gitignoreContent = '';
    }
  }

  // Also check the project's root .gitignore if we have it
  if (!gitignorePath && projectDir) {
    const projectGitignore = path.join(projectDir, '.gitignore');
    if (fs.existsSync(projectGitignore)) {
      try {
        gitignoreContent = fs.readFileSync(projectGitignore, 'utf8');
      } catch {}
    }
  }

  if (gitignoreCovers(gitignoreContent, base)) {
    return null; // covered, allow
  }

  return {
    rule: RULE_ID,
    level: 'deny',
    code: 'ERR_ENV_NOT_GITIGNORED',
    message_en: `Cannot create ${base} because .gitignore does not exclude it. (Rule 2). Committing .env would leak secrets.`,
    message_es: `No se puede crear ${base} porque .gitignore no lo excluye. (Regla 2). Comitear .env filtraría secretos.`,
    suggested_fix:
      `Add this line to your .gitignore (at the project root):\n` +
      `  .env\n` +
      `  .env.local\n` +
      `  .env.*.local\n` +
      `Keep .env.example committable by ADDING:\n` +
      `  !.env.example\n` +
      `Then retry creating the file.\n` +
      `To bypass: "// pagokit-ignore: ${RULE_ID} -- reason".`,
  };
}

module.exports = { run, RULE_ID };
