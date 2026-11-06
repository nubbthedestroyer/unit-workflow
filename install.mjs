#!/usr/bin/env node
// Install or update unit-workflow for Claude Code. Safe to rerun: it never touches your overrides.
//
//   node install.mjs                         install or update the skill, the saved workflow and the agent types
//   node install.mjs --browser-mcp <name>    your Playwright MCP server is not named "playwright"
//   node install.mjs --force-agents          overwrite ~/.claude/agents/lean-*.md with this repo's copies
//   node install.mjs --project <repo>        also scaffold <repo>/.unit-workflow/ (project overrides, committed with the repo)
//
// What goes where:
//   ~/.claude/skills/unit-workflow/      the skill (replaced on every update; never edit it)
//   ~/.claude/workflows/unit-workflow.js link to the saved workflow script
//   ~/.claude/agents/lean-*.md           lean agent types (kept if present, unless --force-agents)
//   ~/.claude/unit-workflow/             YOUR overrides: config.json, overrides.md, projects/<repo name>/ (never overwritten)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.dirname(fileURLToPath(import.meta.url))
const CLAUDE = path.join(os.homedir(), '.claude')
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const done = []

// 1. Skill: replace wholesale. Back up the old SKILL.md if it was hand-edited, so nothing private is lost.
const skillDst = path.join(CLAUDE, 'skills', 'unit-workflow')
const skillSrc = path.join(REPO, 'skill', 'unit-workflow')
const oldSkill = path.join(skillDst, 'SKILL.md')
if (fs.existsSync(oldSkill) && fs.readFileSync(oldSkill, 'utf8') !== fs.readFileSync(path.join(skillSrc, 'SKILL.md'), 'utf8')) {
  const bak = path.join(CLAUDE, 'unit-workflow', 'backup')
  fs.mkdirSync(bak, { recursive: true })
  const f = path.join(bak, 'SKILL.md.' + new Date().toISOString().replace(/[:.]/g, '-'))
  fs.copyFileSync(oldSkill, f)
  done.push('backed up your previous SKILL.md to ' + f + ' (move anything project-specific from it into overrides)')
}
fs.rmSync(skillDst, { recursive: true, force: true })
fs.cpSync(skillSrc, skillDst, { recursive: true })
done.push('skill -> ' + skillDst)

// 2. Saved workflow, launched by name from any project
const wfDir = path.join(CLAUDE, 'workflows')
fs.mkdirSync(wfDir, { recursive: true })
const link = path.join(wfDir, 'unit-workflow.js')
fs.rmSync(link, { force: true })
fs.symlinkSync(path.join(skillDst, 'templates', 'unit-workflow.js'), link)
done.push('workflow link -> ' + link)

// 3. Lean agent types
const agentsDir = path.join(CLAUDE, 'agents')
fs.mkdirSync(agentsDir, { recursive: true })
const mcp = opt('--browser-mcp')
for (const a of ['lean-worker.md', 'lean-checker.md']) {
  const dst = path.join(agentsDir, a)
  if (fs.existsSync(dst) && !flag('--force-agents')) { done.push('kept your ' + dst + ' (use --force-agents to replace)'); continue }
  let text = fs.readFileSync(path.join(REPO, 'agents', a), 'utf8')
  if (mcp) text = text.replaceAll('mcp__playwright__', 'mcp__' + mcp + '__')
  fs.writeFileSync(dst, text)
  done.push('agent -> ' + dst)
}

// 4. User override layer: created empty once, never overwritten
const home = path.join(CLAUDE, 'unit-workflow')
fs.mkdirSync(path.join(home, 'projects'), { recursive: true })
const write0 = (f, text) => { if (!fs.existsSync(f)) { fs.writeFileSync(f, text); done.push('created ' + f) } }
write0(path.join(home, 'config.json'), JSON.stringify({ '//': 'Your settings for every project. Any launch arg works here; see SKILL.md, section Customize.' }, null, 2) + '\n')
write0(path.join(home, 'overrides.md'), '# unit-workflow overrides (you, every project)\n\n## Foreman\n\n## All workers\n')

// 5. Optional project layer, from the starter templates
const proj = opt('--project')
if (proj) {
  const dir = path.join(path.resolve(proj), '.unit-workflow')
  fs.mkdirSync(dir, { recursive: true })
  for (const f of ['config.json', 'overrides.md']) {
    const dst = path.join(dir, f)
    if (!fs.existsSync(dst)) { fs.copyFileSync(path.join(skillSrc, 'templates', 'overrides', f), dst); done.push('created ' + dst + ' (edit it; the values are examples)') }
  }
}

console.log(done.map(l => '- ' + l).join('\n'))
console.log('\nStart a new Claude Code session so the agent types load. Check your merged settings any time:\n  node ' + path.join(skillDst, 'scripts', 'resolve.mjs') + ' <repo>')
