# Contract: try-it flow v2 (continuous uploads, recipes, counters, next step) + jobs push fixes

Module `73-try-flow-v2` · risky (jobs/infra, ingestion) · status in `docs/plan/ledger.md`. Report schema: `{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[]}`.

## Purpose
Michael 2026-09-10, first real /try run on production: "after I upload invoices, I'm not able to click Choose Files or drag more in. I should be able to upload a group of images, then maybe go download my menu and bring it back. This should continue to be active. There should be a next step button, and a directive at the top that shows how many invoices, invoice items, products, and recipes (menu items) have been extracted." And: "prompt the user to upload recipes alongside invoices and menus. If they have a recipe book, or would prefer to dump it in as text, prompt them to do that." His documents also sat in queued: Fable traced two production defects in the jobs push path (below).

## Owns
### A. Jobs push path (infra + code)
- scripts/aws/jobs-queue.sh: the pipe target InputTemplate must be `<aws.pipes.event>` (NOT `.json`, which the API rejects as an invalid placeholder) (Fable applied this live on 2026-09-10 with `aws pipes update-pipe`; the old `<$.body>` rendered the JSON body with unquoted keys and every delivery answered 200 `noop: unparseable body`, so only the 15-minute cron ever ran jobs). Update the script to match and add a comment with the trace finding. Keep the pipe log configuration (CloudWatch group /aws/pipes/platecost-jobs-pipe, TRACE) in the script as optional (`PIPE_LOGS=1`).
- lib/jobs/sqs-message.ts parseJobMessage: add a Vitest fixture for the exact Pipes event array shape (`[{messageId, body: "<json string>", eventSource: "aws:sqs", ...}]`) and for the SNS-in-SQS Textract shape, asserting both resolve; keep the noop path for garbage.
- lib/jobs/enqueue.ts enqueueJob: only notifyJob when the insert actually created the job (idempotent duplicate returns the existing row; publishing for it caused a 378-message storm in 3 minutes while a browser polled `app/api/documents/[id]/pages/route.ts`). Expose `created: boolean` from PgJobQueue.enqueue (ON CONFLICT DO NOTHING already distinguishes) or compare ids. Also stop the pages route from re-enqueueing on every poll: enqueue once per document per 60s (in-memory map keyed by documentId, or check for an existing queued/running render job first).
- docs/jobs/README.md: document the template fix, the storm, and how to read the pipe trace log.

### B. Sandbox flow v2 (app)
- Limits (lib/sandbox/limits-constants.ts): raise to 40 files per sandbox and 2 menus, no kind cap on invoices; keep per-email/IP starts. Images of a menu may be several photos: allow multiple `menu` documents.
- components/try/drop-zone.tsx + sandbox-experience.tsx: the drop zone stays active after every batch (no disabled state until the file cap); "choose files" always works; each batch appends cards; a persistent top strip ("directive") that counts live: invoices read, line items, products matched, menu items, recipes; numbers count up as documents finish (reuse count-up.tsx and the SSE feed). A "Next step" button appears once at least one invoice is done: scrolls to (or reveals) the payoff; the payoff also re-renders as more documents finish (already streams per document).
- Recipes intake: a third card in the drop zone header row: "Have recipes? Add them too" with two doors: upload (photos/PDF of a recipe book) and "paste as text" (a textarea, one recipe per block). Files go through the existing presign/complete with kind `recipe` (add `recipe` to documentKindSchema, classify prompt, and the documents_kind_check via migration 0134; pipeline branch like menu: extract with a new `lib/ingestion/extract-recipes.ts` + `RECIPE_PROMPT` in lib/ingestion/prompt.ts, persisting recipes + ingredients through lib/actions/recipes.ts createRecipe/addRecipeIngredient equivalents at the data layer, ingredients matched to catalog items by name where possible, unmatched left as free-text lines). Pasted text goes to a server action `importRecipeText` that runs the same extraction on the text (no OCR) and persists the same way. Sandbox and normal orgs both get this door (documents page upload dialog gets the `recipe` kind too, minimal UI).
- Payoff: menu items with a real recipe (from the intake) show the computed plate cost (not the estimate) with a "from your recipe" chip; estimates remain for the rest.
- Do NOT edit: components/try visual styling beyond what the new elements need (unit 74 owns the palette), components/shell/sandbox-sidebar.tsx, lib/sales-pipeline.
- Tests: Vitest for parseJobMessage fixtures, enqueueJob notify-once, pages-route enqueue throttle, limits, recipe extraction (mocked Bedrock fixture in test/fixtures/bedrock), importRecipeText; Playwright: two upload batches in a row, counters update, recipe text paste creates recipes, Next step reveals payoff. `pnpm verify:rls` green.

## Reference slice (copy from, do not explore further)
- scripts/aws/jobs-queue.sh (pipe creation block); app/api/jobs/run-one/route.ts:44-120; lib/jobs/sqs-message.ts:1-90; lib/jobs/enqueue.ts:40-70; lib/jobs/pg-queue.ts:140-175 (ON CONFLICT insert); app/api/documents/[id]/pages/route.ts:20-45
- lib/sandbox/limits-constants.ts, lib/sandbox/limits.ts, lib/storage/files.ts:90-140 presign cap hook, :300-350 completeUpload
- components/try/* (drop-zone, stage-rail, payoff, count-up, sandbox-experience, use-page-thumbs); app/(app)/sandbox/page.tsx, actions.ts, payoff-action.ts; lib/sandbox/insights.ts
- lib/schemas/storage.ts:19-24 kind enum; db/migrations/0023_order_guides.sql:31-34 kind check pattern (latest migration is 0133; use 0134)
- lib/ingestion/prompt.ts:29-65 (INVOICE/MENU prompts), lib/ingestion/extract-menu.ts:47, lib/ingestion/pipeline.ts:168-179 dispatch, :401-417 menu branch, :509-520 menu persist
- lib/actions/recipes.ts:51 createRecipe, :370 addRecipeIngredient; lib/schemas/recipes.ts:25-61
- lib/documents/use-document-progress.ts; app/api/documents/stream

## Dependencies
72 merged; migrations: 0134; env: none. Infra: Fable already applied the live pipe template; the script change is code only.

## Acceptance test
`pnpm typecheck`; `pnpm vitest run test/unit/jobs* test/unit/sandbox* test/unit/try* test/unit/ingestion* --reporter=dot`; `pnpm verify`; Playwright sandbox walk on the dev server with test/fixtures (menu, sysco, usfoods, plus a pasted recipe); screenshots to the scratchpad. Do not restart the dev server; stop any server you start.
