#!/usr/bin/env node
// Usage: node status.mjs <plan dir> <workflows dir> [completedCount]
import fs from 'node:fs'; import path from 'node:path'
const [planDir, wfDir, nArg] = process.argv.slice(2)
if (!planDir || !wfDir) { console.error('usage: status.mjs <plan dir> <workflows dir> [completedCount]'); process.exit(2) }
const N = Number(nArg || 5)
const reg = JSON.parse(fs.readFileSync(path.join(planDir, 'units.json'), 'utf8')).units
const readLines = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []
const agentsForRun = (runId) => {
  const dir = path.join(wfDir, runId); if (!fs.existsSync(dir)) return []
  const done = new Set(readLines(path.join(dir, 'journal.jsonl')).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.type === 'result').map(r => r.agentId))
  const results = {}
  for (const l of readLines(path.join(dir, 'journal.jsonl'))) { try { const r = JSON.parse(l); if (r.type === 'result') results[r.agentId] = r.result } catch {} }
  return fs.readdirSync(dir).filter(f => /^agent-.*\.jsonl$/.test(f)).map(f => {
    const id = f.slice(6, -6); const lines = readLines(path.join(dir, f))
    let label = '?', first = null, last = null, calls = 0
    for (const l of lines) { let r; try { r = JSON.parse(l) } catch { continue }
      if (r.timestamp) { first = first || r.timestamp; last = r.timestamp }
      if (r.type === 'user' && label === '?') { const c = typeof r.message?.content === 'string' ? r.message.content : ''; const m = c.match(/You are ([A-Za-z0-9:._-]+)/); if (m) label = m[1] }
      if (r.type === 'assistant' && Array.isArray(r.message?.content)) calls += r.message.content.filter(b => b.type === 'tool_use').length }
    let model = '?'; try { model = JSON.parse(fs.readFileSync(path.join(dir, `agent-${id}.meta.json`), 'utf8')).model || '?' } catch {}
    const res = results[id]; const verdict = res ? (res.verdict || res.status || 'done') : (done.has(id) ? 'done' : 'running')
    return { id, label, model, calls, first, last, verdict }
  }).sort((a, b) => (a.first || '').localeCompare(b.first || ''))
}
const mins = (a, b) => a && b ? Math.round((new Date(b) - new Date(a)) / 60000) + 'm' : '?'
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n)
const now = new Date().toISOString()
const running = reg.filter(u => ['running', 'queued'].includes(u.status))
console.log('RUNNING / QUEUED (' + running.length + ')')
console.log(pad('unit', 22) + pad('what', 44) + pad('stage', 30) + pad('model', 6) + pad('calls', 6) + pad('elapsed', 8) + pad('trail', 40) + 'run')
for (const u of running) {
  if (u.status === 'queued') { console.log(pad(u.n + '-' + u.key, 22) + pad(u.title, 44) + pad('queued behind ' + (u.queuedBehind || []).join(','), 30) + pad('', 6) + pad('', 6) + pad('', 8) + pad('', 40) + (u.runId || '')); continue }
  const ag = agentsForRun(u.runId).filter(a => a.label.includes(u.key) || /^(suite|review|ledger):/.test(a.label))
  const live = ag.filter(a => a.verdict === 'running'); const cur = live[live.length - 1] || ag[ag.length - 1]
  const trail = ag.filter(a => a.verdict !== 'running').map(a => a.label.split(':')[0] + '=' + a.verdict).join(' ')
  const stage = cur ? (cur.label + (cur.verdict === 'running' ? '' : ' (' + cur.verdict + ')')) : 'starting'
  console.log(pad(u.n + '-' + u.key, 22) + pad(u.title, 44) + pad(stage, 30) + pad(cur ? cur.model : '', 6) + pad(cur ? cur.calls : '', 6) + pad(cur ? mins(cur.first, cur.verdict === 'running' ? now : cur.last) : '', 8) + pad(trail, 40) + u.runId)
}
const doneUnits = reg.filter(u => ['merged', 'blocked', 'deferred'].includes(u.status)).sort((a, b) => (b.mergedAt || b.launchedAt || '').localeCompare(a.mergedAt || a.launchedAt || '')).slice(0, N)
console.log('\nLAST COMPLETED (' + doneUnits.length + ')')
console.log(pad('unit', 22) + pad('what', 44) + pad('status', 9) + pad('when', 18) + 'outcome')
for (const u of doneUnits) console.log(pad(u.n + '-' + u.key, 22) + pad(u.title, 44) + pad(u.status, 9) + pad((u.mergedAt || '').slice(0, 16), 18) + (u.outcome || ''))
