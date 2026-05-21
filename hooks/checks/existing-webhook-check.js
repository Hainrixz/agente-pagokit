'use strict';

/**
 * SECURITY_RULES Rule 7 — Never overwrite an existing webhook route.
 *
 * Pre-write check. If the target file path matches a webhook pattern AND a
 * webhook route already exists in the project at the SAME path, deny with a
 * suggestion to namespace.
 *
 * PagoKit's default convention is `/api/webhook/<provider>/...` so collisions
 * should be rare in practice — this check catches the case where the LLM
 * tries to write `/api/webhook/route.ts` while an existing `/api/webhook/route.ts`
 * already serves Clerk / Inngest / Resend.
 *
 * Bypass: `// pagokit-ignore: existing-webhook-check -- <reason>` in the first
 * 10 lines of the new file's content.
 */

const fs = require('node:fs');
const path = require('node:path');
const { hasIgnoreTag, isWebhookFilePath } = require('../lib/utils');

const RULE_ID = 'existing-webhook-check';

function fileExists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function run(ctx) {
  const { filePath, content, toolName, projectDir } = ctx;
  if (!filePath) return null;
  if (!isWebhookFilePath(filePath)) return null;
  if (content && hasIgnoreTag(content, RULE_ID)) return null;

  // For Edit/MultiEdit, the file already exists and the LLM is modifying — allow.
  if (toolName === 'Edit' || toolName === 'MultiEdit') return null;

  // For Write: if the file ALREADY exists at this exact path and the new content
  // doesn't already look like a payment-provider webhook, deny (potential overwrite).
  if (toolName === 'Write' && fileExists(filePath)) {
    // Compare new content vs existing — if existing references a non-PagoKit
    // integration (Clerk, Inngest, Svix, etc.) deny with namespacing suggestion.
    let existing;
    try {
      existing = fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }

    const NON_PAGOKIT_INTEGRATIONS = [
      { name: 'Clerk', pattern: /from\s+['"]@clerk\/|svix/i },
      { name: 'Inngest', pattern: /from\s+['"]inngest|@inngest\//i },
      { name: 'Resend', pattern: /from\s+['"]resend/i },
      { name: 'Slack', pattern: /\bslack\s+(?:webhook|signing)/i },
      { name: 'GitHub', pattern: /x-hub-signature-256/i },
    ];

    for (const { name, pattern } of NON_PAGOKIT_INTEGRATIONS) {
      if (pattern.test(existing)) {
        const suggestedPath = suggestNamespacedPath(filePath);
        return {
          rule: RULE_ID,
          level: 'deny',
          code: 'ERR_WEBHOOK_COLLISION',
          message_en: `${path.basename(filePath)} already exists and references ${name}. Writing over it would break that integration. Use a namespaced path: ${suggestedPath} (Rule 7).`,
          message_es: `${path.basename(filePath)} ya existe y usa ${name}. Sobrescribirlo rompería esa integración. Usa una ruta con namespace: ${suggestedPath} (Regla 7).`,
          suggested_fix:
            `Rename the new file to ${suggestedPath}. PagoKit's convention is /api/webhook/<provider>/... so multi-provider co-existence works.\n` +
            `To bypass (you really want to overwrite): "// pagokit-ignore: ${RULE_ID} -- <reason>" in the first 10 lines of the new file.`,
        };
      }
    }
  }

  return null;
}

function suggestNamespacedPath(filePath) {
  // If file is `app/api/webhook/route.ts`, suggest `app/api/webhook/stripe/route.ts`
  // Best-effort namespacing based on dir layout.
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return path.join(dir, '<provider>', base);
}

module.exports = { run, RULE_ID };
