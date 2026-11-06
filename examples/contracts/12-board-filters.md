# Contract: board filters by assignee and label

Module `12-board-filters` · status in `docs/plan/ledger.md` · decision D-04. Report schema: `{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[], handoff?, escalate?}`.

## Purpose
The owner, 2026-03-02: "On a busy board I can't find my own cards. Let me filter by assignee and by label, and keep the filter when I come back."

## Owns
- `src/board/filter-bar.tsx` (new): two multi-select menus (Assignee, Label) above the columns and a Clear link. Keep the existing `data-testid` values on the board.
- `src/board/use-board-filters.ts` (new): filter state in the URL query (`?assignee=&label=`), so a reload or a shared link keeps it.
- `src/board/board.tsx:40-72`: the cause of the complaint is that columns render every card from `cards`. Apply the filter there and show "3 of 12" in each column header when a filter is on.
- Do NOT edit: `src/api/*`, `src/billing/*` (unit 15 owns them).
- Tests: Vitest for `use-board-filters` (parse, serialize, unknown ids dropped). Screens are checked by the walk agent, not the builder.

## Reference slice (copy from, do not explore further)
- `src/board/sort-menu.tsx:1-80` menu pattern and keyboard handling
- `src/lib/query-state.ts:10-45` URL query helpers

## Dependencies
Unit 11 merged; migrations: none; env: none.

## Walk (UI units only; the walk agent checks exactly this)
- `/board/demo` at 375x812 and 1440x900: filter by one assignee; only their cards show; headers read "n of m".
- Reload: the filter is still on. Clear: every card is back.

## Acceptance test
`npm run typecheck`; `npx vitest run src/board --reporter=dot`; `npm run lint`. No browser here; screens go in Walk.
