import json
import re
import sys

raw = open(sys.argv[1], encoding="utf-8").read()
decoder = json.JSONDecoder()
plans = []
for match in re.finditer(r'\{\s*"Query Text"', raw):
    try:
        plan, _ = decoder.raw_decode(raw[match.start():])
        plans.append(plan)
    except json.JSONDecodeError:
        continue

history_nodes = []
def walk(node):
    if node.get("Relation Name") == "dealer_rotation_schedule":
        history_nodes.append(node)
    for child in node.get("Plans", []):
        walk(child)

for plan in plans:
    # Evidence for the actual nested queries inside cleanup, not assertion counts.
    query = plan.get("Query Text", "")
    if "policy" in query or "candidates AS MATERIALIZED" in query:
        walk(plan.get("Plan", {}))

assert history_nodes, "No actual nested cleanup plans captured"
assert all(n["Node Type"] != "Seq Scan" for n in history_nodes), "Cleanup scans full history"
for node in history_nodes:
    if node.get("Actual Rows", 0) > 5000:
        print(json.dumps({k: node.get(k) for k in ("Node Type", "Index Name", "Actual Rows", "Actual Loops", "Rows Removed by Filter")}))
assert all(n.get("Actual Rows", 0) <= 5000 for n in history_nodes), "Cleanup reads more than a batch per scan"
print(json.dumps({"fixtureHistoryRows": 1000000, "nestedPlans": len(plans),
                  "historyAccessNodes": len(history_nodes), "fullHistorySeqScan": False,
                  "maximumRowsPerHistoryScan": max(n.get("Actual Rows", 0) for n in history_nodes)}))
