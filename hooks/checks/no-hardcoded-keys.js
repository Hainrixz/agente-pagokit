'use strict';

/**
 * SECURITY_RULES Rule 1 — Never hardcode API keys.
 *
 * Loads provider key patterns from providers.json and scans the file content
 * (after stripping comments) for any real-looking key literal.
 *
 * Allowlist: tests/fixtures (skipped at dispatcher level). `.env.example`
 * files are checked specifically to ensure they only contain test prefixes,
 * not live keys.
 *
 * Bypass: `// pagokit-ignore: no-hardcoded-keys -- <reason>`.
 */

const path = require('node:path');
const { loadProviders, hasIgnoreTag, stripCommentsAndStrings } = require('../lib/utils');

const RULE_ID = 'no-hardcoded-keys';

// Patterns for keys we always reject inline (in addition to the per-provider regex).
// These cover "live" key prefixes regardless of provider.
const UNIVERSAL_LIVE_PATTERNS = [
  /sk_live_[A-Za-z0-9]{16,}/,
  /pk_live_[A-Za-z0-9]{16,}/,
  /rk_live_[A-Za-z0-9]{16,}/,
  /prv_prod_[A-Za-z0-9]{16,}/,
  /pub_prod_[A-Za-z0-9]{16,}/,
  /lmnsq_live_[A-Za-z0-9_\-]{30,}/,
  /APP_USR-[A-Za-z0-9]{16,}-[0-9]{6,}-[a-z0-9]{16,}-[0-9]+/,
];

function run(ctx) {
  const { filePath, content } = ctx;
  if (!content) return null;
  if (hasIgnoreTag(content, RULE_ID)) return null;

  const isEnvExample =
    path.basename(filePath) === '.env.example' ||
    path.basename(filePath) === '.env.sample' ||
    path.basename(filePath) === '.env.template';

  // For .env.example files, only flag LIVE keys (placeholders are fine).
  if (isEnvExample) {
    for (const pattern of UNIVERSAL_LIVE_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        return {
          rule: RULE_ID,
          level: 'deny',
          code: 'ERR_HARDCODED_KEY',
          message_en: `.env.example must contain only test-mode key placeholders, never live keys (Rule 8).`,
          message_es: `.env.example debe contener solo placeholders de claves de prueba, nunca claves live (Regla 8).`,
          suggested_fix: `Replace the live key (matched: ${match[0].slice(0, 16)}…) with a test-mode placeholder like sk_test_REPLACE_ME.`,
        };
      }
    }
    return null;
  }

  // For source code files, strip comments and strings first
  const ext = path.extname(filePath).toLowerCase();
  const isJsLike = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
  const scanText = isJsLike ? content : content; // For Python/PHP, comment-stripping is less critical
  // Actually we want to scan WITH strings for keys (keys appear inside strings).
  // But we want to skip strings that look like documentation comments.
  // Strategy: scan the raw content but exclude code lines that are inside block comments.

  // Universal live patterns — these are always wrong inline in source code
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure comment lines (// or # or *)
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;

    for (const pattern of UNIVERSAL_LIVE_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        return {
          rule: RULE_ID,
          level: 'deny',
          code: 'ERR_HARDCODED_KEY',
          message_en: `Hardcoded live API key detected at line ${i + 1}. Move it to process.env. (Rule 1)`,
          message_es: `Clave de API live hardcodeada en la línea ${i + 1}. Muévela a process.env. (Regla 1).`,
          suggested_fix: `Replace the literal "${match[0].slice(0, 16)}…" with process.env.YOUR_VAR_NAME, and document the var in .env.example with a test-key placeholder. To bypass (rare): add comment "// pagokit-ignore: ${RULE_ID} -- documented reason".`,
        };
      }
    }

    // Provider-specific patterns. The patterns in providers.json are anchored with
    // ^...$ (full-string match) but we're scanning by line, so we strip the anchors
    // before constructing the RegExp. This catches embedded literals like
    // `const k = "sk_test_…"` while still respecting the pattern shape.
    const { providers } = loadProviders();
    for (const provider of providers || []) {
      const patterns = [provider.secret_key_pattern, provider.publishable_key_pattern].filter(Boolean);
      for (const patternStr of patterns) {
        const stripped = patternStr.replace(/^\^/, '').replace(/\$$/, '');
        let pattern;
        try {
          pattern = new RegExp(stripped);
        } catch {
          continue;
        }
        const match = line.match(pattern);
        if (!match) continue;
        const matched = match[0];

        // Heuristic: ignore obvious placeholders
        if (/REPLACE|EXAMPLE|PLACEHOLDER|YOUR_|XXXX|FAKE|TODO/i.test(matched)) continue;
        // Ignore short matches that are likely placeholders, but only for keys
        // whose prefix is short. Wompi's prv_test_ + 20 chars = ~28; allow >= 25.
        if (matched.length < 25) continue;

        return {
          rule: RULE_ID,
          level: 'deny',
          code: 'ERR_HARDCODED_KEY',
          message_en: `Hardcoded ${provider.name} key detected at line ${i + 1}. Move it to process.env. (Rule 1)`,
          message_es: `Clave de ${provider.name} hardcodeada en la línea ${i + 1}. Muévela a process.env. (Regla 1).`,
          suggested_fix: `Replace the literal key with process.env.YOUR_VAR_NAME and document it in .env.example. To bypass: "// pagokit-ignore: ${RULE_ID} -- reason".`,
        };
      }
    }
  }

  return null;
}

module.exports = { run, RULE_ID };
