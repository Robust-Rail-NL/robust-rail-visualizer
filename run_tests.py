"""Headless test runner for the robust-rail-visualizer.

For every scenario/plan pair below it:
  1. generates the visualizer HTML via visualize_plan.py,
  2. extracts the embedded data object (tests/js/extract.js),
  3. runs the move-animation harnesses (tests/js/harness.js,
     tests/js/midanim.js) against the extracted data in Node.

Pairs covered:
  * the hand-crafted pairs in test_scenarios/ + test_plans/,
  * two reference pairs from the sibling scenario-planning-inputs checkout,
    so regressions are caught against real planner output too.

Usage:
  python run_tests.py [--only NAME ...] [--list] [--keep-temp]

Requires Node.js on PATH (the animation checks execute the real functions.js).
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
INPUTS = SCRIPT_DIR.parent / "scenario-planning-inputs" / "Location_KleineBinckhorst"

# (name, scenario path, plan path, location.json path)
REFERENCE_PAIRS = [
    ("ref_7t_custom_example1",
     INPUTS / "scenarios" / "scenario_KleineBinckhorst_7t_custom_example1.json",
     INPUTS / "plans" / "plan_KleineBinckhorst_7t_custom_example1.json",
     INPUTS / "location.json"),
    ("ref_feasible_small",
     INPUTS / "scenarios" / "scenario_KleineBinckhorst_4t_random_1s_feasible_small.json",
     INPUTS / "plans" / "plan_KleineBinckhorst_4t_random_1s_feasible_small.json",
     INPUTS / "location.json"),
]


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", nargs="*", default=None,
                        help="Run only pairs whose name contains one of these substrings.")
    parser.add_argument("--list", action="store_true",
                        help="List the pairs that would run and exit.")
    parser.add_argument("--keep-temp", action="store_true",
                        help="Keep generated HTML/JSON even when everything passes.")
    return parser.parse_args()


def discover_pairs():
    """All (name, scenario, plan, location) tuples: crafted pairs first."""
    pairs = []
    scenarios = sorted((SCRIPT_DIR / "test_scenarios").glob("scenario_*.json"))
    plans_dir = SCRIPT_DIR / "test_plans"
    for scenario in scenarios:
        key = scenario.stem.replace("scenario_", "", 1)
        plan = plans_dir / f"plan_{key}.json"
        if plan.exists():
            pairs.append((key.replace("test_", "", 1), scenario, plan,
                          SCRIPT_DIR / "test_scenarios" / "location.json"))
        else:
            print(f"WARNING: no matching plan for {scenario.name}", file=sys.stderr)
    pairs.extend(REFERENCE_PAIRS)
    return pairs


def run(cmd, **kwargs):
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def check_pair(name, scenario, plan, location, workdir, layout, image):
    """Run all stages for one pair. Returns list of (stage, ok, detail)."""
    results = []
    html = workdir / f"{name}.html"
    data_json = workdir / f"{name}.data.json"

    def stage(label, fn):
        try:
            detail = fn()
            results.append((label, True, detail or ""))
            return True
        except StageError as exc:
            results.append((label, False, str(exc)))
            return False

    class StageError(Exception):
        pass

    def generate():
        r = run([sys.executable, str(SCRIPT_DIR / "visualize_plan.py"),
                 "--location", str(location),
                 "--scenario", str(scenario),
                 "--plan", str(plan),
                 "--layout", str(layout),
                 "--image", str(image),
                 "--output", str(html)])
        if r.returncode != 0:
            raise StageError((r.stderr or r.stdout).strip()[-800:])
        if not html.exists():
            raise StageError("no output written")
        return f"{html.stat().st_size} bytes"

    def extract():
        if shutil.which("node") is None:
            raise StageError("node not found on PATH")
        r = run(["node", str(SCRIPT_DIR / "tests" / "js" / "extract.js"),
                 str(html), str(data_json)])
        if r.returncode != 0:
            raise StageError(r.stderr.strip()[-500:])
        return r.stdout.strip()

    def js_harness(script):
        def go():
            r = run(["node", str(SCRIPT_DIR / "tests" / "js" / script), str(data_json)])
            out = r.stdout.strip()
            if r.returncode != 0:
                raise StageError(out[-1500:] or r.stderr.strip()[-500:])
            return out.splitlines()[-1] if out else ""
        return go

    stage("generate", generate)
    if results[-1][1]:
        stage("extract", extract)
    if results[-1][1]:
        stage("harness.js", js_harness("harness.js"))
        stage("midanim.js", js_harness("midanim.js"))
    return results


def main():
    args = parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

    pairs = discover_pairs()
    if args.list:
        for name, scenario, plan, _ in pairs:
            print(f"{name:<24} {scenario.name} + {plan.name}")
        return 0
    if args.only:
        pairs = [p for p in pairs if any(f in p[0] for f in args.only)]
        if not pairs:
            print("no pairs match --only", file=sys.stderr)
            return 2

    node = shutil.which("node")
    if node is None:
        print("ERROR: Node.js is required but was not found on PATH.", file=sys.stderr)
        return 2

    layout = SCRIPT_DIR / "layouts" / "kleine_binckhorst.json"
    image = SCRIPT_DIR / "layouts" / "kleine_binckhorst.png"
    workdir = Path(tempfile.mkdtemp(prefix="rail-tests-", dir=Path(tempfile.gettempdir()) / "opencode"))
    workdir.mkdir(parents=True, exist_ok=True)

    print(f"workdir: {workdir}")
    print(f"node: {node}")
    failed = []
    t0 = time.time()
    for name, scenario, plan, location in pairs:
        if not scenario.exists() or not plan.exists():
            print(f"\n== {name}\n   MISSING input: {scenario if not scenario.exists() else plan}")
            failed.append(name)
            continue
        print(f"\n== {name}")
        results = check_pair(name, scenario, plan, location, workdir, layout, image)
        for label, ok, detail in results:
            mark = "ok  " if ok else "FAIL"
            print(f"   [{mark}] {label:<12} {detail.splitlines()[-1] if detail else ''}")
        if any(not ok for _, ok, _ in results):
            failed.append(name)

    dt = time.time() - t0
    total = len(pairs)
    print(f"\n{total - len(failed)}/{total} pairs passed in {dt:.1f}s"
          + (f"; failures: {', '.join(failed)}" if failed else ""))
    if failed:
        print(f"(artifacts kept in {workdir})")
        return 1
    if not args.keep_temp:
        shutil.rmtree(workdir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
