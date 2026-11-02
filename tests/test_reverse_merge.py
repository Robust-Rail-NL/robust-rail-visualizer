"""Move/Reverse/Move chains must parse as one long move_to step."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from visualize_plan import parse_solver_plan


def act(kind, start, end, loc, path=(), su=0):
    return {"taskType": {"predefined": kind}, "startTime": start, "endTime": end,
            "location": loc, "shuntingUnit": {"id": su, "memberIDs": [su]},
            "resources": [{"kind": "trackPart", "id": p} for p in path]}


def parse(actions):
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "plan.json"
        f.write_text(json.dumps({"actions": actions}))
        return parse_solver_plan(str(f))


def test_chain_merges():
    steps = parse([
        act("Move", 0, 210, 15, [57, 23, 15]),
        act("Wait", 0, 750, 3, su=2),  # other unit in between
        act("Reverse", 210, 210, 15),
        act("Move", 210, 450, 3, [15, 23, 57, 3]),
    ])
    moves = [s for s in steps if s["action"] == "move_to"]
    assert len(moves) == 1
    assert moves[0]["args"] == ["0", "3"]
    assert moves[0]["path"] == ["57", "23", "15", "15", "23", "57", "3"]
    assert moves[0]["raw"].startswith("0..450: Move")
    assert not [s for s in steps if s["action"] == "service"]


def test_double_reverse_merges():
    steps = parse([
        act("Move", 0, 10, 15, [1, 15]),
        act("Reverse", 10, 10, 15),
        act("Move", 10, 20, 7, [15, 7]),
        act("Reverse", 20, 20, 7),
        act("Move", 20, 30, 9, [7, 9]),
    ])
    moves = [s for s in steps if s["action"] == "move_to"]
    assert len(moves) == 1 and moves[0]["path"] == ["1", "15", "15", "7", "7", "9"]


def test_lone_reverse_stays_service():
    steps = parse([act("Move", 0, 10, 15, [1, 15]), act("Reverse", 10, 10, 15)])
    assert [s["action"] for s in steps] == ["move_to", "service"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
