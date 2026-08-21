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
| `layouts/` | Track-position JSON files per location, defining x/y coordinates and shapes for the yard diagram |
| `Images/` | Train unit sprite images (ICR, SLT, SNG, VIRM) and background images |

## Requirements

- Python 3.10+ (standard library only, no pip dependencies)

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
| `--inputs-root` | `../scenario-planning-inputs` | Directory containing `Location_*` folders |
| `--output-dir` | `./data` | Where to write generated HTML files |
| `--host` | `127.0.0.1` | Bind address (use `0.0.0.0` for container/network access) |

```
python run_visualizer.py --port 8767 --inputs-root ../scenario-planning-inputs
```

Open http://127.0.0.1:8767, select a location/scenario/plan from the dropdowns, and click **Generate & View**.

The picker lists each location's `scenarios/` and `plans/` directories, plus the classified corpus under `fixtures/{feasible,infeasible,unresolved}/`, shown as relative paths so you can tell which bucket an entry came from.

### CLI (standalone HTML generation)

Generate a standalone HTML visualizer directly without the server:

```
python visualize_plan.py \
  --location ../scenario-planning-inputs/Location_KleineBinckhorst/location.json \
  --scenario ../scenario-planning-inputs/Location_KleineBinckhorst/scenarios/scenario_example.json \
  --plan ../scenario-planning-inputs/Location_KleineBinckhorst/plans/plan_example.json \
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

Open http://127.0.0.1:8766 in a browser. Click tracks on the diagram to position them, or use the JSON editor to set coordinates directly. Layouts are saved to the `layouts/` directory.

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
cd ../scenario-planning-inputs
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
