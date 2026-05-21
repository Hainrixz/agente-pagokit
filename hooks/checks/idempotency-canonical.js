'use strict';

/**
 * SECURITY_RULES Rule 4 — Idempotency keys must be cryptographic UUIDs.
 *
 * Triggers on files that look like checkout/payment/refund endpoints. If the
 * file passes an `idempotencyKey` or sends an `Idempotency-Key` header but
 * does NOT use a canonical UUID generator, deny. If idempotency is used but
 * no canonical generator is detected (might be in a helper), warn.
 *
 * Bypass: `// pagokit-ignore: idempotency-canonical -- <reason>`.
 */

const path = require('node:path');
const { hasIgnoreTag, stripCommentsAndStrings } = require('../lib/utils');

const RULE_ID = 'idempotency-canonical';

const CANONICAL_GENERATORS = [
  /crypto\.randomUUID\s*\(/, // Node 19+ native
  /\brandomUUID\s*\(/, // imported from node:crypto
  /\buuidv4\s*\(/,
  /uuid\.v4\s*\(/,
  /uuid\.uuid4\s*\(/, // Python
  /SecureRandom\.uuid/, // Ruby
  /Ramsey\\\\Uuid\\\\Uuid::uuid4/, // PHP
  /Uuid::new_v4/, // Rust
];

const WEAK_GENERATORS_NEAR_IDEMPOTENCY = [
  /Math\.random\s*\(/,
  /Date\.now\s*\(/,
  /\btime\.time\s*\(/,
  /\bMicrotime\s*\(/i,
];

const IDEMPOTENCY_CONTEXT_REGEX = /\bidempotency[_-]?key\b/i;
const PROVIDER_HEADER_REGEX = /['"]?(?:X-)?Idempotency-Key['"]?/i;

function looksLikeCheckoutOrPaymentFile(filePath, content) {
  if (!filePath) return false;
  const norm = filePath.toLowerCase();

  // Path heuristics
  if (norm.includes('/checkout/')) return true;
  if (norm.includes('/api/checkout')) return true;
  if (norm.includes('/refund')) return true;
  if (norm.includes('/api/refund')) return true;
  if (norm.includes('/payment')) return true;
  if (norm.match(/\bpayments?\b\.ts$|\bcheckout\.[a-z]+$|\brefund\.[a-z]+$/)) return true;

  // Content heuristics
  if (!content) return false;
  if (/stripe\.paymentIntents\.create/i.test(content)) return true;
  if (/stripe\.checkout\.sessions\.create/i.test(content)) return true;
  if (/mpPayment\.create/.test(content)) return true;
  if (/mpPreference\.create/.test(content)) return true;
  if (/stripe\.refunds\.create/.test(content)) return true;
  return false;
}

function run(ctx) {
  const { filePath, content } = ctx;
  if (!content) return null;
  if (hasIgnoreTag(content, RULE_ID)) return null;
  if (!looksLikeCheckoutOrPaymentFile(filePath, content)) return null;

  const stripped = stripCommentsAndStrings(content);

  // Does this file use idempotency at all?
  const usesIdempotency =
    IDEMPOTENCY_CONTEXT_REGEX.test(stripped) || PROVIDER_HEADER_REGEX.test(content);

  if (!usesIdempotency) return null;

  const hasCanonical = CANONICAL_GENERATORS.some((p) => p.test(stripped));

  // Check for weak generators near idempotency context
  if (!hasCanonical) {
    // Look for weak generators on the same line or within 3 lines of an idempotency reference
    const lines = stripped.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!IDEMPOTENCY_CONTEXT_REGEX.test(line)) continue;

      const windowStart = Math.max(0, i - 2);
      const windowEnd = Math.min(lines.length, i + 3);
      const windowText = lines.slice(windowStart, windowEnd).join('\n');

      for (const weak of WEAK_GENERATORS_NEAR_IDEMPOTENCY) {
        if (weak.test(windowText)) {
          return {
            rule: RULE_ID,
            level: 'deny',
            code: 'ERR_IDEMPOTENCY_WEAK',
            message_en: `Idempotency key uses a weak source (Math.random / Date.now / time.time) at line ${i + 1}. Required: crypto.randomUUID() or equivalent (Rule 4).`,
            message_es: `La clave de idempotencia usa una fuente débil (Math.random / Date.now / time.time) en la línea ${i + 1}. Requerido: crypto.randomUUID() o equivalente (Regla 4).`,
            suggested_fix:
              `Replace the weak generator with crypto.randomUUID() (Node 19+), or import { v4 as uuidv4 } from 'uuid' and call uuidv4().\n` +
              `Python: import uuid; uuid.uuid4().\n` +
              `Ruby: SecureRandom.uuid.\n` +
              `To bypass: "// pagokit-ignore: ${RULE_ID} -- reason".`,
          };
        }
      }
    }

    // Idempotency used but no canonical generator visible — warn (might be in a helper)
    return {
      rule: RULE_ID,
      level: 'warn',
      code: 'ERR_IDEMPOTENCY_MISSING',
      message_en: `File uses idempotency_key but no canonical UUID generator (crypto.randomUUID(), uuid.v4(), etc.) is visible in the same file (Rule 4). Generator may live in a helper.`,
      message_es: `El archivo usa idempotency_key pero no se ve un generador UUID canónico (crypto.randomUUID(), uuid.v4(), etc.) en el mismo archivo (Regla 4). Puede estar en un helper.`,
      suggested_fix:
        `Verify the helper uses crypto.randomUUID() / uuid.uuid4(). If unsure, inline the generator at the call site.`,
    };
  }

  return null;
}

module.exports = { run, RULE_ID };
