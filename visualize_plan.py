import argparse
import base64
import json
import re
import struct
from pathlib import Path


ACTION_RE = re.compile(r"^\s*(?:\d+(?:\.\d+)?:\s*)?\(([^)]+)\)")
CALL_RE = re.compile(r"^\s*([A-Za-z_][\w-]*)\((.*)\)\s*$")

IMAGES_DIR = Path(__file__).resolve().parent / "Images"

# Unit type -> sprite file. Only these four have dedicated art for now.
SPRITE_FILES = {
    "ICR": "icr_rijtuig_ATP.png",
    "SLT": "slt_treinstel.png",
    "SNG": "sng_rijtuig_ATP.png",
    "VIRM": "virm_treinstel.png",
}

# Types without their own sprite reuse one of the above until better art exists.
SPRITE_FALLBACKS = {
    "DDZ": "VIRM",
    "FFF": "SLT",
    "ICM": "ICR",
    "ICNG": "ICR",
    "SGMM": "SLT",
}

# Which way the sprite's front points inside its own image: +1 = right (+x),
# -1 = left, 0 = symmetric so orientation does not matter.
SPRITE_FRONT = {
    "ICR": 0,
    "SLT": 0,
    "SNG": 1,
    "VIRM": -1,
}


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


# def sanitize_pddl_name(name):
#     text = str(name).replace("-", "_")
#     if not text:
#         return text
#     if text[0].isdigit():
#         return "o_" + text
#     return text


def unsanitize_track_token(token):
    return token[2:] if token.startswith("o_") else token


def build_track_maps(location):
    tracks = location.get("trackParts", [])
    id_to_track = {str(track["id"]): track for track in tracks}
    name_to_track = {str(track["name"]): track for track in tracks}
    return id_to_track, name_to_track


def to_track_id(token, id_to_track, name_to_track):
    token = str(token)
    if token in id_to_track:
        return token
    track = name_to_track.get(token)
    if track:
        return str(track["id"])
    stripped = unsanitize_track_token(token)
    if stripped != token:
        return to_track_id(stripped, id_to_track, name_to_track)
    return token


def track_name(track_id, id_to_track):
    track = id_to_track.get(str(track_id))
    return str(track["name"]) if track else str(track_id)


def build_edges(location, id_to_track):
    edges = []
    seen = set()
    for track in location.get("trackParts", []):
        src = str(track["id"])
        for nb_id in track.get("aSide", []):
            nb = id_to_track.get(str(nb_id))
            if not nb:
                continue
            tgt = str(nb["id"])
            key = tuple(sorted([src, tgt]))
            if key not in seen:
                edges.append({"source": src, "sourceSide": "a", "target": tgt, "targetSide": "b"})
                seen.add(key)
        for nb_id in track.get("bSide", []):
            nb = id_to_track.get(str(nb_id))
            if not nb:
                continue
            tgt = str(nb["id"])
            key = tuple(sorted([src, tgt]))
            if key not in seen:
                edges.append({"source": src, "sourceSide": "b", "target": tgt, "targetSide": "a"})
                seen.add(key)
    return edges


def parse_plan(path, id_to_track=None):
    if str(path).lower().endswith(".json"):
        return parse_solver_plan(path, id_to_track)
    steps = []
    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            match = ACTION_RE.match(line)
            if match:
                parts = match.group(1).split()
            else:
                call_match = CALL_RE.match(line)
                if not call_match:
                    continue
                parts = [call_match.group(1)] + [
                    item.strip() for item in call_match.group(2).split(",") if item.strip()
                ]
            if not parts:
                continue
            steps.append({"raw": line, "action": parts[0].lower(), "args": parts[1:]})
    return steps


def task_type_name(action):
    task_type = action.get("taskType", {})
    predefined = task_type.get("predefined")
    other = task_type.get("other")
    if predefined:
        return predefined
    if other:
        return other
    return str(task_type)


def _is_track_part(resource):
    """Resources are {kind, id} now, not one nullable field per kind."""
    return resource.get("kind") == "trackPart" and resource.get("id") is not None


def action_track(action):
    resources = action.get("resources", [])
    for resource in reversed(resources):
        if _is_track_part(resource):
            return str(resource["id"])
    if action.get("location") is not None:
        return str(action["location"])
    return None


def action_path_resources(action):
    resources = action.get("resources", [])
    return [str(r["id"]) for r in resources if _is_track_part(r)]


def parse_solver_plan(path, id_to_track=None):
    plan = load_json(path)
    actions = sorted(
        plan.get("actions", []),
        key=lambda a: (int(a.get("startTime", 0)), int(a.get("endTime", 0))),
    )

    def display(track_id):
        return track_name(track_id, id_to_track) if id_to_track else str(track_id)

    steps = []
    for action in actions:
        task_name = task_type_name(action)
        # memberIDs, not members: the shunting unit carries IDs now, not
        # embedded TrainUnit objects.
        member_ids = action.get("shuntingUnit", {}).get("memberIDs", [])
        if member_ids:
            train = "+".join(str(m) for m in member_ids)
        else:
            train = "su_" + str(action.get("shuntingUnit", {}).get("id", "unknown"))
        track = action_track(action)
        path_raw = action_path_resources(action)
        if task_name == "Wait":
            steps.append({"raw": f"{action.get('startTime')}..{action.get('endTime')}: Wait {train}", "action": "wait", "args": [train]})
        elif task_name == "Combine":
            child_ids = action.get("shuntingUnit", {}).get("childIDs", [])
            combined_train = train
            for cid in child_ids:
                for a in actions:
                    if a.get("shuntingUnit", {}).get("id") == cid:
                        cm = a.get("shuntingUnit", {}).get("memberIDs", [])
                        if cm:
                            combined_train = "+".join(str(m) for m in cm)
                            break
            args = [combined_train]
            if track:
                args.append(track)
            steps.append({"raw": f"{action.get('startTime')}..{action.get('endTime')}: Combine {combined_train}", "action": "combine", "args": args})
        elif task_name == "Split":
            children = []
            for cid in action.get("shuntingUnit", {}).get("childIDs", []):
                for a in actions:
                    if a.get("shuntingUnit", {}).get("id") == cid:
                        cm = a.get("shuntingUnit", {}).get("memberIDs", [])
                        if cm:
                            children.append("+".join(str(m) for m in cm))
                            break
            args = [train]
            if track:
                args.append(track)
            label = f"Split {train}"
            if children:
                label += " \u2192 " + ", ".join(children)
            steps.append({"raw": f"{action.get('startTime')}..{action.get('endTime')}: {label}", "action": "split", "args": args, "children": children})
        elif not track:
            continue
        elif task_name == "Move":
            steps.append({"raw": f"{action.get('startTime')}..{action.get('endTime')}: Move {train} \u2192 {display(track)}", "action": "move_to", "args": [train, track], "path": path_raw})
        elif task_name in ("Arrive", "StandIn"):
            steps.append({"raw": f"{action.get('startTime')}: Arrive {train} @ {display(track)}", "action": "arrive", "args": [train, track], "path": path_raw})
        elif task_name in ("Exit", "StandOut"):
            # A unit that stays in the yard used to be an Exit carrying
            # standingType="OutStanding"; the schema expresses it as StandOut.
            action_name = "park" if task_name == "StandOut" else "depart"
            label = "Park" if action_name == "park" else "Depart"
            steps.append({"raw": f"{action.get('startTime')}: {label} {train} @ {display(track)}", "action": action_name, "args": [train, track], "path": path_raw})
        else:
            steps.append({"raw": f"{action.get('startTime')}..{action.get('endTime')}: {task_name} {train} @ {display(track)}", "action": "service", "args": [train, track], "path": path_raw, "service_type": task_name})
    return steps


def entry_side_of(track_id, neighbor_id, location):
    """Which side of `track_id` connects to `neighbor_id` ('a' or 'b', None if unknown)."""
    track_id = str(track_id)
    neighbor_id = str(neighbor_id)
    for part in location.get("trackParts", []):
        if str(part.get("id")) != track_id:
            continue
        if neighbor_id in [str(x) for x in part.get("aSide", [])]:
            return "a"
        if neighbor_id in [str(x) for x in part.get("bSide", [])]:
            return "b"
        return None
    return None


def entry_side_from_path(raw_path, target, location):
    """Entry side of `target` given a path list whose last hop is <neighbor> -> <target>."""
    if raw_path and len(raw_path) >= 2:
        return entry_side_of(target, raw_path[-2], location)
    return None


def initial_train_positions(scenario, id_to_track):
    trains = {}

    def member_name(train):
        members = train.get("members", [])
        if members:
            # A member is (typePrefix, carriages, id) since the unification; it
            # used to wrap a trainUnit object carrying the id and the type.
            return "+".join(str(m["id"]) for m in members)
        return "train" + str(train["id"])

    # Only include trains already standing in the yard at t=0
    # Incoming trains (section "in") are NOT in the yard yet — they appear via Arrive actions
    for train in scenario.get("inStanding", []):
        track_id = train.get("firstParkingTrackPart") or train.get("entryTrackPart")
        if track_id and str(track_id) in id_to_track:
            trains[member_name(train)] = {
                "track": str(track_id),
                "status": "active",
                "restSide": "b",
            }
    return trains


def dedupe_consecutive(raw_path):
    seen = []
    for t in raw_path:
        t = str(t)
        if t and (not seen or t != seen[-1]):
            seen.append(t)
    return seen


def member_lengths_from_scenario(scenario):
    """Unit id -> length, resolved through the scenario's type table.

    A member carries only (typePrefix, carriages, id) since the unification: the
    type, and so the length, lives once in trainUnitTypes rather than being
    embedded in every member. This used to read member["trainUnit"]["type"]
    ["length"] and walk `in`/`inStanding`/`out` as objects wrapping `trains` and
    `trainRequests` — all four of those shapes are gone.
    """
    if not isinstance(scenario, dict):
        return {}

    type_lengths = {}
    for unit_type in scenario.get("trainUnitTypes", []) or []:
        length = unit_type.get("length")
        if length is not None:
            key = (unit_type.get("typePrefix"), unit_type.get("carriages"))
            type_lengths[key] = float(length)

    lengths = {}

    def add_member(member):
        if not isinstance(member, dict):
            return
        unit_id = member.get("id")
        length = type_lengths.get((member.get("typePrefix"), member.get("carriages")))
        if unit_id is not None and length is not None:
            lengths[str(unit_id)] = length

    for train in list(scenario.get("in") or []) + list(scenario.get("inStanding") or []):
        for member in train.get("members", []) or []:
            add_member(member)
    # Departure requests name units the same way, though their ids are usually
    # null — the unit is chosen by type, not identity.
    for request in list(scenario.get("out") or []) + list(scenario.get("outStanding") or []):
        for unit in request.get("trainUnits", []) or []:
            add_member(unit)

    return lengths


def member_lengths_from_plan(plan_path):
    """Unit lengths harvested from a plan.

    Returns nothing for current plans, deliberately. It reads lengths off
    TrainUnit objects that used to be embedded in each action's shuntingUnit;
    the schema carries memberIDs now, so the plan no longer knows a unit's
    length. The caller falls back to the scenario, which is where that belongs
    — but note member_lengths_from_scenario still reads the pre-unification
    scenario shape and needs its own pass.
    """
    lengths = {}
    if not plan_path or not Path(plan_path).exists():
        return lengths
    if not str(plan_path).lower().endswith(".json"):
        return lengths
    plan = load_json(plan_path)
    for action in plan.get("actions", []) or []:
        members = action.get("shuntingUnit", {}).get("members", []) or []
        for member in members:
            unit_id = str(member.get("id", ""))
            length = member.get("type", {}).get("length")
            if unit_id and length:
                lengths[unit_id] = float(length)
    return lengths


def collect_train_lengths(scenario, plan_path, states):
    """Map train name -> total length (m). Names are '+' -joined member ids."""
    member_lengths = {}
    member_lengths.update(member_lengths_from_scenario(scenario))
    member_lengths.update(member_lengths_from_plan(plan_path))
    if not member_lengths:
        return {}
    names = set()
    for state in states:
        names.update(state.get("trains", {}).keys())
    result = {}
    for name in names:
        total = sum(member_lengths.get(part, 0) for part in str(name).split("+"))
        if total > 0:
            result[name] = total
    return result


def member_type_map(scenario):
    """member id -> typePrefix for every unit a plan can materialize."""
    if not isinstance(scenario, dict):
        return {}
    types = {}
    for train in list(scenario.get("in") or []) + list(scenario.get("inStanding") or []):
        for member in train.get("members", []) or []:
            unit_id = member.get("id")
            if unit_id is not None:
                types[str(unit_id)] = member.get("typePrefix")
    return types


def collect_train_units(scenario, states):
    """Map train name -> list of {typePrefix, length}, in physical draw order.

    The JS lays sprite units along the track starting at the a-side end of the
    train's span, so a consist's member order must match how the members were
    actually stacked before coupling.  With deep-pack parking the earliest
    lander rests deepest against its restSide end: an a-resting group is packed
    upward from the a end (low fractions = landing order), a b-resting group
    downward from the b end (low fractions = reverse landing order).
    Single-name trains are unaffected.
    """
    member_types = member_type_map(scenario)
    if not member_types:
        return {}
    lengths = member_lengths_from_scenario(scenario)

    def consist_draw_order(name):
        members = str(name).split("+")
        all_idx = [i for i, st in enumerate(states) if name in st.get("trains", {})]
        if not all_idx:
            return members
        idx = all_idx[-1]
        ref = states[idx - 1] if idx > 0 else states[idx]
        track = None
        for m in members:
            info = ref.get("trains", {}).get(m, {})
            if info.get("track"):
                track = info["track"]
                break
        ordered = None
        if track is not None:
            landed = [t for t in (ref.get("trackOrder") or {}).get(track, []) if t in members]
            if len(landed) == len(members):
                ordered = landed
        side = states[idx].get("trains", {}).get(name, {}).get("restSide")
        if ordered is None:
            return members
        return list(reversed(ordered)) if side == "b" else ordered

    names = set()
    for state in states:
        names.update(state.get("trains", {}).keys())
    result = {}
    for name in names:
        parts = consist_draw_order(name) if "+" in str(name) else str(name).split("+")
        units = []
        for part in parts:
            type_prefix = member_types.get(part)
            if type_prefix:
                units.append({"typePrefix": type_prefix, "length": lengths.get(part, 0)})
        if units:
            result[name] = units
    return result


def simulate_steps(initial_trains, steps, id_to_track, location=None):
    states = [{"index": 0, "action": "initial", "action_type": "initial", "train": None, "raw": "Initial state", "trains": json.loads(json.dumps(initial_trains))}]
    trains = json.loads(json.dumps(initial_trains))

    def land(train, target, status="active"):
        prev_track = trains.get(train, {}).get("track")
        tid = to_track_id(target, id_to_track, {})
        entry = entry_side_from_path(raw_path, tid, location)
        if entry is None and location and prev_track and prev_track != tid:
            entry = entry_side_of(tid, prev_track, location)
        trains.setdefault(train, {"track": None, "status": "active"})
        trains[train]["track"] = tid
        trains[train]["status"] = status
        rest = {"a": "b", "b": "a"}.get(entry)
        if rest:
            trains[train]["restSide"] = rest
        return tid

    for index, step in enumerate(steps, start=1):
        action = step["action"]
        args = step["args"]
        label = step["raw"]
        involved_train = args[0] if args else None
        raw_path = step.get("path")

        if raw_path:
            train_path = {involved_train: dedupe_consecutive(raw_path)}
        else:
            train_path = {}

        service_type = None
        pre_member_tracks = None
        pre_parent_track = None
        parent_name = None
        child_names = None

        if action == "move" and len(args) >= 3:
            train, source, target = args[:3]
            land(train, target, "active")
            action_type = "move"
        elif action == "move_to" and len(args) >= 2:
            train, target = args[:2]
            land(train, target, "active")
            action_type = "move"
        elif action == "arrive" and len(args) >= 2:
            train, target = args[:2]
            land(train, target, "active")
            action_type = "arrive"
        elif action == "park" and len(args) >= 2:
            train, track = args[:2]
            land(train, track, "parked")
            trains[train]["wasParked"] = True
            action_type = "park"
            if "+" in train:
                for member_id in train.split("+"):
                    if member_id in trains:
                        trains[member_id]["track"] = to_track_id(track, id_to_track, {})
                        trains[member_id]["status"] = "parked"
                        trains[member_id]["wasParked"] = True
                        if trains[train].get("restSide"):
                            trains[member_id]["restSide"] = trains[train]["restSide"]
        elif action == "depart" and len(args) >= 2:
            train, track = args[:2]
            land(train, track, "departed")
            action_type = "depart"
            if "+" in train:
                for member_id in train.split("+"):
                    if member_id in trains and trains[member_id].get("status") != "absorbed":
                        trains[member_id]["status"] = "departed"
        elif action == "combine" and len(args) >= 1:
            train = args[0]
            track = args[1] if len(args) >= 2 else None
            pre_member_tracks = {}
            if "+" in train:
                members = train.split("+")
                for m in members:
                    if m in trains:
                        pre_member_tracks[m] = trains[m].get("track")
                if track is None:
                    for m in members:
                        if m in trains and trains[m].get("track"):
                            track = trains[m]["track"]
                            break
                track = to_track_id(track, id_to_track, {}) if track else None
                side = next((trains[m].get("restSide") for m in members if m in trains and trains[m].get("restSide")), None)
                trains[train] = {"track": track, "status": "combined"}
                if side:
                    trains[train]["restSide"] = side
                for m in members:
                    if m in trains:
                        trains[m]["status"] = "absorbed"
                # Intermediate consists made entirely of this consist's
                # members (e.g. "6+7" when forming "13+6+7") no longer exist
                # as separate rolling stock: absorb them too, otherwise they
                # keep claiming parking space next to the new consist.
                member_set = set(members)
                for other in list(trains):
                    if other == train or "+" not in other:
                        continue
                    if trains[other].get("status") == "departed":
                        continue
                    if set(other.split("+")) <= member_set:
                        trains[other]["status"] = "absorbed"
            elif train in trains:
                trains[train]["status"] = "combined"
            action_type = "combine"
        elif action == "split" and len(args) >= 1:
            parent = args[0]
            track = args[1] if len(args) >= 2 else None
            pre_parent_track = trains.get(parent, {}).get("track") if parent in trains else None
            combined = trains.pop(parent, None)
            if combined is None and "+" in parent:
                parent_set = set(parent.split("+"))
                for key in list(trains):
                    if "+" in key and set(key.split("+")) == parent_set:
                        combined = trains.pop(key)
                        pre_parent_track = pre_parent_track or combined.get("track")
                        break
            if track is None and combined:
                track = combined.get("track")
            track = to_track_id(track, id_to_track, {}) if track else None
            children = step.get("children") or (parent.split("+") if "+" in parent else [parent])
            for ci, child in enumerate(children):
                trains[child] = {"track": track, "status": "active"}
                if combined and combined.get("restSide"):
                    trains[child]["restSide"] = combined["restSide"]
                trains[child]["sort_order"] = len(children) - 1 - ci
            action_type = "split"
            parent_name = parent
            child_names = children
        elif action in ("move_aside_empty", "move_aside_occupied",
                        "move_bside_empty", "move_bside_occupied") and len(args) >= 3:
            train, source, target = args[:3]
            land(train, target, "active")
            action_type = "move"
        elif action in ("depart_aside", "depart_bside") and len(args) >= 2:
            train, track = args[:2]
            land(train, track, "departed")
            action_type = "depart"
        elif action == "service" and len(args) >= 2:
            train, target = args[:2]
            land(train, target, "service")
            action_type = "service"
            service_type = step.get("service_type")
        elif action in ("start_move", "end_move"):
            action_type = "wait"
        elif action in ("wait",):
            action_type = "wait"
        else:
            action_type = "service"

        state_entry = {
            "index": index,
            "action": action,
            "action_type": action_type,
            "train": involved_train,
            "raw": label,
            "trains": json.loads(json.dumps(trains)),
            "train_path": train_path,
        }
        if service_type is not None:
            state_entry["service_type"] = service_type
        if pre_member_tracks is not None:
            state_entry["pre_member_tracks"] = pre_member_tracks
        if pre_parent_track is not None:
            state_entry["pre_parent_track"] = pre_parent_track
        if parent_name is not None:
            state_entry["parent_name"] = parent_name
        if child_names is not None:
            state_entry["child_names"] = child_names
        states.append(state_entry)

    # Per-state track arrival order: for every track, list the trains on it sorted
    # by the state index at which each train most recently landed there. The train
    # that has been on the track longest keeps the wall spot; later arrivals stack
    # behind it instead of swapping places.
    def landing_index(state_index, train_name):
        track = states[state_index]["trains"][train_name]["track"]
        j = state_index
        while j > 0:
            prev_track = states[j - 1]["trains"].get(train_name, {}).get("track")
            if prev_track != track:
                return j
            j -= 1
        return 0

    for i, state in enumerate(states):
        arrivals = {}
        for train_name, info in state["trains"].items():
            track = info.get("track")
            if track and info.get("status") not in ("departed", "absorbed"):
                arrivals.setdefault(track, []).append((landing_index(i, train_name), info.get("sort_order", 0), train_name))
        state["trackOrder"] = {track: [t for _, _, t in sorted(lst)] for track, lst in arrivals.items()}

    return states


def load_layout(layout_path):
    if layout_path and Path(layout_path).exists():
        return load_json(layout_path)
    return {"tracks": {}}


def encode_image_base64(image_path):
    path = Path(image_path)
    if not path.exists():
        return None
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    ext = path.suffix.lower()
    mime = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "svg": "image/svg+xml",
    }.get(ext.lstrip("."), "image/png")
    return f"data:{mime};base64,{data}"


def png_dimensions(path):
    """(width, height) read from the PNG header, or (0, 0) for a non-PNG file."""
    with open(path, "rb") as handle:
        header = handle.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        return 0, 0
    return struct.unpack(">II", header[16:24])


def load_unit_images():
    """{typePrefix: {"uri", "aspect", "flip"}} for every sprite that exists.

    Types without their own sprite are resolved to their fallback here, so the
    JS never has to map unknown types itself. `aspect` is h/w (used to size the
    sprite so its width covers the unit's track fraction); `flip` is True when
    the sprite faces left in its own image.
    """
    images = {}
    for type_prefix, filename in SPRITE_FILES.items():
        path = IMAGES_DIR / filename
        if not path.exists():
            continue
        uri = encode_image_base64(path)
        if uri is None:
            continue
        width, height = png_dimensions(path)
        images[type_prefix] = {
            "uri": uri,
            "aspect": (height / width) if width else 1.0,
            "flip": SPRITE_FRONT.get(type_prefix) == -1,
        }
    for type_prefix, fallback in SPRITE_FALLBACKS.items():
        if fallback in images and type_prefix not in images:
            images[type_prefix] = images[fallback]
    return images


PARTICLE_FILES = {"waterdrop": "waterdrop.jpg", "gears": "gears.jpg"}


def load_particle_images():
    """{name: uri} for every particle image that exists."""
    images = {}
    for name, filename in PARTICLE_FILES.items():
        path = IMAGES_DIR / filename
        if not path.exists():
            continue
        uri = encode_image_base64(path)
        if uri is not None:
            images[name] = uri
    return images


def render_html(location_name, states, edges, layout, output_path, image_data_uri=None, image_width=None, image_height=None, track_meta=None, train_lengths=None, unit_images=None, train_units=None, particle_images=None):
    payload = {
        "locationName": location_name,
        "states": states,
        "edges": edges,
        "positions": layout.get("tracks", {}),
        "imageDataUri": image_data_uri,
        "imageWidth": image_width,
        "imageHeight": image_height,
        "trackMeta": track_meta or {},
        "trainLengths": train_lengths or {},
        "unitImages": unit_images or {},
        "trainUnits": train_units or {},
        "particleImages": particle_images or {},
    }
    data_json = json.dumps(payload)

    document = f"""<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shunting Plan \u2014 {location_name}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

    [data-theme="light"] {{
      --bg: #f8f9fb; --surface: #ffffff; --surface2: #f3f4f6;
      --border: #e5e7ef; --text: #1a1d23; --text2: #374151; --muted: #6b7280; --heading: #111827;
      --badge-arrive-bg: #dbeafe; --badge-arrive-fg: #1d4ed8;
      --badge-move-bg: #ffedd5;   --badge-move-fg: #c2410c;
      --badge-park-bg: #d1fae5;   --badge-park-fg: #065f46;
      --badge-depart-bg: #f3f4f6; --badge-depart-fg: #6b7280;
      --badge-service-bg: #f3e8ff;--badge-service-fg: #7e22ce;
      --badge-wait-bg: #f9fafb;   --badge-wait-fg: #9ca3af;
      --badge-initial-bg: #f3f4f6;--badge-initial-fg: #374151;
      --badge-combine-bg: #f3e8ff;--badge-combine-fg: #7e22ce;
      --status-active-bg: #dbeafe;  --status-active-fg: #1d4ed8;
      --status-waiting-bg: #f9fafb; --status-waiting-fg: #9ca3af;
      --status-parked-bg: #d1fae5;  --status-parked-fg: #065f46;
      --status-service-bg: #fef3c7; --status-service-fg: #92400e;
      --status-departed-bg: #f3f4f6;--status-departed-fg: #9ca3af;
      --status-combined-bg: #f3e8ff;--status-combined-fg: #7e22ce;
      --status-absorbed-bg: #f3f4f6;--status-absorbed-fg: #9ca3af;
      --track-changed-bg: #fef3c7; --track-changed-fg: #92400e;
      --track-normal-fg: #374151; --track-departed-fg: #d1d5db;
      --action-bar-bg: #eff6ff; --action-bar-border: #bfdbfe; --action-bar-fg: #1e40af;
      --row-hover: #f0f7ff; --row-selected: #eff6ff;
      --timeline-hover: #f9fafb; --timeline-selected: #eff6ff;
      --timeline-selected-border: #3b82f6; --timeline-selected-fg: #1d4ed8;
      --th-bg: #f8f9fb; --stat-val: #111827;
      --btn-bg: #f3f4f6; --btn-border: #d1d5db; --btn-fg: #374151; --btn-hover: #e5e7eb;
      --play-bg: #3b82f6; --play-hover: #2563eb;
      --yard-bg: #f1f5f9; --yard-edge: #cbd5e1; --yard-node: #94a3b8;
    }}
    [data-theme="dark"] {{
      --bg: #0f1117; --surface: #181c27; --surface2: #1e2333;
      --border: #2a2f42; --text: #e2e8f8; --text2: #c9d1e8; --muted: #6b7599; --heading: #f1f5ff;
      --badge-arrive-bg: #1e3a5f;  --badge-arrive-fg: #93c5fd;
      --badge-move-bg: #431407;    --badge-move-fg: #fdba74;
      --badge-park-bg: #064e3b;    --badge-park-fg: #6ee7b7;
      --badge-depart-bg: #1f2937;  --badge-depart-fg: #9ca3af;
      --badge-service-bg: #2e1065; --badge-service-fg: #d8b4fe;
      --badge-wait-bg: #1f2937;    --badge-wait-fg: #6b7280;
      --badge-initial-bg: #1f2937; --badge-initial-fg: #9ca3af;
      --badge-combine-bg: #2e1065; --badge-combine-fg: #d8b4fe;
      --status-active-bg: #1e3a5f;  --status-active-fg: #93c5fd;
      --status-waiting-bg: #1f2937; --status-waiting-fg: #6b7280;
      --status-parked-bg: #064e3b;  --status-parked-fg: #6ee7b7;
      --status-service-bg: #451a03; --status-service-fg: #fbbf24;
      --status-departed-bg: #1f2937;--status-departed-fg: #6b7280;
      --status-combined-bg: #2e1065;--status-combined-fg: #d8b4fe;
      --status-absorbed-bg: #1f2937;--status-absorbed-fg: #6b7280;
      --track-changed-bg: #451a03; --track-changed-fg: #fdba74;
      --track-normal-fg: #c9d1e8; --track-departed-fg: #374151;
      --action-bar-bg: #1e3a5f; --action-bar-border: #1d4ed8; --action-bar-fg: #93c5fd;
      --row-hover: #1e2436; --row-selected: #1e3a5f;
      --timeline-hover: #1e2333; --timeline-selected: #1e2436;
      --timeline-selected-border: #3b82f6; --timeline-selected-fg: #93c5fd;
      --th-bg: #0f1117; --stat-val: #f1f5ff;
      --btn-bg: #1e2333; --btn-border: #2a2f42; --btn-fg: #e2e8f8; --btn-hover: #2a2f42;
      --play-bg: #3b82f6; --play-hover: #2563eb;
      --yard-bg: #141824; --yard-edge: #2a2f42; --yard-node: #374151;
}}

    body {{ font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; font-size: 13px; transition: background 0.2s, color 0.2s; }}

    header {{ display: flex; align-items: center; gap: 12px; padding: 10px 20px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap; }}
    h1 {{ font-size: 14px; font-weight: 600; color: var(--heading); }}
    .loc {{ font-size: 12px; color: var(--muted); }}
    .controls {{ display: flex; align-items: center; gap: 8px; margin-left: auto; }}
    button {{ background: var(--btn-bg); border: 1px solid var(--btn-border); color: var(--btn-fg); padding: 5px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; white-space: nowrap; transition: background 0.15s; }}
    button:hover {{ background: var(--btn-hover); }}
    button.play {{ background: var(--play-bg); color: #fff; border-color: var(--play-bg); }}
    button.play:hover {{ background: var(--play-hover); }}
    .ctr {{ font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 50px; }}
    input[type=range] {{ width: 140px; accent-color: #3b82f6; }}

    #summary {{ display: flex; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; }}
    .stat {{ flex: 1; padding: 10px 20px; border-right: 1px solid var(--border); }}
    .stat:last-child {{ border-right: none; }}
    .stat-val {{ font-size: 20px; font-weight: 700; color: var(--stat-val); line-height: 1; }}
    .stat-label {{ font-size: 11px; color: var(--muted); margin-top: 3px; }}

    #action-bar {{ padding: 8px 20px; background: var(--action-bar-bg); border-bottom: 1px solid var(--action-bar-border); font-size: 12px; color: var(--action-bar-fg); flex-shrink: 0; min-height: 34px; display: flex; align-items: center; gap: 8px; }}
    .action-badge {{ padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }}

    /* YARD MAP */
    #yard-panel {{ background: var(--yard-bg); border-bottom: 1px solid var(--border); flex: 1; padding: 8px 20px; display: flex; align-items: center; gap: 12px; min-height: 0; }}
    #yard-panel.panel-open {{ flex: none; height: 50vh; }}
    #panel-toggle {{ background: var(--surface); border-bottom: 1px solid var(--border); text-align: center; padding: 4px 0; cursor: pointer; flex-shrink: 0; font-size: 14px; color: var(--muted); user-select: none; }}
    #panel-toggle:hover {{ background: var(--action-bar-bg); }}
    #yard-label {{ font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; }}
    #yard-svg-wrap {{ flex: 1; overflow: hidden; min-height: 0; align-self: stretch; }}
    #yard-svg {{ width: 100%; height: 100%; display: block; }}
    #yard-legend {{ display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }}
    .yard-leg {{ display: flex; align-items: center; gap: 5px; font-size: 10px; color: var(--muted); white-space: nowrap; }}
    .yard-leg-dot {{ width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }}

    main {{ display: grid; grid-template-columns: 1fr 260px; flex: 1; overflow: hidden; }}

    #table-wrap {{ overflow: auto; padding: 16px; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th {{ text-align: left; padding: 8px 12px; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid var(--border); position: sticky; top: 0; background: var(--th-bg); z-index: 1; white-space: nowrap; }}
    td {{ padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }}
    tr.data-row {{ cursor: pointer; }}
    tr.data-row:hover td {{ background: var(--row-hover); }}
    tr.data-row.selected td {{ background: var(--row-selected); }}

    .train-dot {{ display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; flex-shrink: 0; }}
    .train-name {{ font-weight: 600; font-size: 12px; color: var(--heading); font-family: monospace; }}
    .train-len {{ font-size: 10px; color: var(--muted); font-weight: 400; margin-left: 4px; }}
    .status-badge {{ display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 500; }}
    .status-active   {{ background: var(--status-active-bg);   color: var(--status-active-fg); }}
    .status-waiting  {{ background: var(--status-waiting-bg);  color: var(--status-waiting-fg); }}
    .status-parked   {{ background: var(--status-parked-bg);   color: var(--status-parked-fg); }}
    .status-service  {{ background: var(--status-service-bg);  color: var(--status-service-fg); }}
    .status-departed {{ background: var(--status-departed-bg); color: var(--status-departed-fg); }}
    .status-combined {{ background: var(--status-combined-bg); color: var(--status-combined-fg); }}
    .status-absorbed {{ background: var(--status-absorbed-bg); color: var(--status-absorbed-fg); }}
    .track-cell {{ font-family: monospace; font-size: 12px; font-weight: 500; }}
    .track-changed  {{ background: var(--track-changed-bg); color: var(--track-changed-fg); border-radius: 4px; padding: 2px 6px; }}
    .track-normal   {{ color: var(--track-normal-fg); }}
    .track-departed {{ color: var(--track-departed-fg); }}
    .prev-track {{ font-family: monospace; font-size: 11px; color: var(--muted); }}

    tr.data-row.is-combined td {{ opacity: 0.35; color: var(--muted); }}

    aside {{ border-left: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; overflow: hidden; }}
    .aside-head {{ padding: 10px 14px; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }}
    #filter-label {{ font-size: 11px; color: #3b82f6; font-weight: 500; cursor: pointer; text-transform: none; letter-spacing: 0; }}
    #timeline {{ overflow-y: auto; flex: 1; }}
    .t-item {{ display: flex; gap: 8px; align-items: flex-start; padding: 7px 12px; cursor: pointer; border-left: 3px solid transparent; transition: background 0.1s; }}
    .t-item:hover {{ background: var(--timeline-hover); }}
    .t-item.current {{ background: var(--timeline-selected); border-left-color: var(--timeline-selected-border); }}
    .t-item.hidden {{ display: none; }}
    .t-num {{ font-size: 10px; color: var(--muted); min-width: 20px; font-variant-numeric: tabular-nums; padding-top: 2px; }}
    .t-badge {{ padding: 1px 7px; border-radius: 20px; font-size: 10px; font-weight: 600; white-space: nowrap; flex-shrink: 0; }}
    .t-text {{ font-size: 11px; color: var(--text2); line-height: 1.5; }}
    .t-item.current .t-text {{ color: var(--timeline-selected-fg); font-weight: 500; }}
    .badge-arrive  {{ background: var(--badge-arrive-bg);  color: var(--badge-arrive-fg); }}
    .badge-move    {{ background: var(--badge-move-bg);    color: var(--badge-move-fg); }}
    .badge-park    {{ background: var(--badge-park-bg);    color: var(--badge-park-fg); }}
    .badge-depart  {{ background: var(--badge-depart-bg);  color: var(--badge-depart-fg); }}
    .badge-service {{ background: var(--badge-service-bg); color: var(--badge-service-fg); }}
    .badge-wait    {{ background: var(--badge-wait-bg);    color: var(--badge-wait-fg); }}
    .badge-initial {{ background: var(--badge-initial-bg); color: var(--badge-initial-fg); }}
    .badge-combine {{ background: var(--badge-combine-bg); color: var(--badge-combine-fg); }}
    .badge-split   {{ background: var(--badge-combine-bg); color: var(--badge-combine-fg); }}
    .action-arrive  {{ background: var(--badge-arrive-bg);  color: var(--badge-arrive-fg); }}
    .action-move    {{ background: var(--badge-move-bg);    color: var(--badge-move-fg); }}
    .action-park    {{ background: var(--badge-park-bg);    color: var(--badge-park-fg); }}
    .action-depart  {{ background: var(--badge-depart-bg);  color: var(--badge-depart-fg); }}
    .action-service {{ background: var(--badge-service-bg); color: var(--badge-service-fg); }}
    .action-wait    {{ background: var(--badge-wait-bg);    color: var(--badge-wait-fg); }}
    .action-initial {{ background: var(--badge-initial-bg); color: var(--badge-initial-fg); }}
    .action-combine {{ background: var(--badge-combine-bg); color: var(--badge-combine-fg); }}
    .action-split   {{ background: var(--badge-combine-bg); color: var(--badge-combine-fg); }}
    .legend {{ padding: 10px 14px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 5px; flex-shrink: 0; }}
    .leg {{ display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }}
    .leg-dot {{ width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }}
    #node-tooltip {{ position: fixed; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 12px; pointer-events: none; z-index: 1000; display: none; box-shadow: 0 2px 8px rgba(0,0,0,0.3); white-space: nowrap; }}
    #node-tooltip .tt-name {{ font-weight: 600; }}
    #node-tooltip .tt-type {{ color: var(--muted); font-size: 11px; margin-left: 4px; }}
    #node-tooltip .tt-parking {{ font-size: 10px; color: var(--muted); margin-left: 4px; }}
  </style>
</head>
<body>

<header>
  <h1>Shunting Plan</h1>
  <span class="loc">{location_name}</span>
  <div class="controls">
    <button onclick="prev()">&#8592; Prev</button>
    <button class="play" id="playBtn" onclick="togglePlay()">&#9654; Play</button>
    <button onclick="next()">Next &#8594;</button>
    <input type="range" id="slider" min="0" value="0" oninput="render(+this.value)">
    <span class="ctr" id="ctr">0 / 0</span>
    <button id="theme-btn" onclick="toggleTheme()">Dark</button>
  </div>
</header>

<div id="summary">
  <div class="stat"><div class="stat-val" id="s-trains">-</div><div class="stat-label">Trains</div></div>
  <div class="stat"><div class="stat-val" id="s-steps">-</div><div class="stat-label">Plan steps</div></div>
  <div class="stat"><div class="stat-val" id="s-departed">-</div><div class="stat-label">Departed</div></div>
  <div class="stat"><div class="stat-val" id="s-parked">-</div><div class="stat-label">Parked</div></div>
</div>

<div id="action-bar">
  <span id="action-badge" class="action-badge action-initial">start</span>
  <span id="action-desc">Initial state</span>
</div>

<!-- YARD MAP PANEL -->
<div id="yard-panel">
  <div id="yard-label">Yard map</div>
  <div id="yard-svg-wrap">
    <svg id="yard-svg" height="120" viewBox="0 0 1000 120" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="greenTint" color-interpolation-filters="sRGB">
          <feFlood flood-color="#059669" flood-opacity="0.5" result="flood"/>
          <feComposite in="flood" in2="SourceGraphic" operator="in" result="mask"/>
          <feBlend in="SourceGraphic" in2="mask" mode="multiply"/>
        </filter>
        <filter id="greenTintPulse" color-interpolation-filters="sRGB">
          <feFlood id="greenTintPulseFlood" flood-color="#059669" flood-opacity="0.5" result="flood"/>
          <feComposite in="flood" in2="SourceGraphic" operator="in" result="mask"/>
          <feBlend in="SourceGraphic" in2="mask" mode="multiply"/>
        </filter>
      </defs>
      <g id="edges-layer"></g>
      <g id="nodes-layer"></g>
      <g id="train-layer"></g>
      <g id="particles-layer"></g>
    </svg>
  </div>
  <div id="yard-legend"></div>
  <div id="node-tooltip"><span class="tt-name"></span><span class="tt-type"></span><span class="tt-parking"></span></div>
</div>

<div id="panel-toggle" onclick="toggleBottom()"><span id="toggle-arrow">▲</span></div>

<main id="bottom-panel" style="display:none">
  <div id="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="min-width:140px">Train</th>
          <th style="min-width:85px">Status</th>
          <th style="min-width:90px">Track</th>
          <th style="min-width:90px">Previous track</th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
  <aside>
    <div class="aside-head">
      <span>Plan steps</span>
      <span id="filter-label" onclick="clearFilter()"></span>
    </div>
    <div id="timeline"></div>
    <div class="legend">
      <div class="leg"><div class="leg-dot" style="background:var(--badge-arrive-bg);border:1px solid var(--badge-arrive-fg)"></div>Arrive</div>
      <div class="leg"><div class="leg-dot" style="background:var(--badge-move-bg);border:1px solid var(--badge-move-fg)"></div>Move</div>
      <div class="leg"><div class="leg-dot" style="background:var(--badge-park-bg);border:1px solid var(--badge-park-fg)"></div>Park</div>
      <div class="leg"><div class="leg-dot" style="background:var(--badge-service-bg);border:1px solid var(--badge-service-fg)"></div>Service</div>
      <div class="leg"><div class="leg-dot" style="background:var(--badge-depart-bg);border:1px solid var(--badge-depart-fg)"></div>Depart</div>
      <div class="leg"><div class="leg-dot" style="background:var(--badge-combine-bg);border:1px solid var(--badge-combine-fg)"></div>Combine / Split</div>
    </div>
  </aside>
</main>

<script>const data = {data_json};</script>
<script src="functions.js"></script>
</body>
</html>
"""
    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write(document)
    # Copy functions.js alongside the output HTML so the <script src="functions.js"> works
    import shutil, os
    js_src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "functions.js")
    js_dst = os.path.join(os.path.dirname(os.path.abspath(output_path)), "functions.js")
    if os.path.abspath(js_src) != os.path.abspath(js_dst):
        shutil.copy2(js_src, js_dst)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--location", required=True)
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--layout", default=None)
    parser.add_argument("--image", default=None)
    args = parser.parse_args()

    location = load_json(args.location)
    scenario = load_json(args.scenario)
    id_to_track, name_to_track = build_track_maps(location)
    edges = build_edges(location, id_to_track)
    initial = initial_train_positions(scenario, id_to_track)
    steps = parse_plan(args.plan, id_to_track)
    states = simulate_steps(initial, steps, id_to_track, location)
    train_lengths = collect_train_lengths(scenario, args.plan, states)

    layout = load_layout(args.layout)
    raw_positions = layout.get("tracks", {})
    positions = {}
    for key, pos in raw_positions.items():
        name = pos.get("name")
        if key in id_to_track:
            tid = key
            if not name:
                name = track_name(tid, id_to_track)
        elif key in name_to_track:
            tid = str(name_to_track[key]["id"])
            name = key
        else:
            tid = key
            name = name or key
        positions[tid] = {"x": pos["x"], "y": pos["y"], "size": pos.get("size"), "name": name, "shape": pos.get("shape"), "parking": pos.get("parking")}
    layout["tracks"] = positions

    image_data_uri = None
    image_width = None
    image_height = None
    image_path = args.image or layout.get("image")
    if image_path:
        layout_dir = Path(args.layout).resolve().parent if args.layout else Path.cwd()
        abs_image_path = layout_dir / image_path
        image_data_uri = encode_image_base64(abs_image_path)
        image_width = layout.get("width")
        image_height = layout.get("height")

    track_meta = {str(t["id"]): {"name": str(t["name"]), "parkingAllowed": t.get("parkingAllowed", False), "type": t.get("type", ""), "length": t.get("length", 0)} for t in location.get("trackParts", [])}
    unit_images = load_unit_images()
    particle_images = load_particle_images()
    train_units = collect_train_units(scenario, states)
    render_html(Path(args.location).parent.name, states, edges, layout, args.output,
                image_data_uri=image_data_uri, image_width=image_width, image_height=image_height,
                track_meta=track_meta, train_lengths=train_lengths,
                unit_images=unit_images, train_units=train_units, particle_images=particle_images)
    print(f"Wrote visualizer to {args.output}")
    print(f"Steps: {len(steps)}; trains: {len(initial)}; yard nodes: {len(positions)}")
    print(f"Sprites loaded: {len(unit_images)} unit types; {len(train_units)} trains mapped")


if __name__ == "__main__":
    main()
