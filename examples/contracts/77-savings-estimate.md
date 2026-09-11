# Contract: savings estimate — the star of the sandbox

Module `77-savings-estimate` · medium risk (Bedrock inference, sandbox only) · status in `docs/plan/ledger.md`. Report schema: `{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[]}`.

## Purpose
Michael 2026-09-10: "One of the biggest missing pieces is tying all this back to a value. Once the user has uploaded data, we want to offer a range of savings. It doesn't need to be super mathematically accurate. If their chicken is 10% overpriced, use that to infer a range of percentage savings, for example 10% of your food cost. Use some intelligence there. The idea is to entice them to create an account and see what they could save. We don't want to show them all of the math because then they would just use the sandbox and never sign up. That percentage savings at the top of the page must be the star of the show and a call to action."

## Owns
- `lib/sandbox/savings.ts` (new): `estimateSavings(ctx)` returns `{lowPct, highPct, lowDollarsPerMonth, highDollarsPerMonth, confidence: "low"|"medium"|"high", drivers: Array<{kind, count, teaser}>, basis: {invoices, lineItems, spend, days}}`. Signals, each optional so the estimate works with invoices alone:
  1. **Market price gap**: for the top-spend line items, compare unit price with a benchmark. Get benchmarks from ONE Bedrock call per sandbox (model via lib/assistant/model-ids.ts capability map, through the lib/bedrock single-function rule): send item names, pack/unit, region "Texas" (from the org's primary location timezone/state when known), month; ask for a typical distributor price range per unit and a confidence. Cache the result on the org (jsonb column `sandbox_savings` via migration 0135, with `computed_at`) so re-renders are free; recompute only when new documents finish.
  2. **Vendor divergence**: the same product bought from two vendors at different prices (lib/data/insights.ts compareVendorPrices) — the cheaper price applied to the volume is realisable savings.
  3. **Menu margin**: menu items whose estimated or recipe plate cost gives a food-cost share above 35% (from lib/sandbox/insights.ts) — count them as pricing opportunities (contributes to the high end only).
  4. **Anomalies**: invoice anomaly notes (duplicate charges, total mismatches) count as recoverable dollars where the note carries an amount.
  Combine into a range: low = market gap on the clearly-over items only (weight 0.5) + vendor divergence; high = market gap on all over items + divergence + a pricing uplift bounded at 3 points of food cost. Express as percent of the observed spend and as dollars per month by scaling observed spend to 30 days (basis.days from the invoice date span, minimum 7). Clamp to 3–18%. If nothing is over benchmark, still return a floor range (3–5%, confidence low) with drivers explaining "your prices look sharp; the savings here are in waste and menu pricing".
- Presentation (`components/try/savings-hero.tsx`, mounted at the TOP of the sandbox page above the drop zone once at least one invoice is approved or in review): the range counts up big ("You could be saving 7–12% on food cost — about $1,900 to $3,300 a month"), one line of why in journey voice, driver chips that TEASE without disclosing ("3 items priced above market", "2 vendors selling you the same chicken", "4 menu items under-priced") with a lock glyph, and ONE gold CTA "See exactly where — start your trial" (calls the existing convertSandbox) plus the booking link. Never show the per-item math, the benchmarks, or which items. Uses the 74 paint tokens for the chips; gold only on the CTA. Reduced-motion: no count-up. Mobile: sticky compact bar with the range and CTA.
- The existing payoff keeps its cards but the costliest-lines and plate-cost tables become partially blurred after the first two rows in sandbox mode with a "start your trial to see all" overlay — the same enticement rule.
- Recompute trigger: when the SSE feed reports a document reaching review/approved, the page calls a server action `refreshSavings` (rate-limited to once per 30 s per org) and the hero updates.
- Do NOT edit: lib/jobs, lib/sales-pipeline, lib/sandbox/start.ts|convert.ts|limits*, components/try/walkthrough.tsx (a separate fix is running), components/shell.
- Tests: Vitest for estimateSavings with fixture inputs (invoices only; invoices + two vendors; menu present; nothing over benchmark -> floor range; clamps; days scaling), Bedrock mocked from test/fixtures/bedrock; savings-hero renders range and never renders item names; Playwright: sandbox with fixtures shows the hero after processing and the CTA calls convert. `pnpm verify:rls` green (new column on organizations is org-scoped).

## Reference slice (copy from, do not explore further)
- lib/sandbox/insights.ts (427 lines: payoff loaders and estimatePlateCosts; copy its Bedrock call and caching pattern), app/(app)/sandbox/page.tsx, payoff-action.ts, components/try/payoff.tsx, count-up.tsx
- lib/data/insights.ts:210 compareVendorPrices; lib/data/vendor-analytics.ts:63 spendingAnalysis; lib/data/analytics.ts:80 getPurchasesSeries
- lib/ingestion/auto-approve.ts:37-40 anomaly notes shape; documents.review_notes / anomaly columns via lib/db/schema
- lib/assistant/model-ids.ts capability map; lib/bedrock/* single function; test/fixtures/bedrock/*
- db/migrations/0132_sandbox_insights.sql (the pattern for a cached jsonb on organizations; latest migration is 0134, use 0135)
- lib/sandbox/convert.ts:53-59 convertSandbox (the CTA target); components/marketing/cal-modal.tsx for the booking link
- app/globals.css paint tokens (74); D-29/D-30/D-34 design rules

## Dependencies
73, 74 merged; migrations: 0135; env: none.

## Acceptance test
`pnpm typecheck`; `pnpm vitest run test/unit/sandbox* test/unit/try* --reporter=dot`; `pnpm verify`; Playwright sandbox walk on the dev server with fixtures; screenshots of the hero (desktop + mobile) to the scratchpad. Do not restart the dev server; stop any server you start.
