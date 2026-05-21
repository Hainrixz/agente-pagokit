#!/usr/bin/env node
/**
 * PagoKit — generate-coverage.js
 *
 * Renders docs/COVERAGE.md from skills/payment-advisor/data/regions.json
 * + providers.json. Run after editing either data file.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "skills", "payment-advisor", "data");
const OUT_FILE = path.join(ROOT, "docs", "COVERAGE.md");

const LATAM_CODES = new Set([
  "MX", "GT", "BZ", "SV", "HN", "NI", "CR", "PA",
  "CU", "DO", "PR", "HT", "JM",
  "CO", "VE", "EC", "PE", "BO", "BR", "PY", "UY", "AR", "CL"
]);

const COUNTRY_NAMES = {
  AR: "Argentina", AU: "Australia", BO: "Bolivia", BR: "Brazil",
  CA: "Canada", CL: "Chile", CO: "Colombia", CR: "Costa Rica",
  CU: "Cuba", DE: "Germany", DO: "Dominican Republic", EC: "Ecuador",
  ES: "Spain", FR: "France", GT: "Guatemala", HK: "Hong Kong",
  HN: "Honduras", IN: "India", IR: "Iran", IT: "Italy",
  JP: "Japan", KP: "North Korea", MM: "Myanmar", MX: "Mexico",
  NG: "Nigeria", NI: "Nicaragua", NL: "Netherlands", NZ: "New Zealand",
  PA: "Panama", PE: "Peru", PR: "Puerto Rico", PT: "Portugal",
  PY: "Paraguay", RU: "Russia", SG: "Singapore", SV: "El Salvador",
  SY: "Syria", UK: "United Kingdom", US: "United States", UY: "Uruguay",
  VE: "Venezuela", ZA: "South Africa"
};

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function providerPhase(providerId, providersById) {
  const p = providersById[providerId];
  if (!p) return "TBD";
  return String(p.phase);
}

function formatProvidersCell(ids, providersById) {
  if (!ids.length) return "—";
  return ids
    .map((id) => {
      const p = providersById[id];
      const name = p ? p.name : id;
      const phase = providerPhase(id, providersById);
      return `${name} (P${phase})`;
    })
    .join(" · ");
}

function renderTable(rows) {
  const header = "| Country | Code | Primary providers | Fallback MoR |";
  const sep = "|---|---|---|---|";
  const body = rows
    .map(
      ([country, code, primary, fallback]) =>
        `| ${country} | \`${code}\` | ${primary} | ${fallback} |`
    )
    .join("\n");
  return [header, sep, body].join("\n");
}

function renderUnsupportedTable(rows) {
  const header = "| Country | Code | Reason | Comment |";
  const sep = "|---|---|---|---|";
  const body = rows
    .map(
      ([country, code, reason, comment]) =>
        `| ${country} | \`${code}\` | \`${reason}\` | ${comment} |`
    )
    .join("\n");
  return [header, sep, body].join("\n");
}

function main() {
  const regions = loadJson(path.join(DATA_DIR, "regions.json")).regions;
  const providers = loadJson(path.join(DATA_DIR, "providers.json")).providers;
  const providersById = Object.fromEntries(providers.map((p) => [p.id, p]));

  const latamRows = [];
  const globalRows = [];
  const unsupportedRows = [];

  const sortedCodes = Object.keys(regions).sort();
  for (const code of sortedCodes) {
    const r = regions[code];
    const name = COUNTRY_NAMES[code] || code;
    if (r.unsupported) {
      unsupportedRows.push([name, code, r.reason || "other", r.comment || ""]);
      continue;
    }
    const primary = formatProvidersCell(r.primary_providers, providersById);
    const fallback = formatProvidersCell(r.fallback_cross_border_mor, providersById);
    if (LATAM_CODES.has(code)) {
      latamRows.push([name, code, primary, fallback]);
    } else {
      globalRows.push([name, code, primary, fallback]);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const totalActive = latamRows.length + globalRows.length;

  const md = `# Country × Provider coverage

> Auto-generated from \`skills/payment-advisor/data/regions.json\` and \`skills/payment-advisor/data/providers.json\`.
> Run \`npm run generate:coverage\` to regenerate. Last generated: ${today}.

Phase suffix on each provider indicates the roadmap phase in which the integration ships:
**P1** shipped · **P2** LATAM core · **P3** Global core · **P4** Marketplace + ops · **TBD** announced but not yet documented.

**Totals:** ${totalActive} supported countries · ${unsupportedRows.length} unsupported · ${providers.length} providers documented.

---

## LATAM (${latamRows.length} countries)

${renderTable(latamRows)}

---

## Global (${globalRows.length} countries)

${renderTable(globalRows)}

---

## Unsupported (${unsupportedRows.length} countries)

Sanctioned or otherwise blocked. PagoKit advisor will refuse to recommend a provider here.

${renderUnsupportedTable(unsupportedRows)}
`;

  fs.writeFileSync(OUT_FILE, md);
  console.log(`[OK] Wrote ${path.relative(ROOT, OUT_FILE)} (${latamRows.length} LATAM · ${globalRows.length} global · ${unsupportedRows.length} unsupported)`);
}

main();
