# Contract: billing provider webhooks, idempotent

Module `15-billing-webhooks` · risky (money, external door) · status in `docs/plan/ledger.md`. Report schema: `{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[], handoff?, escalate?}`.

## Purpose
The owner, 2026-03-03: "When the payment provider retries a webhook, we sometimes add a second seat. Make it safe to receive the same event twice."

## Owns
- `src/api/webhooks/billing.ts:18-64`: the cause is that `handleEvent` applies the change before recording the event id. Record `event.id` in `processed_events` inside the same transaction as the change; a repeat id returns 200 and does nothing.
- `db/migrations/0042_processed_events.sql` (new): table with a unique key on `(provider, event_id)`.
- The signature check stays first and unchanged (`src/api/webhooks/verify.ts`).
- Do NOT edit: `src/board/*` (unit 12 owns it).
- Tests: Vitest for duplicate delivery, out-of-order delivery and a bad signature.

## Reference slice (copy from, do not explore further)
- `src/db/tx.ts:5-30` transaction helper
- `src/api/webhooks/billing.test.ts:1-40` fixture events

## Dependencies
None; migrations: 0042 (pre-assigned); env: none new.

## Acceptance test
`npm run typecheck`; `npx vitest run src/api/webhooks --reporter=dot`; `npm run lint`.
