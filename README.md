# Ring Road Loop

A chill, endless drive around Yogyakarta's Ring Road (Jalan Lingkar) in a 2026 Red Bull RB22, built with three.js. No start, no finish, no crashing.

## Run

Any static file server works. From this folder:

```bash
python3 tools/serve.py 5180
```

`tools/serve.py` is a plain static server that disables browser caching, so edits always show up on reload.

Then open http://localhost:5180. Click or press any key to start the engine; browsers need a user gesture before they play audio.

Desktop only: phones and tablets see a "please use desktop" message and the game isn't loaded for them.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake; hold at a standstill to reverse |
| A D / ← → | Steer |
| C | Toggle chase cam / cockpit cam (above the driver's head) |
| N | Toggle night mode (remembered between visits) |
| M | Mute |

The central median has openings where the real road has them: dedicated U-turn spots (*putar balik*) and junction crossovers, taken from OpenStreetMap. Slow down, move to the outer lane and steer right to U-turn onto the other carriageway; the U-TURN pill in the speed dial lights when an opening is beside you. Each direction has its own signs and traffic lights. There are no openings on flyovers or in the underpass.

## How it's put together

- `assets/track.json` holds the real Ring Road geometry from OpenStreetMap: the trunk ways of Jl. Padjajaran, Majapahit, Ahmad Yani, Wirjono Projodikoro, Brawijaya and Siliwangi, merged into one ~39 km clockwise loop and smoothed. Crossing roads and junction names come from the same data. `tools/build_track.py` regenerates it from Overpass exports; the queries are in the file header.
- `src/track.js` builds the dual carriageway (median, separators, slow lanes, sidewalks, lane markings) and the scenery: clay buildings, shade trees, double-arm median lamps, green direction gantries, traffic lights, and Merapi and Merbabu on the northern horizon. Road, ground and sign textures are generated on canvases.
- Grade separations also come from OSM bridge and tunnel tags on the Ring Road ways: the Kentungan underpass under Jl. Kaliurang, the Janti flyover, the rail overpass on Jl. Siliwangi, and the Jombor flyover. Main carriageways ride an elevation profile with eased ramps. Flyovers get piers, parapets and an at-grade junction below; the underpass gets retaining walls, edge barriers and a bridge slab for the crossing street. Railway lines from OSM run under both rail crossings. Slopes affect acceleration, and the trench adds an echo to the engine.
- `assets/buildings.json` holds about 50,000 real building footprints from OSM within roughly 330 m of the road, extruded with heights from `height` / `building:levels` tags (or estimated from type and size), with hipped roofs on houses and flat roofs on larger buildings. All buildings share one untextured matte "clay" material and each area is a single merged mesh, which keeps draw calls low and the look uniform. Procedural shophouses only fill stretches where OSM has no buildings. `tools/build_buildings.py` regenerates it.
- Traffic lights stand where OSM has `traffic_signals` nodes, grouped into junctions on a 48 s cycle: Ring Road green, amber, then red while the crossing streets go.
- `src/car.js` loads the glTF, re-orients it, and splits the merged wheel meshes into four spinning wheels plus steering fronts. The physics runs in track coordinates (distance along the road, lateral offset, heading). Kerbs and walls are soft at low impact: if your speed *into* the wall (speed × sine of your angle to it) is under 50 km/h you scrape along it with sparks. Above that it's a crash: the car bounces off and loses most of its speed, with a crunch, camera shake, sparks, debris and a red flash, and the location card counts your crashes. The end of a median opening counts as a wall too. Tune the threshold with `CRASH_KMH` in `src/car.js`. The 8-speed gearbox shifts automatically.
- `src/traffic.js` runs ambient traffic in a window around you: MPVs, hatchbacks, buses, box trucks and motorbikes in both directions, with most bikes in the slow lanes. Vehicles follow the one ahead, change lanes when stuck, brake for you, stop at red lights (the signals cycle; you can run them), and some U-turn through the median openings after waiting for a gap. Touching one faster than 25 km/h closing speed is a crash (`VEHICLE_CRASH_KMH`); slower contact just nudges or scrapes. Density is the `FLEET` table.
- Night mode swaps the sky for a dark dome with stars and a horizon glow, drops the sun to moonlight, and switches on the lights: glowing lamp heads with halos and additive pools of sodium light on the road, signs, head- and tail-lights with beam pools on all traffic, and a headlight beam and rear light on your car. The three street lamps nearest the car are real point lights, so its bodywork picks up the light as you pass under them.
- `src/audio.js` synthesises a V6 hybrid with Web Audio: rpm-pitched oscillators, combustion pulse modulation, a load-dependent filter and distortion, MGU-K whine, wind and road noise, shift clicks, and overrun crackle.
- `src/hud.js` draws the bottom HUD: a heading-up minimap with a whole-loop inset, speed, gear, rev lights and the current street.

## Credits

- Made by [@nurasyrof](https://nurasyrof.com).
- Car: ["2026 Redbull RB22"](https://sketchfab.com/3d-models/2026-redbull-rb22-0a3d24a58e0549d591a5a48c22eec383) by [Dave Love SketchFab](https://sketchfab.com/Tyler_Dave), CC-BY-4.0.
- Map data (roads, buildings, signals, railways) © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL.
