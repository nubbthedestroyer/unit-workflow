# Contract: <title>

Module `NN-<key>` · status in `plan/ledger.md` · decision D-xx (if any). Report schema: `{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[]}`.

## Purpose
<Michael's words, date, screenshot context.>

## Owns
- <file or feature>: <exact behavior>. Keep aria-labels and test ids.
- Do NOT edit: <files owned by concurrently running units>.
- Tests: <unit tests>; Playwright on the running dev server via dev quick sign-in.

## Reference slice (copy from, do not explore further)
- <path:lines> purpose

## Dependencies
<units merged first>; migrations: <pre-assigned numbers or none>; env: none.

## Acceptance test
`pnpm typecheck`; `pnpm vitest run <dirs> --reporter=dot`; `pnpm verify`; Playwright <route> ; screenshot to the scratchpad. Do not restart the dev server.
