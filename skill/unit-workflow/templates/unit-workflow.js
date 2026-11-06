export const meta = {
  name: 'unit-workflow',
  description: 'Unit tiers: per-unit worktree port (Opus, with context handoff), Tier 1 checks (Sonnet runs commands and walks screens, Opus fixes), Tier 2 Opus review for risky units, merge as each unit clears (one at a time), one integration pass.',
  whenToUse: 'Launch one or more units from a plan dir. args (from scripts/resolve.mjs, plus units): {target, plan, units:[{key, risky, contract, brief, walk?, build?}], only?, project?, planDocs?, suiteCmd?, trailer?, rules?, roleNotes?, models?, maxOpus?, maxSonnet?, handoffAt?, maxHandoffs?, workerType?, checkerType?, baseBranch?, remote?, push?, pm?, installCmd?, typecheckCmd?, verifyCmd?}',
  phases: [
    { title: 'Port', detail: 'build each unit in its own worktree; hand off to a fresh agent past the call budget', model: 'claude-opus-5-5' },
    { title: 'Tier 1', detail: 'Sonnet runs the acceptance commands, then walks the screens; Opus fixes on failure, max 2 rounds', model: 'claude-sonnet-5-5' },
    { title: 'Tier 2', detail: 'Opus refute-only review of the diff for risky units, no browser', model: 'claude-opus-5-5' },
    { title: 'Merge', detail: 'each unit merges as soon as it clears, one at a time', model: 'claude-sonnet-5-5' },
    { title: 'Integration', detail: 'Sonnet runs the full suite on the base branch; Opus reviews any failures', model: 'claude-sonnet-5-5' },
  ],
}

// Project settings arrive in args so one script serves every project (no per-project copy).
// Never edit this file for one project: put settings in the override layers and let the foreman pass them
// (scripts/resolve.mjs merges defaults.json, ~/.claude/unit-workflow/, and <repo>/.unit-workflow/ into these args).
const A = args || {}
if (!A.target || !A.plan) throw new Error('args.target and args.plan are required (absolute paths)')
const TARGET = A.target
const PLAN = A.plan
const PROJECT = A.project || 'Project build'
const PLAN_DOCS = A.planDocs || 'contracts/<unit>.md'
// No attribution trailer unless the project asks for one
const TRAILER = A.trailer || ''
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
  npm: { install: 'npm ci', typecheck: 'npm run typecheck', verify: 'npm run verify', build: 'npm run build' },
  yarn: { install: 'yarn install', typecheck: 'yarn typecheck', verify: 'yarn verify', build: 'yarn build' },
}[PM] || {}
const INSTALL = A.installCmd || PM_DEFAULTS.install
const TYPECHECK = A.typecheckCmd || PM_DEFAULTS.typecheck
const VERIFY = A.verifyCmd || PM_DEFAULTS.verify
const BUILD = PM_DEFAULTS.build
const SUITE_CMD = A.suiteCmd || (PM === 'pnpm' ? 'pnpm build, then pnpm test --reporter=dot (tail -60), then pnpm verify' : BUILD + ', then ' + VERIFY + ' (tail -60)')
// args.only reruns a subset of units by key (used after a prompt edit invalidates the resume cache)
const UNITS = (A.units || []).filter(u => !A.only || A.only.includes(u.key))
if (!UNITS.length) { log('no units to run'); return { merged: [], results: [], suite: null, review: null } }

// Models by role. Opus thinks and writes code (it one-shots more often, and Sonnet retries cost more);
// Sonnet runs commands, walks screens and merges (fast and cheap at mechanical work).
// args.models overrides any role; a unit can set build: 'sonnet' for mechanical edits.
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const pick = (m) => m === 'opus' ? OPUS : m === 'sonnet' ? SONNET : m
const MODELS = Object.assign({
  build: OPUS, fix: OPUS, verify1: SONNET, walk: SONNET, verify2: OPUS, merge: SONNET, suite: SONNET, review: OPUS,
}, A.models || {})
Object.keys(MODELS).forEach(k => { MODELS[k] = pick(MODELS[k]) })

// Lean agent types skip connectors and skills (about 18K tokens at start instead of about 110K).
// lean-worker edits; lean-checker reads, runs commands and drives a headless browser.
const WORKER = A.workerType || 'lean-worker'
const CHECKER = A.checkerType || 'lean-checker'

// Concurrency: separate caps for Opus and Sonnet agents across every tier
const MAX = { opus: A.maxOpus || 3, sonnet: A.maxSonnet || 6 }
const slots = { opus: { n: 0, q: [] }, sonnet: { n: 0, q: [] } }
const famOf = (model) => model === OPUS ? 'opus' : 'sonnet'
const acquire = (f) => new Promise(r => { const s = slots[f]; if (s.n < MAX[f]) { s.n++; r() } else s.q.push(r) })
const release = (f) => { const s = slots[f]; s.n--; const w = s.q.shift(); if (w) { s.n++; w() } }
// Override text: args.rules goes to every worker, args.roleNotes[role] to one role (port, fix, verify1, walk, verify2, merge, suite, review)
const ROLE_NOTES = A.roleNotes || {}
const extra = (role) => {
  const r = role === 'build' ? 'port' : role
  return (A.rules ? ' Project rules: ' + A.rules : '') + (ROLE_NOTES[r] ? ' Notes for ' + r + ': ' + ROLE_NOTES[r] : '')
}
const run = async (role, prompt, opts) => {
  prompt = prompt + extra(role)
  const model = opts.model || MODELS[role]
  const f = famOf(model)
  await acquire(f)
  try { return await agent(prompt, { agentType: WORKER, ...opts, model }) } finally { release(f) }
}

// Context budget: past this many tool calls a worker commits, writes a handoff and stops; a fresh agent continues.
// Prompt caps alone did not hold (builders ran 250 to 370 turns and reached 600K context).
const HANDOFF_AT = A.handoffAt || 50
const MAX_HANDOFFS = A.maxHandoffs || 2

// Merges run one at a time, in the order units clear their checks
let mergeChain = Promise.resolve()
const mergeLock = (fn) => { const p = mergeChain.then(fn); mergeChain = p.catch(() => {}); return p }

const SHARED = PROJECT + '. Repo ' + TARGET + '. Plan ' + PLAN + ' (' + PLAN_DOCS + '). Rules: work only in your own worktree ' + TARGET + '/.worktrees/<unit> on branch unit/<unit> created from ' + BASE_REF + ' (if node_modules is missing run ' + INSTALL + ' once); open only files you must change or lines the contract cites; never re-read a file; make several edits, then run checks once; batch shell commands; pipe output over 40 lines through tail -40; skip ' + BUILD + ' (runs at merge); never write a secret; stop only servers you started, by saved PID; ' + (TRAILER ? 'commit with trailer ' + TRAILER : 'commit with plain messages and no attribution lines') + (PUSH ? ' and push your branch.' : '; never run git push or git pull (this run is local only).') + ' If you edit code, update your unit row in ' + PLAN + '/ledger.md and set ledgerUpdated true; agents that never edit set ledgerUpdated to whether the row is current. Do not narrate between tool calls. Return ONLY the structured result: status is one word, every note is one sentence, no code, no diffs. '
const BUDGET = ' Call budget: after about ' + HANDOFF_AT + ' tool calls, stop where you are, commit work in progress, and return status partial with handoff set to what is done, what is left and the next step, in at most five sentences.'
const ESCALATE = ' If the contract looks wrong, the fix needs a product or design choice, or you cannot make the checks pass with confidence, do not guess: return status blocked with escalate true and say what you found and what you suspect.'

const FINDING = { type: 'object', properties: { path: { type: 'string' }, line: { type: 'number' }, note: { type: 'string' } }, required: ['path', 'line', 'note'] }
const CHECKED = { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, pass: { type: 'boolean' } }, required: ['cmd', 'pass'] } }
const REPORT = { type: 'object', properties: {
  status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
  findings: { type: 'array', items: FINDING }, changed: { type: 'array', items: { type: 'string' } }, verified: CHECKED,
  ledgerUpdated: { type: 'boolean' }, blockers: { type: 'array', items: { type: 'string' } },
  handoff: { type: 'string' }, escalate: { type: 'boolean' },
}, required: ['status', 'findings', 'changed', 'verified', 'ledgerUpdated', 'blockers'] }
const VERDICT = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['verified', 'refuted', 'blocked'] },
  findings: { type: 'array', items: FINDING }, verified: CHECKED, ledgerUpdated: { type: 'boolean' },
  screens: { type: 'array', items: { type: 'object', properties: { route: { type: 'string' }, viewport: { type: 'string' }, pass: { type: 'boolean' }, note: { type: 'string' }, shot: { type: 'string' } }, required: ['route', 'pass', 'note'] } },
}, required: ['verdict', 'findings', 'verified', 'ledgerUpdated'] }

// Build with handoff: a fresh agent continues on the same worktree from the previous handoff note
const build = async (u, role, label, phase, task) => {
  const model = u.build ? pick(u.build) : MODELS[role]
  let r = await run(role, SHARED + 'You are ' + label + '. ' + task + BUDGET + ESCALATE, { label, phase, effort: 'medium', schema: REPORT, model })
  let hops = 0
  while (r && r.status === 'partial' && r.handoff && hops < MAX_HANDOFFS) {
    hops++
    log(u.key + ': ' + role + ' handoff ' + hops)
    r = await run(role, SHARED + 'You are ' + label + ' (continuation ' + hops + '). The previous agent stopped at its call budget and left this handoff: ' + r.handoff + ' Original task: ' + task + ' Continue from the handoff; do not redo finished work.' + BUDGET + ESCALATE, { label, phase, effort: 'medium', schema: REPORT, model })
  }
  // A Sonnet build that escalates or stalls goes to Opus once
  if (r && model !== OPUS && (r.escalate || r.status !== 'done')) {
    log(u.key + ': ' + role + ' escalated to Opus')
    r = await run(role, SHARED + 'You are ' + label + ' (escalated). A faster model could not finish this and reported: ' + JSON.stringify({ status: r.status, handoff: r.handoff || '', blockers: r.blockers, findings: r.findings }) + ' Task: ' + task + ' Diagnose it yourself and finish.' + BUDGET, { label, phase, effort: 'high', schema: REPORT, model: OPUS })
  }
  return r
}

const verify1 = (u, round) => run('verify1', SHARED + 'You are verify1:' + u.key + ' round ' + round + ' (about 20 calls, never edit). In the worktree run ' + TYPECHECK + ', ' + VERIFY + ', and every command in the Acceptance test of ' + PLAN + '/contracts/' + u.contract + '. Confirm the ledger row was updated. Refute only on a failing command or a missing Owns item; for each failure give the file, line and the failing output in one sentence.', { label: 'verify1:' + u.key, phase: 'Tier 1', effort: 'low', schema: VERDICT, agentType: CHECKER })

// Screen walk: Sonnet drives the browser (fast per screen); only the routes the unit names
const walk = (u, round) => run('walk', SHARED + 'You are walk:' + u.key + ' round ' + round + ' (about 30 calls, never edit code). Start the app from the worktree on the ports the contract names (save the PIDs, stop them at the end), then walk exactly these screens and checks in headless Playwright: ' + u.walk + ' For each screen record route, viewport, pass, one-sentence note and the screenshot path in screens. Refute only when a listed check fails; put each failure in findings with the file most likely responsible.', { label: 'walk:' + u.key, phase: 'Tier 1', effort: 'low', schema: VERDICT, agentType: CHECKER })

const checks = async (u, round) => {
  const v = await verify1(u, round)
  if (!v || v.verdict !== 'verified' || !u.walk) return { v, w: null }
  const w = await walk(u, round)
  return { v: w && w.verdict !== 'verified' ? w : v, w }
}

const merged = []
const results = await pipeline(UNITS,
  (u) => build(u, 'build', 'port:' + u.key, 'Port', 'Unit brief: ' + u.brief + ' Contract: ' + PLAN + '/contracts/' + u.contract + '. Implement fully and write the acceptance tests; run ' + TYPECHECK + ' and those tests only. Do not open a browser; a separate checker walks the screens.'),
  async (port, u) => {
    if (!port || port.status !== 'done') { log(u.key + ': port ended ' + (port ? port.status : 'null') + ', not checked'); return { u, verdict: 'blocked', port } }
    let { v, w } = await checks(u, 1); let rounds = 0
    while (v && v.verdict === 'refuted' && rounds < 2) {
      rounds++
      log('ledger: ' + u.key + ' fix round ' + rounds)
      await build(u, 'fix', 'fix:' + u.key + '-' + rounds, 'Tier 1', 'Fix exactly these Tier 1 findings, then re-run only the failing commands: ' + v.findings.map(f => f.path + ':' + f.line + ' ' + f.note).join('; ') + ' Contract: ' + PLAN + '/contracts/' + u.contract + '.')
      const next = await checks(u, rounds + 1)
      v = next.v; w = next.w
    }
    log(u.key + ': tier1 ' + (v ? v.verdict : 'null') + ' after ' + rounds + ' fix rounds')
    if (v && v.verdict === 'verified' && u.risky) {
      const v2 = await run('verify2', SHARED + 'You are verify2:' + u.key + ' (about 20 calls, refute-only, never edit, no browser). Read the Owns of ' + PLAN + '/contracts/' + u.contract + ' and the diff: git diff ' + BASE_REF + '...HEAD in the worktree. Screen walk result: ' + JSON.stringify(w ? w.screens || [] : 'none') + '. Do not reinstall or run the full suite. Refute ONLY for a failing gate, a missing or stubbed Owns item, or a security, permission, tenancy or money defect; record anything else as a nonblocking: ledger line and still return verified.', { label: 'verify2:' + u.key, phase: 'Tier 2', effort: 'high', schema: VERDICT, agentType: CHECKER })
      log(u.key + ': tier2 ' + (v2 ? v2.verdict : 'null'))
      return { u, verdict: v2 ? v2.verdict : 'blocked' }
    }
    return { u, verdict: v ? v.verdict : 'blocked' }
  },
  (r) => {
    if (r.verdict !== 'verified') { log(r.u.key + ': not merged (' + r.verdict + ')'); return r }
    return mergeLock(async () => {
      const m = await run('merge', SHARED + 'You are merge:' + r.u.key + ' (about 15 calls). In ' + TARGET + ' main checkout: git status must be clean; ' + SYNC_BASE + ' && git merge --no-ff ' + UNIT_REF(r.u.key) + ' -m merge: ' + r.u.key + '; union both sides for barrel, registry, seed and lockfile files, else prefer ' + BASE + ' and re-apply the branch additions; ' + INSTALL + '; ' + TYPECHECK + '; run only the tests this unit added; ' + (PUSH ? 'push ' + BASE + '; ' : 'do not push; ') + 'on failure git merge --abort and report blocked.', { label: 'merge:' + r.u.key, phase: 'Merge', effort: 'low', schema: REPORT })
      log(r.u.key + ': merge ' + (m ? m.status : 'null'))
      if (m && m.status === 'done') merged.push(r.u.key)
      return { ...r, merge: m ? m.status : 'blocked' }
    })
  })
log('merged ' + merged.length + '/' + UNITS.length)

let suite = null, review = null
if (merged.length) {
  suite = await run('suite', SHARED + 'You are suite:' + BASE + ' (about 20 calls, never edit). On ' + BASE + (PUSH ? ' after git pull' : ' (local, no pull)') + ': ' + SUITE_CMD + '; report counts and every failing file as one-sentence blockers; do not fix.', { label: 'suite:' + BASE, phase: 'Integration', effort: 'low', schema: REPORT, agentType: CHECKER })
  log('suite: ' + (suite ? suite.status + ' blockers=' + suite.blockers.length : 'null'))
  if (suite && suite.blockers.length) {
    review = await run('review', SHARED + 'You are review:integration (about 20 calls, read-only). For each failing file named here decide in one sentence whether it is a regression from this round (name the unit) or pre-existing, by comparing against the source the contract cites: ' + suite.blockers.join(' | '), { label: 'review:integration', phase: 'Integration', effort: 'high', schema: REPORT, agentType: CHECKER })
  }
}
return { merged, results: results.filter(Boolean).map(r => ({ unit: r.u.key, verdict: r.verdict, merge: r.merge || null, blockers: (r.port || {}).blockers || [], escalate: !!(r.port || {}).escalate, handoff: (r.port || {}).handoff || null })), suite, review }
