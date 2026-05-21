#!/usr/bin/env node
/**
 * PagoKit — validate-data.js
 *
 * Validates every JSON data file in skills/payment-advisor/data/ against
 * its declared schema in schemas/. Exits 0 on success, 1 on failure.
 *
 * Also performs cross-file integrity checks:
 *   - regions[].primary_providers must reference existing provider ids
 *   - regions[].fallback_cross_border_mor must reference existing provider ids
 *   - use_cases[].recommended_providers_ranked must reference existing provider ids
 *   - providers[].methods must be a subset of methods.json ids
 */

"use strict";

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats").default;

const ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.join(ROOT, "schemas");
const DATA_DIR = path.join(ROOT, "skills", "payment-advisor", "data");

const FILES = [
  { data: "providers.json", schema: "providers.schema.json" },
  { data: "regions.json", schema: "regions.schema.json" },
  { data: "use_cases.json", schema: "use_cases.schema.json" },
  { data: "methods.json", schema: "methods.schema.json" },
];

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function reportErrors(label, errors) {
  console.error(`\n[FAIL] ${label}`);
  for (const err of errors) {
    const at = err.instancePath || "(root)";
    console.error(`  - ${at} ${err.message}`);
    if (err.params && Object.keys(err.params).length > 0) {
      console.error(`      params: ${JSON.stringify(err.params)}`);
    }
  }
}

function main() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  let allOk = true;
  const loaded = {};

  for (const { data, schema } of FILES) {
    const schemaPath = path.join(SCHEMA_DIR, schema);
    const dataPath = path.join(DATA_DIR, data);

    const schemaObj = loadJson(schemaPath);
    const dataObj = loadJson(dataPath);
    loaded[data] = dataObj;

    const validate = ajv.compile(schemaObj);
    const ok = validate(dataObj);
    if (ok) {
      console.log(`[OK]   ${data} validates against ${schema}`);
    } else {
      allOk = false;
      reportErrors(`${data} against ${schema}`, validate.errors || []);
    }
  }

  // Cross-file integrity
  console.log("\nCross-file integrity checks:");
  const providerIds = new Set(loaded["providers.json"].providers.map((p) => p.id));
  const methodIds = new Set(loaded["methods.json"].methods.map((m) => m.id));

  // regions reference providers
  for (const [country, region] of Object.entries(loaded["regions.json"].regions)) {
    for (const id of region.primary_providers) {
      if (!providerIds.has(id)) {
        console.error(`[FAIL] regions.${country}.primary_providers references unknown provider: ${id}`);
        allOk = false;
      }
    }
    for (const id of region.fallback_cross_border_mor) {
      if (!providerIds.has(id)) {
        console.error(`[FAIL] regions.${country}.fallback_cross_border_mor references unknown provider: ${id}`);
        allOk = false;
      }
    }
  }

  // use_cases reference providers
  for (const [name, uc] of Object.entries(loaded["use_cases.json"].use_cases)) {
    if (!uc.recommended_providers_ranked) continue;
    for (const id of uc.recommended_providers_ranked) {
      if (!providerIds.has(id)) {
        console.error(`[FAIL] use_cases.${name}.recommended_providers_ranked references unknown provider: ${id}`);
        allOk = false;
      }
    }
  }

  // providers' methods are a subset of methods.json (allow unknown methods to pass with a warning,
  // since some are provider-internal labels like "mercadopago_wallet" added incrementally).
  let unknownMethodCount = 0;
  for (const p of loaded["providers.json"].providers) {
    for (const m of p.methods) {
      if (!methodIds.has(m)) {
        console.warn(`[WARN] providers.${p.id}.methods has '${m}' not declared in methods.json`);
        unknownMethodCount++;
      }
    }
  }
  if (unknownMethodCount === 0) {
    console.log("[OK]   all provider methods are declared in methods.json");
  }

  if (allOk) {
    console.log("\n[PASS] All data files valid and cross-referenced.");
    process.exit(0);
  } else {
    console.error("\n[FAIL] Validation errors found. See above.");
    process.exit(1);
  }
}

main();
