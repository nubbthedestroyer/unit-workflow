# Contract: <title>

Module `NN-<key>` · status in `plan/ledger.md` · decision D-xx (if any). Report schema: `{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[]}`.

## Purpose
<the owner's words, date, screenshot context.>

## Owns
- <file or feature>: <exact behavior>. Keep aria-labels and test ids.
- Do NOT edit: <files owned by concurrently running units>.
- Tests: <unit tests>. Screens are checked by the walk agent, not the builder.
- For each item: the cause at <path:line> and the intended change, so the builder does not explore.

## Reference slice (copy from, do not explore further)
- <path:lines> purpose

## Dependencies
<units merged first>; migrations: <pre-assigned numbers or none>; env: none.

## Walk (UI units only; the walk agent checks exactly this)
- <route> at <viewport>: <what must be true>. Ports: api <port>, web <port>. Shots to <folder>.

## Acceptance test
`pnpm typecheck`; `pnpm vitest run <dirs> --reporter=dot`; `pnpm verify`. No browser here; screens go in Walk.
