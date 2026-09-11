import sys; sys.path.insert(0, "<path to the aws-architecture-diagram skill>/scripts")
from drawio_builder import Diagram, H, V, sides, NET, DB, SEC, MGMT, COMPUTE

INK = "#232F3E"
d = Diagram("The Unit Workflow", subtitle="How one request becomes shipped code — small briefs, fresh workers, nobody checks their own work, everything written down", width=1700, height=980)

# ---- people band -------------------------------------------------------- #
d.group("people", "People", 40, 110, 300, 420, kind="generic")
d.note("you", "<b>You</b><br/>say what you want;<br/>decide only the big things<br/>(drop a feature, spend money,<br/>change a public door)", 70, 160, 240, 110, stroke=MGMT, fill="#FFF7E6")
d.note("foreman", "<b>The foreman</b><br/>(the assistant you talk to)<br/>writes the brief, hands out work,<br/>reads reports, keeps the ledger.<br/><i>Never touches the tools.</i>", 70, 330, 240, 130, stroke=MGMT, fill="#FFF7E6")
d.edge("you", "foreman", "“the drop zone should stay active”", exits=sides(0.5,1,0.5,0))

# ---- the unit band ------------------------------------------------------ #
d.group("unit", "One unit — runs in the background, one fresh worker per step", 380, 110, 1280, 420, kind="generic")

d.note("contract", "<b>1. Brief</b><br/>one-page contract:<br/>your words, files it owns,<br/>files it must not touch,<br/>how to prove it works", 410, 160, 200, 120, stroke=DB, fill="#F0F4FF")
d.note("builder", "<b>2. Builder</b><br/>works in its own copy<br/>of the code (a worktree);<br/>cannot break anything live", 650, 160, 200, 120, stroke=COMPUTE, fill="#F3FBF3")
d.note("checker", "<b>3. Checker</b><br/>reads the same brief,<br/>runs the proofs, clicks<br/>through the app, reports<br/>file + line for every finding", 890, 160, 200, 120, stroke=SEC, fill="#FFF3F0")
d.note("fixer", "<b>4. Fixer</b><br/>repairs what the checker<br/>found; the checker looks<br/>again (max two rounds)", 890, 330, 200, 100, stroke=SEC, fill="#FFF3F0")
d.note("tier2", "<b>5. Second checker</b><br/><i>risky units only</i>: money,<br/>sign-in, tenant isolation,<br/>ingestion, public doors —<br/>tries to refute it", 1130, 160, 200, 120, stroke=SEC, fill="#FFF3F0")
d.note("merger", "<b>6. Merger</b><br/>folds the branch into<br/>main — one unit at a time,<br/>never two racing", 1370, 160, 200, 120, stroke=NET, fill="#F5F0FF")
d.note("inspector", "<b>7. Inspector</b><br/>runs the whole build + test<br/>suite on main; explains any<br/>failure: new, or old noise?", 1370, 330, 200, 120, stroke=NET, fill="#F5F0FF")

d.edge("foreman", "contract", "writes", exits=sides(1,0.5,0,0.5))
d.edge("contract", "builder", exits=H)
d.edge("builder", "checker", "branch", exits=H)
d.edge("checker", "fixer", "refuted", color="#B7472A", exits=sides(0.5,1,0.5,0))
d.edge("fixer", "checker", "re-check", color="#B7472A", exits=sides(0.8,0,0.8,1))
d.edge("checker", "tier2", "confirmed", exits=H)
d.edge("tier2", "merger", "confirmed", exits=H)
d.edge("merger", "inspector", "main", exits=sides(0.5,1,0.5,0))

# ---- ship --------------------------------------------------------------- #
d.note("ship", "<b>8. Ship</b><br/>migrations applied to<br/>production, deploy runs,<br/>ledger records the outcome", 1370, 600, 200, 100, stroke=MGMT, fill="#FFF7E6")
d.edge("inspector", "ship", "green", exits=sides(0.5,1,0.5,0))

# ---- truth on disk ------------------------------------------------------ #
d.group("disk", "Truth lives on disk (docs/plan) — not in anyone's memory", 40, 760, 1280, 170, kind="generic")
d.note("f_contract", "<b>contracts/NN-*.md</b><br/>the brief for every unit", 70, 810, 220, 80, stroke=DB, fill="#F0F4FF")
d.note("f_units", "<b>units.json</b><br/>registry the status tools read", 320, 810, 220, 80, stroke=DB, fill="#F0F4FF")
d.note("f_ledger", "<b>ledger.md</b><br/>one row per unit + every<br/>check, fix, merge", 570, 810, 220, 80, stroke=DB, fill="#F0F4FF")
d.note("f_resume", "<b>resume.md</b><br/>where the last session stopped;<br/>a new session reads it first", 820, 810, 220, 80, stroke=DB, fill="#F0F4FF")
d.note("f_journal", "<b>run journal (wf_…)</b><br/>what every worker returned;<br/>resumable from cache", 1070, 810, 220, 80, stroke=DB, fill="#F0F4FF")

d.text("t_foreman_disk", "The foreman reads and writes these; workers append their reports.", 380, 728, 600, 24, align="left", size=11)
d.edge("inspector", "f_journal", "report", exits=sides(0,0.5,1,0.5), dashed=1, waypoints=[(1340, 390), (1340, 850)])

# ---- rules callout ------------------------------------------------------ #
d.note("rules", "<b>Four rules</b><br/>1. Small, named pieces — one feature or fix, never “the whole app”.<br/>2. Fresh eyes every time — each step is a new worker with a short brief.<br/>3. Nobody grades their own homework — builder and checker are never the same.<br/>4. Truth on disk — status and decisions are files in the repo.", 40, 570, 600, 140, stroke=MGMT, fill="#FFFFFF", size=12)
d.note("engine", "<b>Under the hood</b><br/>One Claude Code dynamic workflow run (docs/plan/round2-workflow.js) drives steps 2–7 as agent() calls:<br/>Opus everywhere, max three at once, tool-call caps per role, worktree isolation, JSON report schema.<br/>“status?” joins the run journals with units.json to show each unit's stage.", 680, 570, 640, 140, stroke=NET, fill="#FFFFFF", size=12)

for p in d.check(): print("CHECK:", p)
print(d.save("unit-workflow.drawio"))
