# unit-workflow overrides: Tasklane (example)

## Foreman

- Deploy only after the suite passes on main: `npm run migrate && npm run deploy`.
- The owner's dev server runs on port 3000; never stop it.
- Stop and ask before any change to pricing or plan limits.

## All workers

- Never use ports 3000 or 5432; start your own servers on the ports your brief names.
- Every decision gets a row in docs/decisions.csv (id, date, decision, why).

## Role: walk

- Sign in as the seeded user from scripts/seed.ts; the demo board is /board/demo.

## Role: verify2

- For billing units, also confirm every webhook path checks the signature before anything else.
