'use strict';

/**
 * SECURITY_RULES Rule 6 — Never log full event payloads.
 *
 * WARN-only (not deny). Flags lines that log the entire `event`, `req.body`,
 * or `payload` variable. Allows logging specific fields like `event.id`.
 *
 * Bypass: `// pagokit-ignore: no-pii-logs -- <reason>`.
 */

const path = require('node:path');
const {
  hasIgnoreTag,
  isWebhookFilePath,
  stripCommentsAndStrings,
} = require('../lib/utils');

const RULE_ID = 'no-pii-logs';

// Patterns that look like logging the entire variable (not a specific field)
const FULL_LOG_PATTERNS = [
  // console.log(event) — but NOT console.log({ id: event.id })
  /console\.(?:log|info|error|warn|debug)\s*\(\s*(?:event|req\.body|request\.body|payload|body)\s*\)/,
  // logger.info(event) — generic loggers (winston, pino, bunyan)
  /\blogger\.(?:log|info|error|warn|debug|trace)\s*\(\s*(?:event|req\.body|request\.body|payload|body)\s*\)/,
  // Common alias `log.info(event)`
  /\blog\.(?:info|error|warn|debug|trace)\s*\(\s*(?:event|req\.body|request\.body|payload|body)\s*\)/,
  // Python: print(event), print(request.json())
  /\bprint\s*\(\s*(?:event|payload|request\.body|request\.json\s*\(\s*\))\s*\)/,
  // JSON.stringify(event) being logged — via console.* OR logger.*
  /(?:console|logger|log)\.(?:log|info|error|warn|debug|trace)\s*\(\s*JSON\.stringify\s*\(\s*(?:event|req\.body|request\.body|payload)\s*\)/,
  // Sentry / Datadog captureException with full payload
  /captureException\s*\(\s*(?:event|payload|req\.body|request\.body)\s*\)/,
];

function isWebhookFile(filePath, content) {
  if (isWebhookFilePath(filePath)) return true;
  if (!content) return false;
  return /stripe\.webhooks\.constructEvent|verifyWompiChecksum|verifyLemonSignature|verifyMpSignature/.test(
    content
  );
}

function run(ctx) {
  const { filePath, content } = ctx;
  if (!content) return null;
  if (hasIgnoreTag(content, RULE_ID)) return null;
  if (!isWebhookFile(filePath, content)) return null;

  const stripped = stripCommentsAndStrings(content);
  const lines = stripped.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of FULL_LOG_PATTERNS) {
      if (pattern.test(line)) {
        return {
          rule: RULE_ID,
          level: 'warn',
          code: 'ERR_PII_LOG',
          message_en: `Line ${i + 1} appears to log the full event/request body. Log only event.id, event.type, event.created (Rule 6). This is a warning, not a block.`,
          message_es: `La línea ${i + 1} parece loguear el body/event completo. Logea solo event.id, event.type, event.created (Regla 6). Esto es un warning, no bloquea.`,
          suggested_fix:
            `Replace console.log(event) with console.log({ id: event.id, type: event.type, created: event.created }).\n` +
            `Webhook payloads include PII (email, last4 of card, billing address) that ends up retained by Datadog/Sentry.\n` +
            `To bypass: "// pagokit-ignore: ${RULE_ID} -- reason".`,
        };
      }
    }
  }

  return null;
}

module.exports = { run, RULE_ID };
