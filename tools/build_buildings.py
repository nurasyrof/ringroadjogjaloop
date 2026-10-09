# Builds assets/buildings.json from OSM building footprints along the Ring Road.
#
# Input: b*.json Overpass exports in SRC (argv[1]), one per ring street, e.g.
#   [out:json][timeout:200];
#   way["highway"="trunk"]["name"~"Padjajaran"](-7.90,110.28,-7.70,110.48)->.r;
#   way(around.r:320)["building"];
#   out tags geom;
# Needs assets/track.json (run build_track.py first) for the centreline.
#
# Output: {"b": [[kind, wallHeight_dm, roof, x0, z0, x1, z1, ...]]} with coordinates in
# decimetres (x east, z south). kind: 0 house, 1 shop/commercial, 2 industrial,
# 3 public/office/school, 4 religious. roof: 0 flat, 1 hipped/pyramidal.

import glob, json, math, os, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
HERE = os.path.dirname(os.path.abspath(__file__))
track = json.load(open(os.path.join(HERE, '..', 'assets', 'track.json')))
LAT0, LON0 = track['origin']
R = 6371000
COS = math.cos(math.radians(LAT0))


def P(g):
    return ((g['lon'] - LON0) * COS * math.pi / 180 * R, -(g['lat'] - LAT0) * math.pi / 180 * R)


pts = track['pts']
N = len(pts)
grid = {}
for i, (x, z) in enumerate(pts):
    grid.setdefault((int(x // 60), int(z // 60)), []).append(i)


def lateral(x, z):
    """Distance from the centreline (unsigned), or None if far away."""
    best = 1e18
    gx, gz = int(x // 60), int(z // 60)
    for a in range(-6, 7):
        for b in range(-6, 7):
            for i in grid.get((gx + a, gz + b), []):
                dd = (pts[i][0] - x) ** 2 + (pts[i][1] - z) ** 2
                if dd < best:
                    best = dd
    return math.sqrt(best) if best < 1e17 else None


CORRIDOR = 22.8   # ring road + sidewalks; footprints poking into it are dropped
MAXDIST = 330

KIND = {
    'house': 0, 'residential': 0, 'detached': 0, 'semidetached_house': 0, 'terrace': 0, 'apartments': 0, 'dormitory': 0, 'hut': 0,
    'retail': 1, 'commercial': 1, 'shop': 1, 'kiosk': 1, 'supermarket': 1, 'hotel': 1,
    'industrial': 2, 'warehouse': 2, 'garage': 2, 'garages': 2, 'roof': 2, 'shed': 2, 'factory': 2,
    'school': 3, 'university': 3, 'college': 3, 'office': 3, 'public': 3, 'government': 3, 'hospital': 3, 'civic': 3, 'train_station': 3, 'transportation': 3,
    'mosque': 4, 'church': 4, 'temple': 4, 'religious': 4,
}


def num(v):
    try:
        return float(str(v).split()[0].replace(',', '.'))
    except (ValueError, IndexError):
        return None


seen = set()
out = []
stats = {'total': 0, 'corridor': 0, 'far': 0, 'kept': 0}
for path in sorted(glob.glob(os.path.join(SRC, 'b[0-9]*.json'))):
    for e in json.load(open(path))['elements']:
        if e['type'] != 'way' or e['id'] in seen or 'geometry' not in e:
            continue
        seen.add(e['id'])
        stats['total'] += 1
        ring = [P(g) for g in e['geometry']]
        if len(ring) > 1 and ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) < 3:
            continue
        lats = [lateral(x, z) for x, z in ring]
        if any(d is None for d in lats):
            continue
        if min(lats) < CORRIDOR:
            stats['corridor'] += 1
            continue
        if min(lats) > MAXDIST:
            stats['far'] += 1
            continue
        # drop collinear / near-duplicate points
        simp = [ring[0]]
        for q in ring[1:]:
            if math.hypot(q[0] - simp[-1][0], q[1] - simp[-1][1]) > 0.6:
                simp.append(q)
        if len(simp) < 3:
            continue
        area = 0.5 * abs(sum(simp[i][0] * simp[(i + 1) % len(simp)][1] - simp[(i + 1) % len(simp)][0] * simp[i][1] for i in range(len(simp))))
        if area < 6:
            continue
        t = e.get('tags', {})
        btype = t.get('building', 'yes')
        kind = KIND.get(btype, 1 if t.get('shop') or t.get('amenity') in ('restaurant', 'cafe', 'fast_food', 'bank', 'fuel') else 0)
        if btype in ('yes',) and area > 900:
            kind = 1 if kind == 0 else kind
        h = num(t.get('height'))
        levels = num(t.get('building:levels'))
        if h is None:
            if levels is None:
                # typical Jogja fabric: single-storey houses, two-storey ruko, larger halls
                if kind == 0:
                    levels = 1 if area < 180 else 2
                elif kind == 2:
                    levels = 2
                else:
                    levels = 2 if area < 1500 else 3
            h = levels * 3.4 + 0.4
        h = max(3, min(h, 80))
        shape = t.get('roof:shape')
        if shape:
            roof = 0 if shape == 'flat' else 1
        else:
            roof = 1 if (kind in (0, 4) and area < 400) or (kind == 1 and area < 160) else 0
        coords = []
        for x, z in simp[:48]:
            coords += [round(x * 10), round(z * 10)]
        out.append([kind, round(h * 10), roof] + coords)
        stats['kept'] += 1

print(stats)
dst = os.path.join(HERE, '..', 'assets', 'buildings.json')
json.dump({'b': out}, open(dst, 'w'), separators=(',', ':'))
print('wrote', dst, os.path.getsize(dst) // 1024, 'KB')
