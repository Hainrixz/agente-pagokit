'use strict';

/**
 * SECURITY_RULES Rule 3 — Webhook handlers must verify request signature.
 *
 * Triggers on files that look like webhook handlers (path or content heuristics).
 * Requires presence of at least one canonical verifier call OR the explicit
 * `// @pagokit:signature-verified` tag for custom wrappers.
 *
 * Bypass: `// pagokit-ignore: webhook-has-signature -- <reason>`.
 */

const path = require('node:path');
const {
  isWebhookFilePath,
  hasIgnoreTag,
  hasSignatureVerifiedTag,
  stripCommentsAndStrings,
} = require('../lib/utils');

const RULE_ID = 'webhook-has-signature';

// Verifier function calls / patterns we accept as proof of signature verification.
const VERIFIER_PATTERNS = [
  /stripe\.webhooks\.constructEvent/, // Stripe Node
  /stripe\.Webhook\.construct_event/, // Stripe Python
  /constructEvent\s*\(/,
  /verify[A-Z]\w*Signature\s*\(/, // verifyMpSignature, verifyLemonSignature, etc.
  /verify[_]\w*signature\s*\(/i, // python/php naming
  /verify[A-Z]\w*Checksum\s*\(/, // verifyWompiChecksum
  /verify[A-Z]\w*Webhook\s*\(/,
  /verify[_]webhook[_]signature/i,
  /createHmac\s*\(/, // crypto.createHmac (sha256 etc.) — stripped strings hide the algorithm name
  /createHash\s*\(/, // crypto.createHash for Wompi-style checksum verification
  /HMAC[._]new\s*\(/, // Python hmac.new
  /Hmac::new/, // Rust/Ruby
  /WebhookSignature\.verify/, // some SDK wrappers
  /timingSafeEqual\s*\(/, // if timingSafeEqual is present, verification logic is too
];

// Files that LOOK like webhooks by extension but aren't payment-related — skip
const NON_PAYMENT_KEYWORDS = ['clerk', 'inngest', 'resend', 'svix', 'github'];

function looksLikeWebhookFile(filePath, content) {
  if (isWebhookFilePath(filePath)) return true;
  // Content heuristic: imports a payment SDK + exports a POST handler
  if (!content) return false;
  const hasPaymentImport = /from\s+['"](?:stripe|@stripe\/|mercadopago|@lemonsqueezy\/|wompi)/.test(content)
    || /require\s*\(\s*['"](?:stripe|mercadopago|@lemonsqueezy\/lemonsqueezy\.js|wompi)/.test(content)
    || /import\s+stripe/i.test(content)
    || /from\s+stripe/i.test(content);
  const hasHandler = /export\s+async\s+function\s+POST/.test(content)
    || /app\.post\s*\(\s*['"][^'"]*webhook/i.test(content)
    || /router\.post\s*\(\s*['"][^'"]*webhook/i.test(content)
    || /@app\.post\s*\(\s*['"][^'"]*webhook/i.test(content);
  return hasPaymentImport && hasHandler;
}

function isExclusionPath(filePath, content) {
  const norm = (filePath || '').toLowerCase();
  if (content) {
    for (const kw of NON_PAYMENT_KEYWORDS) {
      if (new RegExp(`from\\s+['"][^'"]*${kw}`, 'i').test(content)) return true;
    }
  }
  return false;
}

function run(ctx) {
  const { filePath, content } = ctx;
  if (!filePath || !content) return null;
  if (hasIgnoreTag(content, RULE_ID)) return null;

  if (!looksLikeWebhookFile(filePath, content)) return null;
  if (isExclusionPath(filePath, content)) return null;

  // Tag-based bypass for custom verifiers
  if (hasSignatureVerifiedTag(content)) return null;

  // Strip comments and strings before pattern matching so docs don't false-positive
  const stripped = stripCommentsAndStrings(content);

  for (const pattern of VERIFIER_PATTERNS) {
    if (pattern.test(stripped)) {
      return null; // passes — verifier present
    }
  }

  // No verifier found — deny
  return {
    rule: RULE_ID,
    level: 'deny',
    code: 'ERR_WEBHOOK_NO_SIG',
    message_en: `Webhook handler does not verify request signature (Rule 3). The file at ${path.basename(filePath)} looks like a payment webhook but no signature verification call was detected.`,
    message_es: `El handler del webhook no verifica la firma de la petición (Regla 3). El archivo ${path.basename(filePath)} parece un webhook de pagos pero no se detectó verificación de firma.`,
    suggested_fix:
      `Add the canonical verifier for your provider:\n` +
      `- Stripe: stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET).\n` +
      `- Mercado Pago: verify HMAC-SHA256 over the manifest string id:<data.id>;request-id:<x-request-id>;ts:<ts>;.\n` +
      `- Wompi: verifyWompiChecksum(event, process.env.WOMPI_EVENTS_SECRET).\n` +
      `- Lemon Squeezy: verifyLemonSignature(rawBody, signature, process.env.LEMONSQUEEZY_WEBHOOK_SECRET).\n` +
      `If you use a custom wrapper (e.g., lib/auth/payments.ts), add "// @pagokit:signature-verified" above the handler function.\n` +
      `To bypass entirely: "// pagokit-ignore: ${RULE_ID} -- documented reason".`,
  };
}

module.exports = { run, RULE_ID, _VERIFIER_PATTERNS: VERIFIER_PATTERNS };
