# unit-workflow overrides

<!-- Plain-language rules for this layer. Keep each section short: worker sections are added to every matching prompt.
     Delete the sections you do not need. Headings must match exactly. -->

## Foreman

<!-- Read only by the main session. Good for: deploy steps, migration steps, where the dev server runs,
     which ports are off limits, when to stop and ask, local paths for the status command or dashboard. -->

- Deploy only after the suite passes on main: <your deploy command>.
- Apply pending migrations before deploying: <your migration command>.

## All workers

<!-- Added to every worker prompt. Good for: project rules every agent must follow. -->

- Never use ports 3000 or 5173; the owner's dev servers run there.
- Every decision gets a row in docs/decisions.csv.

## Role: walk

<!-- Added only to the screen-walk agent. Other roles: port, fix, verify1, verify2, merge, suite, review. -->

- Sign in with the seeded test user from scripts/seed.ts; walk at 375x812 and 1440x900.
