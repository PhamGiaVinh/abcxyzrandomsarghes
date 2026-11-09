"""Verify actual auto_explain plans, not only standalone EXPLAIN equivalents."""
import json
import sys

raw = open(sys.argv[1], encoding="utf-8").read()
decoder = json.JSONDecoder()
offset = 0
seen = {"ceiling": 0, "page": 0, "delete": 0}

def nodes(plan):
    yield plan
    for child in plan.get("Plans", []):
        yield from nodes(child)

while True:
    start = raw.find('\n{\n  "Query Text"', offset)
    if start < 0:
        break
    value, offset = decoder.raw_decode(raw, start + 1)
    query = value["Query Text"]
    kind = ("ceiling" if "coalesce(max(runid),0)" in query else
            "page" if "runid>v_after AND runid<=v_ceiling" in query else
            "delete" if "WITH locked AS MATERIALIZED" in query else None)
    if kind is None:
        continue
    seen[kind] += 1
    tree = list(nodes(value["Plan"]))
    scans = [n for n in tree if n.get("Relation Name") == "job_run_details"
             and n["Node Type"] != "ModifyTable"]
    assert scans, (kind, "missing actual source scan")
    assert all(n["Node Type"] in ("Index Scan", "Index Only Scan") for n in scans), scans
    assert all(n.get("Index Name") == "job_run_details_pkey" for n in scans), scans
    if kind == "page":
        assert any(n["Node Type"] == "Limit" for n in tree), "missing page cap"
        assert all(n.get("Actual Rows", 0) * n.get("Actual Loops", 0) <= 2 for n in scans), scans
    if kind == "delete":
        assert all(n.get("Actual Rows", 0) * n.get("Actual Loops", 0) <= 1 for n in scans), scans

assert all(seen.values()), seen
print("CRON_RETENTION_NESTED_PLANS_PASS", seen)
print("Bounds refer to returned rows in this fixture; they do not bound physical I/O or dead index entries.")
