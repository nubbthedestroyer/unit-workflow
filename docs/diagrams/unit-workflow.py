"""Generator for unit-workflow.drawio.

Run with the aws-architecture-diagram skill's builder on the path:
    python3 unit-workflow.py
It writes unit-workflow.drawio next to this file. Export a PNG with draw.io:
    drawio -x -f png -s 2 -b 20 -o unit-workflow.png unit-workflow.drawio
"""
import os, sys
sys.path.insert(0, os.path.expanduser("~/.claude/skills/aws-architecture-diagram/scripts"))
from drawio_builder import Diagram, H, sides, NET, DB, SEC, MGMT, COMPUTE

HERE = os.path.dirname(os.path.abspath(__file__))
F = 15  # body font size in every box

d = Diagram(
    "The unit workflow",
    subtitle="One request becomes shipped code: small brief, fresh workers, nobody checks their own work, everything written down",
    width=1560, height=820,
)

# ---- people (left column) ---------------------------------------------- #
d.group("people", "People", 30, 100, 300, 420, kind="generic")
d.note("you", "<b>You</b><br/>Say what you want.<br/>Decide only the big things.", 55, 150, 250, 105, stroke=MGMT, fill="#FFF7E6", size=F)
d.note("foreman", "<b>The foreman</b><br/>Writes the brief, hands out<br/>work, keeps the ledger.<br/><i>Never touches the tools.</i>", 55, 330, 250, 130, stroke=MGMT, fill="#FFF7E6", size=F)
d.edge("you", "foreman", "one request", exits=sides(0.5, 1, 0.5, 0))

# ---- one unit (two rows) ------------------------------------------------ #
d.group("unit", "One unit: runs in the background, one fresh worker per step", 360, 100, 1170, 420, kind="generic")

W, Hh = 200, 110
row1, row2 = 150, 340
x = [385, 615, 845, 1075, 1305]

d.note("brief",   "<b>1. Brief</b><br/>One page: your words,<br/>files it owns, files it<br/>must not touch, the proof.", x[0], row1, W, Hh, stroke=DB, fill="#F0F4FF", size=F)
d.note("builder", "<b>2. Builder</b><br/>Works in its own copy<br/>of the code. Cannot<br/>break anything live.", x[1], row1, W, Hh, stroke=COMPUTE, fill="#F3FBF3", size=F)
d.note("checker", "<b>3. Checker</b><br/>Runs the proof, clicks<br/>through the app, reports<br/>file + line per finding.", x[2], row1, W, Hh, stroke=SEC, fill="#FFF3F0", size=F)
d.note("tier2",   "<b>5. Second checker</b><br/>Risky units only.<br/>Its job is to refute.", x[3], row1, W, Hh, stroke=SEC, fill="#FFF3F0", size=F)
d.note("merger",  "<b>6. Merger</b><br/>Folds the branch into<br/>main, one unit at a time.", x[4], row1, W, Hh, stroke=NET, fill="#F5F0FF", size=F)

d.note("fixer",     "<b>4. Fixer</b><br/>Repairs what the checker<br/>found. Max two rounds.", x[2], row2, W, Hh, stroke=SEC, fill="#FFF3F0", size=F)
d.note("inspector", "<b>7. Inspector</b><br/>Runs the whole test suite<br/>on main. New failure, or<br/>old noise?", x[3], row2, W, Hh, stroke=NET, fill="#F5F0FF", size=F)
d.note("ship",      "<b>8. Ship</b><br/>Migrations, deploy,<br/>ledger records it.", x[4], row2, W, Hh, stroke=MGMT, fill="#FFF7E6", size=F)

d.edge("foreman", "brief", "writes", exits=sides(1, 0.5, 0, 0.5))
d.edge("brief", "builder", exits=H)
d.edge("builder", "checker", exits=H)
d.edge("checker", "fixer", "refuted", color="#B7472A", exits=sides(0.35, 1, 0.35, 0))
d.edge("fixer", "checker", "re-check", color="#B7472A", exits=sides(0.7, 0, 0.7, 1))
d.edge("checker", "tier2", "ok", exits=H)
d.edge("tier2", "merger", "ok", exits=H)
d.edge("merger", "inspector", "main", exits=sides(0, 0.85, 1, 0.5), waypoints=[(1290, 243), (1290, 395)])
d.edge("inspector", "ship", "green", exits=H)

# ---- truth on disk ----------------------------------------------------- #
d.group("disk", "Truth lives on disk, not in anyone's memory", 30, 560, 1500, 200, kind="generic")
fx = [55, 350, 645, 940, 1235]
fw = 270
d.note("f_contract", "<b>contracts/</b><br/>the brief for every unit", fx[0], 620, fw, 90, stroke=DB, fill="#F0F4FF", size=F)
d.note("f_units",    "<b>units.json</b><br/>the registry status tools read", fx[1], 620, fw, 90, stroke=DB, fill="#F0F4FF", size=F)
d.note("f_ledger",   "<b>ledger.md</b><br/>one row per unit, every<br/>check, fix and merge", fx[2], 620, fw, 90, stroke=DB, fill="#F0F4FF", size=F)
d.note("f_resume",   "<b>resume.md</b><br/>where the last session stopped;<br/>a new one reads it first", fx[3], 620, fw, 90, stroke=DB, fill="#F0F4FF", size=F)
d.note("f_journal",  "<b>run journal</b><br/>what every worker returned;<br/>resumable from cache", fx[4], 620, fw, 90, stroke=DB, fill="#F0F4FF", size=F)
d.text("t_disk", "The foreman reads and writes these. Workers append their reports. Nothing lives only in a chat.", 30, 730, 1500, 24, align="center", size=13)

for p in d.check():
    print("CHECK:", p)
print(d.save(os.path.join(HERE, "unit-workflow.drawio")))
