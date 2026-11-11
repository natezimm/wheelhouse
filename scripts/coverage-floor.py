#!/usr/bin/env python3
"""Fails when a project's line coverage falls below its floor, and writes the table to the job summary.

Usage: coverage-floor.py <coverage.cobertura.xml> Package=0.90 [Package=0.85 ...]
Packages named without a floor are not listed; every package in the report is shown.
"""
import os
import sys
import xml.etree.ElementTree as ET


def main() -> int:
    report, *floors = sys.argv[1:]
    wanted = {name: float(floor) for name, floor in (f.split("=", 1) for f in floors)}
    packages = {p.get("name"): (float(p.get("line-rate")), float(p.get("branch-rate"))) for p in ET.parse(report).getroot().iter("package")}

    rows = ["| Project | Lines | Branches | Floor |", "| --- | --- | --- | --- |"]
    failed = []
    for name, (lines, branches) in sorted(packages.items()):
        floor = wanted.get(name)
        mark = "" if floor is None else f"{floor:.0%}" + (" ❌" if lines < floor else " ✅")
        rows.append(f"| {name} | {lines:.1%} | {branches:.1%} | {mark} |")
        if floor is not None and lines < floor:
            failed.append(f"{name} line coverage {lines:.1%} is below its floor of {floor:.0%}")
    missing = sorted(set(wanted) - set(packages))
    failed += [f"{name} is not in the coverage report" for name in missing]

    table = "\n".join(["### Test coverage", "", *rows, ""])
    print(table)
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as out:
            out.write(table + "\n")
    for line in failed:
        print(f"::error::{line}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
