'use strict';

/**
 * SECURITY_RULES Rule 5 — Webhook handlers must consume raw body.
 *
 * Triggers on files that look like webhook handlers. Detects the stack and
 * applies the correct rule.
 *
 * - Next.js App Router / generic JS: must NOT call `request.json()` /
 *   `await req.json()` / `req.body` (after JSON parse) before signature
 *   verification. Must use `request.text()` or `request.arrayBuffer()`.
 * - Express: must register `express.raw(...)` middleware on the route, OR
 *   use `req.body` as a Buffer (i.e., the route has `express.raw` applied).
 * - FastAPI: must use `await request.body()` (returns bytes), not `.json()`.
 *
 * Bypass: `// pagokit-ignore: raw-body -- <reason>`.
 */

const path = require('node:path');
const {
  hasIgnoreTag,
  isWebhookFilePath,
  detectStack,
  stripCommentsAndStrings,
} = require('../lib/utils');

const RULE_ID = 'raw-body';

function isWebhookFile(filePath, content) {
  if (isWebhookFilePath(filePath)) return true;
  if (!content) return false;
  // Content heuristic: imports payment SDK + has a webhook-looking handler
  if (/stripe\.webhooks\.constructEvent|verifyWompiChecksum|verifyLemonSignature|verifyMpSignature/.test(content)) {
    return true;
  }
  return false;
}

function run(ctx) {
  const { filePath, content, projectDir } = ctx;
  if (!content) return null;
  if (hasIgnoreTag(content, RULE_ID)) return null;
  if (!isWebhookFile(filePath, content)) return null;

  const ext = path.extname(filePath).toLowerCase();
  const stack = detectStack(projectDir);
  const stripped = stripCommentsAndStrings(content);

  // JS / TS files
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    return checkJsRawBody(stripped, stack, filePath);
  }

  // Python files
  if (ext === '.py') {
    return checkPythonRawBody(stripped, filePath);
  }

  // PHP / Ruby — best-effort
  if (ext === '.php') return checkPhpRawBody(stripped, filePath);
  if (ext === '.rb') return checkRubyRawBody(stripped, filePath);

  return null;
}

function checkJsRawBody(stripped, stack, filePath) {
  // Detect Next.js App Router style: export async function POST(request)
  const isNextAppRouter =
    stack === 'nextjs-app-router' ||
    /export\s+async\s+function\s+POST\s*\(\s*request\b/.test(stripped);

  if (isNextAppRouter) {
    // Bad: any of these called BEFORE signature verification.
    // Simpler heuristic: if `request.json()` or `req.json()` appears anywhere in the file
    // and a verifier is also present, the verifier likely fails. Flag it.
    if (/\b(request|req)\.json\s*\(\s*\)/.test(stripped)) {
      return {
        rule: RULE_ID,
        level: 'deny',
        code: 'ERR_RAW_BODY_PARSED',
        message_en: `Next.js App Router webhook handler reads the body as JSON. Signature verification needs raw bytes. Use 'await request.text()' instead. (Rule 5)`,
        message_es: `El handler de webhook (Next.js App Router) lee el body como JSON. La verificación de firma necesita los bytes crudos. Usa 'await request.text()' en lugar. (Regla 5).`,
        suggested_fix:
          `Replace 'await request.json()' with 'await request.text()'. Pass the raw string to the verifier (e.g., stripe.webhooks.constructEvent(rawBody, signature, secret)). If you need the parsed event later, call JSON.parse(rawBody) AFTER verification. Also set 'export const runtime = "nodejs"' on the route.`,
      };
    }
    return null;
  }

  // Express style
  const isExpress =
    stack === 'express' || /\b(app|router)\.post\s*\(/.test(stripped);

  if (isExpress) {
    // Must have express.raw() applied to the webhook route.
    // Simple presence check: stripCommentsAndStrings blanks string literals,
    // so we can't rely on matching 'application/json' inside the option object.
    const hasExpressRaw = /\bexpress\.raw\s*\(/.test(stripped);

    if (!hasExpressRaw) {
      // Check if global express.json() has been used (the danger signal)
      const usesJsonGlobally = /app\.use\s*\(\s*express\.json/.test(stripped);
      // If express.raw is missing AND there's a webhook handler, deny
      return {
        rule: RULE_ID,
        level: 'deny',
        code: 'ERR_RAW_BODY_PARSED',
        message_en: `Express webhook handler is missing express.raw() middleware. Signature verification needs raw bytes. (Rule 5)`,
        message_es: `El handler webhook de Express no tiene el middleware express.raw(). La verificación de firma requiere bytes crudos. (Regla 5).`,
        suggested_fix:
          `Register the route with express.raw before any json middleware:\n` +
          `app.post('/api/webhook/<provider>', express.raw({ type: 'application/json', limit: '256kb' }), handler).\n` +
          `If app.use(express.json()) is registered globally, mount the webhook route BEFORE that line.`,
      };
    }
    return null;
  }

  return null;
}

function checkPythonRawBody(stripped, filePath) {
  // FastAPI / Flask / Django: webhook handler must use request.body() (bytes),
  // not request.json(). isWebhookFile() already confirmed this is a webhook,
  // so seeing `await request.json()` here is sufficient signal to deny.
  if (/await\s+request\.json\s*\(\s*\)/.test(stripped) || /request\.get_json\s*\(\s*\)/.test(stripped)) {
    return {
      rule: RULE_ID,
      level: 'deny',
      code: 'ERR_RAW_BODY_PARSED',
      message_en: `Python webhook handler reads body as JSON via 'await request.json()'. Signature verification needs raw bytes. Use 'await request.body()' instead. (Rule 5)`,
      message_es: `El handler de webhook (Python) lee el body como JSON via 'await request.json()'. La verificación necesita bytes crudos. Usa 'await request.body()'. (Regla 5).`,
      suggested_fix:
        `Replace 'await request.json()' with 'await request.body()' (returns bytes). Decode and parse AFTER signature verification.`,
    };
  }
  return null;
}

function checkPhpRawBody(stripped, filePath) {
  // Laravel: $request->getContent() vs $request->all()
  if (/\$request->all\s*\(\s*\)/.test(stripped) && /Stripe-Signature|x-signature|X-Signature/i.test(stripped)) {
    return {
      rule: RULE_ID,
      level: 'deny',
      code: 'ERR_RAW_BODY_PARSED',
      message_en: `Laravel webhook handler uses $request->all() which returns parsed data. Use $request->getContent() for raw body. (Rule 5)`,
      message_es: `El handler de webhook (Laravel) usa $request->all() que devuelve data parseada. Usa $request->getContent() para body crudo. (Regla 5).`,
      suggested_fix: `Replace $request->all() with $request->getContent() and pass the raw string to the verifier.`,
    };
  }
  return null;
}

function checkRubyRawBody(stripped, filePath) {
  if (/params\.\w+/.test(stripped) && /Stripe-Signature|x-signature|X-Signature/i.test(stripped)) {
    return {
      rule: RULE_ID,
      level: 'warn',
      code: 'ERR_RAW_BODY_PARSED',
      message_en: `Rails webhook handler may be using params (parsed). Use request.raw_post for HMAC verification. (Rule 5)`,
      message_es: `El handler de webhook (Rails) puede estar usando params (parseado). Usa request.raw_post para verificación HMAC. (Regla 5).`,
      suggested_fix: `Read request.raw_post in your controller action and pass that to the verifier.`,
    };
  }
  return null;
}

module.exports = { run, RULE_ID };
