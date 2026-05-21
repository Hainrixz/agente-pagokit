# Country × Provider coverage

> Auto-generated from `skills/payment-advisor/data/regions.json` and `skills/payment-advisor/data/providers.json`.
> Run `npm run generate:coverage` to regenerate. Last generated: 2026-05-21.

Phase suffix on each provider indicates the roadmap phase in which the integration ships:
**P1** shipped · **P2** LATAM core · **P3** Global core · **P4** Marketplace + ops · **TBD** announced but not yet documented.

**Totals:** 36 supported countries · 6 unsupported · 4 providers documented.

---

## LATAM (19 countries)

| Country | Code | Primary providers | Fallback MoR |
|---|---|---|---|
| Argentina | `AR` | Mercado Pago (P1) | Lemon Squeezy (P1) |
| Bolivia | `BO` | — | Lemon Squeezy (P1) |
| Brazil | `BR` | Mercado Pago (P1) · Stripe (P1) | Lemon Squeezy (P1) |
| Chile | `CL` | Mercado Pago (P1) | Lemon Squeezy (P1) |
| Colombia | `CO` | Wompi (P1) · Mercado Pago (P1) | Lemon Squeezy (P1) |
| Costa Rica | `CR` | — | Lemon Squeezy (P1) |
| Dominican Republic | `DO` | — | Lemon Squeezy (P1) |
| Ecuador | `EC` | — | Lemon Squeezy (P1) |
| Guatemala | `GT` | — | Lemon Squeezy (P1) |
| Honduras | `HN` | — | Lemon Squeezy (P1) |
| Mexico | `MX` | Mercado Pago (P1) · Stripe (P1) | Lemon Squeezy (P1) |
| Nicaragua | `NI` | — | Lemon Squeezy (P1) |
| Panama | `PA` | — | Lemon Squeezy (P1) |
| Peru | `PE` | Mercado Pago (P1) | Lemon Squeezy (P1) |
| Puerto Rico | `PR` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| Paraguay | `PY` | — | Lemon Squeezy (P1) |
| El Salvador | `SV` | — | Lemon Squeezy (P1) |
| Uruguay | `UY` | Mercado Pago (P1) | Lemon Squeezy (P1) |
| Venezuela | `VE` | — | Lemon Squeezy (P1) |

---

## Global (17 countries)

| Country | Code | Primary providers | Fallback MoR |
|---|---|---|---|
| Australia | `AU` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| Canada | `CA` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| Germany | `DE` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| Spain | `ES` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| France | `FR` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| Hong Kong | `HK` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| India | `IN` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| Italy | `IT` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| Japan | `JP` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| Nigeria | `NG` | Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| Netherlands | `NL` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| New Zealand | `NZ` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| Portugal | `PT` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| Singapore | `SG` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| United Kingdom | `UK` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| United States | `US` | Stripe (P1) · Lemon Squeezy (P1) | Lemon Squeezy (P1) |
| South Africa | `ZA` | Lemon Squeezy (P1) | Lemon Squeezy (P1) |

---

## Unsupported (6 countries)

Sanctioned or otherwise blocked. PagoKit advisor will refuse to recommend a provider here.

| Country | Code | Reason | Comment |
|---|---|---|---|
| Cuba | `CU` | `sanctions:OFAC` | Cuba: OFAC SDN. US persons restricted. |
| Iran | `IR` | `sanctions:OFAC` | Iran: OFAC SDN. |
| North Korea | `KP` | `sanctions:OFAC` | North Korea: OFAC SDN. |
| Myanmar | `MM` | `sanctions:multilateral` | Myanmar: limited US/EU sanctions post-2021. |
| Russia | `RU` | `sanctions:multilateral` | Russia: EU/US/UK sanctions. No active provider operates. |
| Syria | `SY` | `sanctions:OFAC` | Syria: OFAC SDN. |
