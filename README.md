# Ring Road Loop

A chill, endless drive around Yogyakarta's Ring Road (Jalan Lingkar) in a 2026 Red Bull RB22, built with three.js. No start, no finish, no crashing.

## Run

Any static file server works. From this folder:

```bash
python3 -m http.server 5180
```

Then open http://localhost:5180. Click or press any key to start the engine; browsers need a user gesture before they play audio.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake; hold at a standstill to reverse |
| A D / ← → | Steer |
| C | Toggle chase cam / cockpit cam (above the driver's head) |
| M | Mute |

The central median has openings where the real road has them: dedicated U-turn spots (*putar balik*) and junction crossovers, taken from OpenStreetMap. Slow down, move to the outer lane and steer right to U-turn onto the other carriageway; the U-TURN pill in the speed dial lights when an opening is beside you. Each direction has its own signs and traffic lights. There are no openings on flyovers or in the underpass.

## How it's put together

- `assets/track.json` holds the real Ring Road geometry from OpenStreetMap: the trunk ways of Jl. Padjajaran, Majapahit, Ahmad Yani, Wirjono Projodikoro, Brawijaya and Siliwangi, merged into one ~39 km clockwise loop and smoothed. Crossing roads and junction names come from the same data. `tools/build_track.py` regenerates it from Overpass exports; the queries are in the file header.
- `src/track.js` builds the dual carriageway (median, separators, slow lanes, sidewalks, lane markings) and the scenery: ruko shophouses, kampung houses, shade trees, double-arm median lamps, green direction gantries, traffic lights, and Merapi and Merbabu on the northern horizon. All textures are generated on canvases.
- Grade separations also come from OSM bridge and tunnel tags on the Ring Road ways: the Kentungan underpass under Jl. Kaliurang, the Janti flyover, the rail overpass on Jl. Siliwangi, and the Jombor flyover. Main carriageways ride an elevation profile with eased ramps. Flyovers get piers, parapets and an at-grade junction below; the underpass gets retaining walls, edge barriers and a bridge slab for the crossing street. Railway lines from OSM run under both rail crossings. Slopes affect acceleration, and the trench adds an echo to the engine.
- `assets/buildings.json` holds about 50,000 real building footprints from OSM within roughly 330 m of the road, extruded with heights from `height` / `building:levels` tags (or estimated from type and size), with hipped tile roofs on houses and flat roofs on larger buildings. Procedural shophouses only fill stretches where OSM has no buildings. `tools/build_buildings.py` regenerates it.
- Traffic lights stand where OSM has `traffic_signals` nodes: green for Ring Road traffic, red for the crossing streets.
- `src/car.js` loads the glTF, re-orients it, and splits the merged wheel meshes into four spinning wheels plus steering fronts. The physics runs in track coordinates (distance along the road, lateral offset, heading). Kerbs act as soft walls, so you slide along them instead of crashing. The 8-speed gearbox shifts automatically.
- `src/audio.js` synthesises a V6 hybrid with Web Audio: rpm-pitched oscillators, combustion pulse modulation, a load-dependent filter and distortion, MGU-K whine, wind and road noise, shift clicks, and overrun crackle.
- `src/hud.js` draws the bottom HUD: a heading-up minimap with a whole-loop inset, speed, gear, rev lights and the current street.

## Credits

- Car: ["2026 Redbull RB22"](https://sketchfab.com/3d-models/2026-redbull-rb22-0a3d24a58e0549d591a5a48c22eec383) by [Dave Love SketchFab](https://sketchfab.com/Tyler_Dave), CC-BY-4.0.
- Road data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL.
