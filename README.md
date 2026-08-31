# robust-rail-visualizer

A standalone web-based visualizer for TUSPwSS (Train Unit Scheduling Problem with Stabling Sections) plans and scenarios. Renders JSON-formatted plans into interactive HTML pages with animated train movements on a rail yard diagram.

## Overview

The visualizer takes three JSON inputs — a **location** (track infrastructure), a **scenario** (initial train positions), and a **plan** (sequence of actions) — and produces a standalone HTML file that shows:

- An SVG yard diagram with tracks laid out according to a layout file
- A step-by-step timeline scrubber
- Animated train sprites that move between tracks
- A summary table showing train unit types and their journey through the plan

## Components

| File | Description |
| --- | --- |
| `run_visualizer.py` | Local web server with a GUI for picking a location/scenario/plan and generating the visualizer HTML |
| `visualize_plan.py` | CLI tool that renders a scenario + plan into a standalone HTML file |
| `layout_editor.py` | Browser-based editor for creating/editing track layout files (`layouts/*.json`) |
| `run_tests.py` | Headless test runner: generates every test pair and runs the animation harnesses in Node |
| `layouts/` | Track-position JSON files per location, defining x/y coordinates and shapes for the yard diagram |
| `test_scenarios/` | Hand-crafted test scenarios plus a copy of `location.json`, so they run hermetically |
| `test_plans/` | Hand-crafted plans matching the test scenarios one-to-one |
| `tests/js/` | Node harnesses that execute the real `functions.js` headlessly and verify animation invariants |
| `Images/` | Train unit sprite images (ICR, SLT, SNG, VIRM) and background images |

## Requirements

- Python 3.10+ (standard library only, no pip dependencies)
- Node.js (only needed for `run_tests.py`)

## Usage

### Web UI (recommended)

Start the visualizer server, then open the browser to pick a location, scenario, and plan:

```
python run_visualizer.py
```

Options:

| Flag | Default | Description |
| --- | --- | --- |
| `--port` | `8767` | Port to serve on |
| `--inputs-root` | `../robust-rail-general` | Directory containing `Location_*` folders |
| `--output-dir` | `./data` | Where to write generated HTML files |
| `--host` | `127.0.0.1` | Bind address (use `0.0.0.0` for container/network access) |

```
python run_visualizer.py --port 8767 --inputs-root ../robust-rail-general
```

Open http://127.0.0.1:8767, select a location/scenario/plan from the dropdowns, and click **Generate & View**.

The picker lists each location's `scenarios/` and `plans/` directories, plus the classified corpus under `fixtures/{feasible,infeasible,unresolved}/`, shown as relative paths so you can tell which bucket an entry came from.

A virtual **TestScenarios** location appears whenever `test_scenarios/` exists; it lists the hand-crafted pairs below (scenarios from `test_scenarios/`, plans from `test_plans/`) so they can be viewed like any corpus input.

### Test scenarios

`test_scenarios/` + `test_plans/` contain four small scenario/plan pairs that exercise the visualizer end-to-end with known-good inputs:

| Pair | Covers |
| --- | --- |
| `all_parked` | Every parking-allowed track occupied at t=0, including two-member consists and a unit on the 906a arrival stub |
| `services` | Arrive → move → cleaning/wash/monteur service steps → depart, two trains interleaved |
| `combine_split` | Two arrivals combined on track 52, moved as a consist, split again, both departed |
| `full_journey` | Kitchen sink: services, combine, a move to 104a, split, parking on 60/61 and three departs |

They follow real planner conventions (combine = one half-action per member sharing a child SU id; the combined SU carries `parentIDs` in later actions). Open them via the **TestScenarios** location in the web UI, or generate directly:

```
python visualize_plan.py --location test_scenarios/location.json \
  --scenario test_scenarios/scenario_test_services.json \
  --plan test_plans/plan_test_services.json \
  --layout layouts/kleine_binckhorst.json --output output.html
```

### Running the tests

```
python run_tests.py
```

For every pair (the four above plus two reference pairs from the sibling `robust-rail-general` checkout) it generates the HTML, extracts the embedded data object, and runs the Node harnesses against it:

| Stage | What it verifies |
| --- | --- |
| `generate` | `visualize_plan.py` produces an HTML file without errors |
| `extract` | The embedded `const data = {...}` object parses (tests/js/extract.js) |
| `harness.js` | For each move state, the first animation frame renders every sprite pixel-identically to the parked rendering: visible (post-clip) centre, angle, width and clip fraction must all match |
| `midanim.js` | Mid-animation: sprites ride the exact eased arc, rotation follows local tangents with no mirror jumps, width/clip stay frozen, pivots stay on the rails |

Useful flags:

```
python run_tests.py --list              # show all pairs
python run_tests.py --only services ref # subset by name substring
python run_tests.py --keep-temp         # keep generated artifacts for debugging
```

### CLI (standalone HTML generation)

Generate a standalone HTML visualizer directly without the server:

```
python visualize_plan.py \
  --location ../robust-rail-general/Location_KleineBinckhorst/location.json \
  --scenario ../robust-rail-general/Location_KleineBinckhorst/scenarios/scenario_example.json \
  --plan ../robust-rail-general/Location_KleineBinckhorst/plans/plan_example.json \
  --layout layouts/kleine_binckhorst.json \
  --output output.html
```

Options:

| Flag | Required | Description |
| --- | --- | --- |
| `--location` | Yes | Path to `location.json` |
| `--scenario` | Yes | Path to `scenario_*.json` |
| `--plan` | Yes | Path to `plan_*.json` |
| `--output` | Yes | Output HTML file path |
| `--layout` | No | Track layout JSON (auto-detected if omitted) |
| `--image` | No | Custom background image for the yard diagram |

### Layout editor

Create or edit the track layout files that control how tracks appear on the yard diagram:

```
python layout_editor.py --location-name Location_KleineBinckhorst --port 8766
```

Open http://127.0.0.1:8766 in a browser. Click tracks on the diagram to position them, or use the JSON editor to set coordinates directly. For rail tracks you can draw a `shape` polyline along the track and mark the parkable stretch: enable **Set parking** and click twice on the rail (start, then end), then drag the orange handles to fine-tune. Layouts are saved to the `layouts/` directory.

Options:

| Flag | Default | Description |
| --- | --- | --- |
| `--location-name` | `Location_KleineBinckhorst` | Name of the location to edit |
| `--layout` | auto-detected | Specific layout JSON file to edit |
| `--port` | `8766` | Port to serve on |

## Layout files

Layout files (`layouts/*.json`) define the visual positions of tracks on the yard canvas. Each track entry maps a track ID to:

- `x`, `y` — center point coordinates
- `shape` — array of `[x, y]` points defining the track polyline (for rendering)
- `parking` — optional `[startFrac, endFrac]` limiting where trains may park on that track, as fractions of the polyline length measured from the shape's start (the A-side end). When absent, the whole polyline is parkable. Set it from the layout editor with **Set parking** (green highlight shows the parkable stretch).

Tracks without entries in the layout file are still functional but will not be drawn on the yard diagram.

Reference images (`layouts/*.png`) can be used as a background guide when positioning tracks in the layout editor.

## Input formats

### location.json

The location file defines the rail infrastructure: tracks, switches, connectors, and their connectivity. Key structures:

- `trackParts` — array of track segments with `id`, `name`, `type` (track/switch/connector), and `aSide`/`bSide` connectivity lists
- `trackUnitLengths` — map of track ID to physical length in meters

### scenario_*.json

Defines the initial state: which trains are on which tracks, and their unit types (with lengths).

- `trainUnits` — array of train units with `id`, `type`, and `trainUnitType`
- `trainUnitTypes` — map of type name to properties including `length`

### plan_*.json

A sequence of actions produced by the planner. Each action has a `path` (sequence of track part IDs), `resources` (tracks affected), and a `cost`.

## Docker

The visualizer can also be run via Docker (built from the sibling `planning-approach` repository):

```
cd ../robust-rail-general
docker run --rm -p 8767:8767 \
  --user $(id -u):$(id -g) \
  --mount type=bind,source=$PWD,target=/app/database \
  planner:latest visualizer \
  --inputs-root /app/database --output-dir /app/database/tmp_plans
```

## Image credits

The following images in `Images/` are sourced from [Vecteezy](https://www.vecteezy.com) under the [Vecteezy Free License](https://www.vecteezy.com/license-agreement):

| File | Source | Artist |
| --- | --- | --- |
| `gears.jpg` | [Gears Vector Icon](https://nl.vecteezy.com/vector-kunst/552199-versnellingen-vector-icon) | Brian Goff |
| `waterdrop.jpg` | [Water Drop](https://www.vecteezy.com/vector-art/2297984-water-drop-international-water-power-plant-life-giving-moisture-cartoon-style) | Катерина Антипина |

The train images are sourced from:
- [DDZ carriage](./Images/ddz_treinstel.PNG) - Source: [Wikipedia](https://nl.wikipedia.org/wiki/Bestand:NS_DDZ_Treinstel.svg)
- [ICR carriage](./Images/icr_rijtuig_ATP.png) - Source: [Modeltreinexpress](https://www.modeltreinexpress.nl/webshop2/article/3430993/Artitec%2020.158.21)
- [SLT carriage](./Images/slt_treinstel.png) - Source: [Trainsonmap](https://trainsonmap.com/about)
- [SNG carriage](./Images/sng_rijtuig_ATP.png) - Source: [Trainsonmap](https://trainsonmap.com/about)
- [VIRM carriage](./Images/virm_treinstel.png) - Source: [Wikipedia](https://nl.wikipedia.org/wiki/Bestand:NS_VIRM_Treinstel.svg)

The images in `Layouts/` are:
- [Kleine Binckhorst](./Layouts/kleine_binckhorst.png) in the Netherlands - Source: [Sporenplan](https://www.sporenplan.nl/)
- [Small location](./Layouts/location.png) - custom-made small location for testing
