export const meta = {
  name: 'unit-workflow',
  description: 'E2E round 2 under rules v2: per-unit worktree, Opus 5.5 workers (Fable orchestrates), Tier 2 verify for risky units, sequential merges, one integration pass',
  phases: [
    { title: 'Port', detail: 'Opus 5.5 edit per unit in its own worktree (cap 60 calls)' },
    { title: 'Tier 1', detail: 'Opus 5.5: acceptance commands, typecheck, gates (cap 20); fix round on failure (cap 30), max 2' },
    { title: 'Tier 2', detail: 'Opus 5.5 refute-only pass for risky units after Tier 1 passes (cap 20)' },
    { title: 'Merge', detail: 'Opus 5.5, sequential, unit tests only, then one full suite (cap 15)' },
    { title: 'Integration', detail: 'Opus 5.5 runs the suite on main and reviews failures against source' },
  ],
}
const PLAN = '/absolute/path/to/your-repo/docs/plan'   // edit me
const TARGET = '/absolute/path/to/your-repo'          // edit me
const UNITS = args && args.units ? args.units : []   // [{key, risky, brief, contract}]
const SHARED = 'Project build. Repo ' + TARGET + '. Plan ' + PLAN + ' (architecture.md sections 4 and 6, contracts/<unit>.md). Rules: work only in your own worktree ' + TARGET + '/.worktrees/<unit> on branch unit/<unit> from origin/main; batch shell commands; write each file once; vitest --reporter=dot; pipe output over 40 lines through tail -40; open only files you must change or lines the contract cites; never re-read a file; skip pnpm build (runs at merge); never write a secret; commit with trailer Co-Authored-By: Claude <noreply@anthropic.com> and push your branch. Update your unit row in ' + PLAN + '/ledger.md; ledgerUpdated=true. Return ONLY the structured result; no code, no diffs, one sentence per item. '
const REPORT = { type: 'object', properties: { status: { type: 'string', enum: ['done', 'partial', 'blocked'] }, findings: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'number' }, note: { type: 'string' } }, required: ['path', 'line', 'note'] } }, changed: { type: 'array', items: { type: 'string' } }, verified: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, pass: { type: 'boolean' } }, required: ['cmd', 'pass'] } }, ledgerUpdated: { type: 'boolean' }, blockers: { type: 'array', items: { type: 'string' } } }, required: ['status', 'findings', 'changed', 'verified', 'ledgerUpdated', 'blockers'] }
const VERDICT = { type: 'object', properties: { verdict: { type: 'string', enum: ['verified', 'refuted', 'blocked'] }, findings: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'number' }, note: { type: 'string' } }, required: ['path', 'line', 'note'] } }, verified: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, pass: { type: 'boolean' } }, required: ['cmd', 'pass'] } }, ledgerUpdated: { type: 'boolean' } }, required: ['verdict', 'findings', 'verified', 'ledgerUpdated'] }

// Workers pin Opus 5.5; the orchestrator (the main session) stays on Fable
const WORKER_MODEL = 'claude-opus-5-5'

// Opus concurrency cap of 3
let opusRunning = 0; const opusWaiters = []
const opusAcquire = () => new Promise(r => { if (opusRunning < 3) { opusRunning++; r() } else opusWaiters.push(r) })
const opusRelease = () => { opusRunning--; const w = opusWaiters.shift(); if (w) { opusRunning++; w() } }
const opus = async (prompt, opts) => { await opusAcquire(); try { return await agent(prompt, { ...opts, model: WORKER_MODEL }) } finally { opusRelease() } }

const tier1 = (u, round) => agent(SHARED + 'You are verify1:' + u.key + ' round ' + round + ' (cap 20 calls). In the worktree run pnpm typecheck, pnpm verify, and every command in the Acceptance test of ' + PLAN + '/contracts/' + u.contract + '. Confirm the result schema and that the ledger row was updated. Refute only on a failing command or a missing Owns item.', { label: 'verify1:' + u.key, phase: 'Tier 1', model: WORKER_MODEL, effort: 'low', agentType: 'general-purpose', schema: VERDICT })

const results = await pipeline(UNITS,
  (u) => opus(SHARED + 'You are port:' + u.key + ' (cap 60 calls). Unit brief: ' + u.brief + ' Contract: ' + PLAN + '/contracts/' + u.contract + '. Implement fully and write the acceptance tests; run pnpm typecheck and those tests only.', { label: 'port:' + u.key, phase: 'Port', effort: 'medium', agentType: 'general-purpose', schema: REPORT }),
  async (port, u) => {
    if (!port) return { u, verdict: 'blocked' }
    let v = await tier1(u, 1); let rounds = 0
    while (v && v.verdict === 'refuted' && rounds < 2) {
      rounds++
      log('ledger: ' + u.key + ' fix round ' + rounds)
      await opus(SHARED + 'You are fix:' + u.key + '-' + rounds + ' (cap 30 calls). Fix exactly these Tier 1 findings then re-run the failing commands: ' + v.findings.map(f => f.path + ':' + f.line + ' ' + f.note).join('; '), { label: 'fix:' + u.key + '-' + rounds, phase: 'Tier 1', effort: 'medium', agentType: 'general-purpose', schema: REPORT })
      v = await tier1(u, rounds + 1)
    }
    log(u.key + ': tier1 ' + (v ? v.verdict : 'null') + ' after ' + rounds + ' fix rounds')
    if (v && v.verdict === 'verified' && u.risky) {
      const v2 = await opus(SHARED + 'You are verify2:' + u.key + ' (cap 20 calls, refute-only, never edit). Walk Owns of ' + PLAN + '/contracts/' + u.contract + ' via git diff --stat origin/main...HEAD in the worktree; do not reinstall or run the full suite. Refute ONLY for a failing gate, a missing or stubbed Owns item, or a security/tenancy defect; record anything else as a nonblocking: ledger line and still return verified.', { label: 'verify2:' + u.key, phase: 'Tier 2', effort: 'high', agentType: 'general-purpose', schema: VERDICT })
      log(u.key + ': tier2 ' + (v2 ? v2.verdict : 'null'))
      return { u, verdict: v2 ? v2.verdict : 'blocked' }
    }
    return { u, verdict: v ? v.verdict : 'blocked' }
  })

phase('Merge')
const merged = []
for (const r of results.filter(Boolean)) {
  if (r.verdict !== 'verified') { log(r.u.key + ': not merged (' + r.verdict + ')'); continue }
  const m = await agent(SHARED + 'You are merge:' + r.u.key + ' (cap 15 calls). In ' + TARGET + ' main checkout: git status must be clean; git checkout main && git pull --ff-only && git merge --no-ff origin/unit/' + r.u.key + ' -m merge: ' + r.u.key + '; union both sides for barrel, registry, seed and lockfile files, else prefer main and re-apply the branch additions; pnpm install; pnpm typecheck; run only the tests this unit added; push main; on failure git merge --abort and report blocked.', { label: 'merge:' + r.u.key, phase: 'Merge', model: WORKER_MODEL, effort: 'low', agentType: 'general-purpose', schema: REPORT })
  log(r.u.key + ': merge ' + (m ? m.status : 'null'))
  if (m && m.status === 'done') merged.push(r.u.key)
}
log('merged ' + merged.length + '/' + results.filter(Boolean).length)

phase('Integration')
const suite = await agent(SHARED + 'You are suite:main (cap 20 calls). On main after git pull: npx dotenv -e .env.development.local -e .env.local -- pnpm build, then pnpm test (no doppler wrapper: the checkout env files carry the right local DB port) --reporter=dot (tail -60), pnpm verify; report counts and every failing file as one-sentence blockers; do not fix.', { label: 'suite:main', phase: 'Integration', model: WORKER_MODEL, effort: 'low', agentType: 'general-purpose', schema: REPORT })
log('suite: ' + (suite ? suite.status + ' blockers=' + suite.blockers.length : 'null'))
let review = null
if (suite && suite.blockers.length) {
  review = await opus(SHARED + 'You are review:integration (cap 20 calls, read-only). For each failing file named here decide in one sentence whether it is a regression from this round (name the unit) or pre-existing, by comparing against the source the contract cites: ' + suite.blockers.join(' | '), { label: 'review:integration', phase: 'Integration', effort: 'high', agentType: 'general-purpose', schema: REPORT })
}
return { merged, results: results.filter(Boolean).map(r => ({ unit: r.u.key, verdict: r.verdict })), suite, review }
