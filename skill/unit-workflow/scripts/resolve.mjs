#!/usr/bin/env node
// Resolve unit-workflow settings for one project by merging the override layers.
//
// Usage: node resolve.mjs [target repo] [--json]
//   target defaults to the git top level of the current directory.
//
// Layers, lowest to highest (later wins):
//   1. built-in     <skill>/defaults.json
//   2. user         ~/.claude/unit-workflow/config.json            + overrides.md
//   3. user+project ~/.claude/unit-workflow/projects/<repo name>/  config.json + overrides.md + contract.md
//   4. project      <repo>/.unit-workflow/                         config.json + overrides.md + contract.md
//   5. launch args  whatever the foreman adds at launch (units, only, one-off changes)
//
// config.json keys are launch args (see defaults.json). Objects merge key by key; everything else replaces.
// overrides.md sections:
//   ## Foreman          read by the main session only (deploy, status, when to stop, local paths)
//   ## All workers      appended to every worker prompt (args.rules)
//   ## Role: <role>     appended to that role's prompt (args.roleNotes[role]); roles: port fix verify1 walk verify2 merge suite review
// Sections from every layer are kept, lower layers first.
//
// Output: the launch args to pass to Workflow (add units), the foreman notes, the contract template to use,
// and the files that were read. With --json, one JSON object; otherwise readable text plus the JSON args.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
let target = argv.find(a => !a.startsWith('--'))
if (!target) {
  try { target = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim() } catch { target = process.cwd() }
}
target = path.resolve(target.replace(/^~(?=$|\/)/, os.homedir()))

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME = process.env.UNIT_WORKFLOW_HOME || path.join(os.homedir(), '.claude', 'unit-workflow')
const layers = [
  { name: 'built-in', dir: SKILL, config: 'defaults.json', notes: null, contract: 'templates/contract.md' },
  { name: 'user', dir: HOME },
  { name: 'user+project', dir: path.join(HOME, 'projects', path.basename(target)) },
  { name: 'project', dir: path.join(target, '.unit-workflow') },
]

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const merge = (a, b) => {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) {
    if (k.startsWith('//') || k === '$comment') continue
    out[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v
  }
  return out
}
const readJson = (f) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) {
    if (e.code === 'ENOENT') return null
    throw new Error('cannot parse ' + f + ': ' + e.message)
  }
}
const parseNotes = (text) => {
  const out = { foreman: [], workers: [], roles: {} }
  let cur = null
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/)
    if (h) {
      const t = h[1].toLowerCase()
      const role = t.match(/^role:\s*([a-z0-9]+)/)
      cur = t === 'foreman' ? out.foreman : t === 'all workers' ? out.workers : role ? (out.roles[role[1]] = out.roles[role[1]] || []) : null
      continue
    }
    if (cur && !/^<!--.*-->$/.test(line.trim())) cur.push(line)
  }
  const clean = (ls) => ls.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim()
  return { foreman: clean(out.foreman), workers: clean(out.workers), roles: Object.fromEntries(Object.entries(out.roles).map(([k, v]) => [k, clean(v)])) }
}

let config = {}
const foreman = [], workers = [], roles = {}, sources = []
let contractTemplate = null
for (const L of layers) {
  const cfgFile = path.join(L.dir, L.config || 'config.json')
  const cfg = readJson(cfgFile)
  if (cfg) { config = merge(config, cfg); sources.push(L.name + ': ' + cfgFile) }
  if (L.notes !== null) {
    const nf = path.join(L.dir, 'overrides.md')
    if (fs.existsSync(nf)) {
      const n = parseNotes(fs.readFileSync(nf, 'utf8'))
      if (n.foreman) foreman.push('[' + L.name + '] ' + n.foreman)
      if (n.workers) workers.push(n.workers)
      for (const [r, t] of Object.entries(n.roles)) if (t) roles[r] = (roles[r] ? roles[r] + ' ' : '') + t
      sources.push(L.name + ': ' + nf)
    }
  }
  const cf = path.join(L.dir, L.contract || 'contract.md')
  if (fs.existsSync(cf)) contractTemplate = cf
}

const oneLine = (s) => s.replace(/\s*\n\s*/g, ' ').trim()
const args = { ...config, target: config.target || target }
if (!args.plan) args.plan = path.join(args.target, config.planDir || 'docs/plan')
delete args.planDir
if (workers.length) args.rules = [args.rules, ...workers.map(oneLine)].filter(Boolean).join(' ')
const roleNotes = { ...(args.roleNotes || {}) }
for (const [r, t] of Object.entries(roles)) roleNotes[r] = [roleNotes[r], oneLine(t)].filter(Boolean).join(' ')
if (Object.keys(roleNotes).length) args.roleNotes = roleNotes

const result = { args, foreman: foreman.join('\n\n'), contractTemplate, sources }
if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(0) }
console.log('unit-workflow settings for ' + target)
console.log('\nRead:\n  ' + sources.join('\n  '))
console.log('\nContract template: ' + contractTemplate)
console.log('\nForeman notes:\n' + (result.foreman || '  (none)'))
console.log('\nLaunch args (add units):\n' + JSON.stringify(args, null, 2))
