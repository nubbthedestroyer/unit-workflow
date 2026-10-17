export const meta = {
  name: 'unit-workflow',
  description: 'Unit tiers: per-unit worktree port, Tier 1 verify with fix rounds, Tier 2 for risky units, merge as each unit clears (one at a time), one integration pass. Opus 5.5 workers; Fable orchestrates.',
  whenToUse: 'Launch one or more units from a plan dir. args: {target, plan, units:[{key, risky, contract, brief}], only?, project?, planDocs?, suiteCmd?, trailer?, maxOpus?, baseBranch?, remote?, push?, pm?, installCmd?, typecheckCmd?, verifyCmd?}',
  phases: [
    { title: 'Port', detail: 'build each unit in its own worktree (cap 60 calls)', model: 'claude-opus-5-5' },
    { title: 'Tier 1', detail: 'acceptance commands, typecheck, gates (cap 20); fix round on failure (cap 30), max 2', model: 'claude-opus-5-5' },
    { title: 'Tier 2', detail: 'refute-only pass for risky units after Tier 1 passes (cap 20)', model: 'claude-opus-5-5' },
    { title: 'Merge', detail: 'each unit merges as soon as it clears, one at a time, unit tests only (cap 15)', model: 'claude-opus-5-5' },
    { title: 'Integration', detail: 'full suite on main, then review of any failures against source', model: 'claude-opus-5-5' },
  ],
}

// Project settings arrive in args so one script serves every project (no per-project copy)
const A = args || {}
if (!A.target || !A.plan) throw new Error('args.target and args.plan are required (absolute paths)')
const TARGET = A.target
const PLAN = A.plan
const PROJECT = A.project || 'Project build'
const PLAN_DOCS = A.planDocs || 'contracts/<unit>.md'
const TRAILER = A.trailer || 'Co-Authored-By: Claude <noreply@anthropic.com>'
// Git: base branch units fork from and merge into; push:false keeps everything local (no pull, no push)
const BASE = A.baseBranch || 'main'
const REMOTE = A.remote || 'origin'
const PUSH = A.push !== false
const BASE_REF = PUSH ? REMOTE + '/' + BASE : BASE
const UNIT_REF = (key) => PUSH ? REMOTE + '/unit/' + key : 'unit/' + key
const SYNC_BASE = PUSH ? 'git checkout ' + BASE + ' && git pull --ff-only' : 'git checkout ' + BASE
// Package manager: pm picks defaults; explicit *Cmd args win
const PM = A.pm || 'pnpm'
const PM_DEFAULTS = {
  pnpm: { install: 'pnpm install --prefer-offline', typecheck: 'pnpm typecheck', verify: 'pnpm verify', build: 'pnpm build' },
  npm: { install: 'npm install', typecheck: 'npm run typecheck', verify: 'npm run verify', build: 'npm run build' },
  yarn: { install: 'yarn install', typecheck: 'yarn typecheck', verify: 'yarn verify', build: 'yarn build' },
}[PM] || {}
const INSTALL = A.installCmd || PM_DEFAULTS.install
const TYPECHECK = A.typecheckCmd || PM_DEFAULTS.typecheck
const VERIFY = A.verifyCmd || PM_DEFAULTS.verify
const BUILD = PM_DEFAULTS.build
// args.only reruns a subset of units by key (used after a prompt edit invalidates the resume cache)
const SUITE_CMD = A.suiteCmd || (PM === 'pnpm' ? 'pnpm build, then pnpm test --reporter=dot (tail -60), then pnpm verify' : BUILD + ', then ' + VERIFY + ' (tail -60)')
const UNITS = (A.units || []).filter(u => !A.only || A.only.includes(u.key))
if (!UNITS.length) { log('no units to run'); return { merged: [], results: [], suite: null, review: null } }

const SHARED = PROJECT + '. Repo ' + TARGET + '. Plan ' + PLAN + ' (' + PLAN_DOCS + '). Rules: work only in your own worktree ' + TARGET + '/.worktrees/<unit> on branch unit/<unit> created from ' + BASE_REF + ' (if node_modules is missing run ' + INSTALL + ' once); batch shell commands; write each file once; vitest --reporter=dot; pipe output over 40 lines through tail -40; open only files you must change or lines the contract cites; never re-read a file; skip ' + BUILD + ' (runs at merge); never write a secret; commit with trailer ' + TRAILER + (PUSH ? ' and push your branch.' : '; never run git push or git pull (this run is local only).') + ' Update your unit row in ' + PLAN + '/ledger.md; ledgerUpdated=true. Return ONLY the structured result; no code, no diffs, one sentence per item. '
const REPORT = { type: 'object', properties: { status: { type: 'string', enum: ['done', 'partial', 'blocked'] }, findings: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'number' }, note: { type: 'string' } }, required: ['path', 'line', 'note'] } }, changed: { type: 'array', items: { type: 'string' } }, verified: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, pass: { type: 'boolean' } }, required: ['cmd', 'pass'] } }, ledgerUpdated: { type: 'boolean' }, blockers: { type: 'array', items: { type: 'string' } } }, required: ['status', 'findings', 'changed', 'verified', 'ledgerUpdated', 'blockers'] }
const VERDICT = { type: 'object', properties: { verdict: { type: 'string', enum: ['verified', 'refuted', 'blocked'] }, findings: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'number' }, note: { type: 'string' } }, required: ['path', 'line', 'note'] } }, verified: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, pass: { type: 'boolean' } }, required: ['cmd', 'pass'] } }, ledgerUpdated: { type: 'boolean' } }, required: ['verdict', 'findings', 'verified', 'ledgerUpdated'] }

// Workers pin Opus 5.5; the orchestrator (the main session) stays on Fable
const WORKER_MODEL = 'claude-opus-5-5'

// Every agent goes through opus(), so the cap of MAX_OPUS concurrent agents holds for all tiers
const MAX_OPUS = A.maxOpus || 3
let opusRunning = 0; const opusWaiters = []
const opusAcquire = () => new Promise(r => { if (opusRunning < MAX_OPUS) { opusRunning++; r() } else opusWaiters.push(r) })
const opusRelease = () => { opusRunning--; const w = opusWaiters.shift(); if (w) { opusRunning++; w() } }
const opus = async (prompt, opts) => { await opusAcquire(); try { return await agent(prompt, { agentType: 'general-purpose', ...opts, model: WORKER_MODEL }) } finally { opusRelease() } }

// Merges run one at a time, in the order units clear their checks
let mergeChain = Promise.resolve()
const mergeLock = (fn) => { const p = mergeChain.then(fn); mergeChain = p.catch(() => {}); return p }

const tier1 = (u, round) => opus(SHARED + 'You are verify1:' + u.key + ' round ' + round + ' (cap 20 calls). In the worktree run ' + TYPECHECK + ', ' + VERIFY + ', and every command in the Acceptance test of ' + PLAN + '/contracts/' + u.contract + '. Confirm the result schema and that the ledger row was updated. Refute only on a failing command or a missing Owns item.', { label: 'verify1:' + u.key, phase: 'Tier 1', effort: 'low', schema: VERDICT })

const merged = []
const results = await pipeline(UNITS,
  (u) => opus(SHARED + 'You are port:' + u.key + ' (cap 60 calls). Unit brief: ' + u.brief + ' Contract: ' + PLAN + '/contracts/' + u.contract + '. Implement fully and write the acceptance tests; run ' + TYPECHECK + ' and those tests only.', { label: 'port:' + u.key, phase: 'Port', effort: 'medium', schema: REPORT }),
  async (port, u) => {
    if (!port) return { u, verdict: 'blocked' }
    let v = await tier1(u, 1); let rounds = 0
    while (v && v.verdict === 'refuted' && rounds < 2) {
      rounds++
      log('ledger: ' + u.key + ' fix round ' + rounds)
      await opus(SHARED + 'You are fix:' + u.key + '-' + rounds + ' (cap 30 calls). Fix exactly these Tier 1 findings then re-run the failing commands: ' + v.findings.map(f => f.path + ':' + f.line + ' ' + f.note).join('; '), { label: 'fix:' + u.key + '-' + rounds, phase: 'Tier 1', effort: 'medium', schema: REPORT })
      v = await tier1(u, rounds + 1)
    }
    log(u.key + ': tier1 ' + (v ? v.verdict : 'null') + ' after ' + rounds + ' fix rounds')
    if (v && v.verdict === 'verified' && u.risky) {
      const v2 = await opus(SHARED + 'You are verify2:' + u.key + ' (cap 20 calls, refute-only, never edit). Walk Owns of ' + PLAN + '/contracts/' + u.contract + ' via git diff --stat ' + BASE_REF + '...HEAD in the worktree; do not reinstall or run the full suite. Refute ONLY for a failing gate, a missing or stubbed Owns item, or a security/tenancy defect; record anything else as a nonblocking: ledger line and still return verified.', { label: 'verify2:' + u.key, phase: 'Tier 2', effort: 'high', schema: VERDICT })
      log(u.key + ': tier2 ' + (v2 ? v2.verdict : 'null'))
      return { u, verdict: v2 ? v2.verdict : 'blocked' }
    }
    return { u, verdict: v ? v.verdict : 'blocked' }
  },
  (r) => {
    if (r.verdict !== 'verified') { log(r.u.key + ': not merged (' + r.verdict + ')'); return r }
    return mergeLock(async () => {
      const m = await opus(SHARED + 'You are merge:' + r.u.key + ' (cap 15 calls). In ' + TARGET + ' main checkout: git status must be clean; ' + SYNC_BASE + ' && git merge --no-ff ' + UNIT_REF(r.u.key) + ' -m merge: ' + r.u.key + '; union both sides for barrel, registry, seed and lockfile files, else prefer ' + BASE + ' and re-apply the branch additions; ' + INSTALL + '; ' + TYPECHECK + '; run only the tests this unit added; ' + (PUSH ? 'push ' + BASE + '; ' : 'do not push; ') + 'on failure git merge --abort and report blocked.', { label: 'merge:' + r.u.key, phase: 'Merge', effort: 'low', schema: REPORT })
      log(r.u.key + ': merge ' + (m ? m.status : 'null'))
      if (m && m.status === 'done') merged.push(r.u.key)
      return { ...r, merge: m ? m.status : 'blocked' }
    })
  })
log('merged ' + merged.length + '/' + UNITS.length)

let suite = null, review = null
if (merged.length) {
  suite = await opus(SHARED + 'You are suite:' + BASE + ' (cap 20 calls). On ' + BASE + (PUSH ? ' after git pull' : ' (local, no pull)') + ': ' + SUITE_CMD + '; report counts and every failing file as one-sentence blockers; do not fix.', { label: 'suite:' + BASE, phase: 'Integration', effort: 'low', schema: REPORT })
  log('suite: ' + (suite ? suite.status + ' blockers=' + suite.blockers.length : 'null'))
  if (suite && suite.blockers.length) {
    review = await opus(SHARED + 'You are review:integration (cap 20 calls, read-only). For each failing file named here decide in one sentence whether it is a regression from this round (name the unit) or pre-existing, by comparing against the source the contract cites: ' + suite.blockers.join(' | '), { label: 'review:integration', phase: 'Integration', effort: 'high', schema: REPORT })
  }
}
return { merged, results: results.filter(Boolean).map(r => ({ unit: r.u.key, verdict: r.verdict, merge: r.merge || null })), suite, review }
