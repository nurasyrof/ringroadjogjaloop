import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './textures.js';

// Cross-section, measured from the ring road centreline. Positive d = left of travel
// direction. We drive clockwise, and Indonesia keeps left, so +d is the outer side.
export const XS = {
  median: 1.2,        // central median half-width
  mainOuter: 12.2,    // 3 lanes of 3.5 m + edge margins
  sepOuter: 13.8,     // separator between main road and slow lane
  slowOuter: 19.0,    // jalur lambat (slow lane for motorbikes)
  walkOuter: 22.5,    // sidewalk
};
export const LANES = [1.5, 5.0, 8.5, 12.0]; // lane line offsets on our carriageway

// Grade separations. Flyover decks carry both main carriageways; slow lanes stay at grade.
export const GRADE = {
  flyover: 7.4,      // deck surface height on the plateau
  underpass: -6.8,   // trench floor depth
  ramp: 150,         // ramp length (about 5% grade at the steepest point)
  pad: 80,           // extend OSM bridge/tunnel spans so the ramps sit outside them
  deck: 1.5,         // deck structural depth
  edge: 12.6,        // deck edge (parapet outer face)
};

export class Track {
  constructor(data) {
    const pts = data.pts;
    const n = pts.length;
    this.n = n;
    this.data = data;
    let L = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      L += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    this.length = L;
    this.step = L / n;
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.k = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.px[i] = pts[i][0]; this.pz[i] = pts[i][1]; }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz);
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
    // signed curvature, positive = left turn (map angle measured with north = -z)
    const ang = (i) => Math.atan2(-this.tz[i], this.tx[i]);
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let da = ang((i + 1) % n) - ang((i - 1 + n) % n);
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      raw[i] = da / (2 * this.step);
    }
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) s += raw[(i + k + n) % n];
      this.k[i] = s / 7;
    }
    // section labels per sample
    this.labelAt = new Array(n);
    const labels = data.labels;
    for (let li = 0; li < labels.length; li++) {
      const [start, name, sec] = labels[li];
      const end = li + 1 < labels.length ? labels[li + 1][0] : n;
      for (let i = start; i < end; i++) this.labelAt[i] = { name, sec };
    }
    for (let i = 0; i < labels[0][0]; i++) this.labelAt[i] = { name: labels.at(-1)[1], sec: labels.at(-1)[2] };

    // junctions with crossing streets (deduplicated, ring street names removed)
    const ringNames = new Set(labels.map((l) => l[1]));
    ringNames.add('Jl. Laksda Adisucipto');
    this.junctions = [];
    for (const [idx, name] of data.junctions) {
      if (ringNames.has(name)) continue;
      const s = idx * this.step;
      if (this.junctions.some((j) => j.name === name && this.dist(j.s, s) < 1500)) continue;
      this.junctions.push({ s, name, idx });
    }
    this.junctions.sort((a, b) => a.s - b.s);
    // all crossings (including duplicates) mark gaps in medians and kerbs
    this.gap = new Uint8Array(n);
    for (const [idx] of data.junctions) {
      for (let k = -5; k <= 5; k++) this.gap[(idx + k + n) % n] = 1;
    }

    // elevation: flyovers rise, underpasses dip; eased ramps at both ends
    this.elev = new Float32Array(n);
    this.featAt = new Int8Array(n).fill(-1);
    this.features = (data.features || []).map(([i0, i1, kind, name]) => ({
      kind, name,
      s0: i0 * this.step - GRADE.pad,
      s1: i1 * this.step + GRADE.pad,
      h: GRADE[kind],
    }));
    const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
    this.features.forEach((f, fi) => {
      const len = f.s1 - f.s0;
      for (let i = 0; i < n; i++) {
        const u = this.wrap(i * this.step - f.s0);
        if (u > len) continue;
        this.elev[i] = f.h * Math.min(ease(u / GRADE.ramp), ease((len - u) / GRADE.ramp));
        this.featAt[i] = fi;
      }
    });
    // Median openings: real U-turn links and junction crossovers from OSM when available,
    // otherwise every crossing. The median runs unbroken through grade separations.
    this.openings = (data.openings || []).map(([idx, kind]) => ({ idx, kind, s: idx * this.step }));
    if (this.openings.length) {
      this.gapMedian = new Uint8Array(n);
      for (const o of this.openings) {
        const w = o.kind === 'junction' ? 5 : 3;
        for (let k = -w; k <= w; k++) this.gapMedian[(o.idx + k + n) % n] = 1;
      }
    } else {
      this.gapMedian = this.gap.slice();
    }
    for (let i = 0; i < n; i++) if (this.featAt[i] >= 0) this.gapMedian[i] = 0;
  }

  elevAt(s) {
    const f = this.wrap(s) / this.step;
    const i = Math.floor(f) % this.n, j = (i + 1) % this.n, t = f - Math.floor(f);
    return this.elev[i] + (this.elev[j] - this.elev[i]) * t;
  }

  slopeAt(s) {
    return (this.elevAt(s + 2) - this.elevAt(s - 2)) / 4;
  }

  featureAt(s) {
    const fi = this.featAt[Math.floor(this.wrap(s) / this.step) % this.n];
    return fi >= 0 ? this.features[fi] : null;
  }

  wrap(s) {
    s %= this.length;
    return s < 0 ? s + this.length : s;
  }

  dist(a, b) {
    const d = Math.abs(a - b);
    return Math.min(d, this.length - d);
  }

  // Interpolated frame at arc length s: position, tangent, left normal, curvature.
  sample(s, out = {}) {
    s = this.wrap(s);
    const f = s / this.step;
    const i = Math.floor(f) % this.n;
    const j = (i + 1) % this.n;
    const t = f - Math.floor(f);
    out.x = this.px[i] + (this.px[j] - this.px[i]) * t;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    let tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const l = Math.hypot(tx, tz);
    tx /= l; tz /= l;
    out.tx = tx; out.tz = tz;
    out.nx = tz; out.nz = -tx; // left normal
    out.k = this.k[i] + (this.k[j] - this.k[i]) * t;
    out.i = i;
    return out;
  }

  point(s, d, out = new THREE.Vector3(), y = 0) {
    const f = this.sample(s, _f);
    return out.set(f.x + f.nx * d, y, f.z + f.nz * d);
  }
}
const _f = {};

// ---------------------------------------------------------------------------
// Geometry helpers

// Builds a strip along the track between two cross-section offsets.
// prof(i) returns [[x,y,z],[x,y,z]] for sample i; u is across, v along (metres).
function stripGeometry(track, rowFn, { vScale = 4, uScale = 4, skip = null, wantNormal = [0, 1, 0] } = {}) {
  const n = track.n;
  const pos = [], uv = [], idx = [];
  let vert = 0;
  let prevValid = false;
  for (let i = 0; i <= n; i++) {
    const ii = i % n;
    const valid = !(skip && skip(ii));
    const [a, b, ua, ub] = rowFn(ii);
    const v = (i * track.step) / vScale;
    pos.push(...a, ...b);
    uv.push(ua / uScale, v, ub / uScale, v);
    if (i > 0 && valid && prevValid) {
      const p = vert - 2;
      idx.push(p, p + 1, vert, p + 1, vert + 1, vert);
    }
    prevValid = valid;
    vert += 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // fix winding against the wanted normal direction using the first triangle
  if (idx.length) {
    const P = (k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    const A = P(idx[0]), B = P(idx[1]), C = P(idx[2]);
    const nrm = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
    const want = typeof wantNormal === 'function' ? wantNormal(idx[0] >> 1) : new THREE.Vector3(...wantNormal);
    if (nrm.dot(want) < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const val = (v, i) => (typeof v === 'function' ? v(i) : v);

function flat(track, d0, d1, y, opts = {}) {
  const f = {};
  return stripGeometry(track, (i) => {
    track.sample(i * track.step, f);
    const yy = val(y, i);
    return [
      [f.x + f.nx * d0, yy, f.z + f.nz * d0],
      [f.x + f.nx * d1, yy, f.z + f.nz * d1],
      d0, d1,
    ];
  }, opts);
}

function wall(track, d, y0, y1, facing, opts = {}) {
  const f = {};
  return stripGeometry(track, (i) => {
    track.sample(i * track.step, f);
    const a = val(y0, i), b = val(y1, i);
    return [
      [f.x + f.nx * d, a, f.z + f.nz * d],
      [f.x + f.nx * d, b, f.z + f.nz * d],
      a, b,
    ];
  }, {
    ...opts,
    wantNormal: (i) => {
      track.sample(i * track.step, f);
      return new THREE.Vector3(f.nx * facing, 0, f.nz * facing);
    },
  });
}

// Raised block (kerbed strip): top + two side faces, sitting on base height (number or fn(i)).
function raised(track, d0, d1, h, topMat, sideMat, group, skip, base = 0) {
  const top = new THREE.Mesh(flat(track, d0, d1, (i) => val(base, i) + h, { skip, uScale: 2, vScale: 2 }), topMat);
  const s0 = new THREE.Mesh(wall(track, d0, base, (i) => val(base, i) + h, d0 < d1 ? -1 : 1, { skip, vScale: 2, uScale: 1 }), sideMat);
  const s1 = new THREE.Mesh(wall(track, d1, base, (i) => val(base, i) + h, d0 < d1 ? 1 : -1, { skip, vScale: 2, uScale: 1 }), sideMat);
  for (const m of [top, s0, s1]) { m.receiveShadow = true; m.castShadow = true; group.add(m); }
}

function dashes(track, d, len, gap, width, skip, elevated = true) {
  const pos = [], idx = [];
  const f = {};
  const quad = (s0, s1) => {
    const base = pos.length / 3;
    for (const s of [s0, s1]) {
      track.sample(s, f);
      const y = elevated ? track.elevAt(s) : 0;
      pos.push(f.x + f.nx * (d - width / 2), y, f.z + f.nz * (d - width / 2));
      pos.push(f.x + f.nx * (d + width / 2), y, f.z + f.nz * (d + width / 2));
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };
  if (gap <= 0) {
    // solid line: piecewise per sample
    for (let i = 0; i < track.n; i++) {
      if (skip && skip(i)) continue;
      quad(i * track.step, (i + 1) * track.step);
    }
  } else {
    for (let s = 0; s + len < track.length; s += len + gap) {
      if (skip && skip(Math.floor(s / track.step) % track.n)) continue;
      quad(s, s + len);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // make all face up
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k], b = idx[k + 1], c = idx[k + 2];
    const ax = pos[b * 3] - pos[a * 3], az = pos[b * 3 + 2] - pos[a * 3 + 2];
    const bx = pos[c * 3] - pos[a * 3], bz = pos[c * 3 + 2] - pos[a * 3 + 2];
    if (az * bx - ax * bz < 0) { idx[k + 1] = c; idx[k + 2] = b; }
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Instances bucketed into spatial cells so off-screen / far chunks can be culled.
class Scatter {
  constructor(geometry, material, { cell = 900, shadow = true, receive = true } = {}) {
    this.geometry = geometry;
    this.material = material;
    this.cell = cell;
    this.shadow = shadow;
    this.receive = receive;
    this.buckets = new Map();
  }
  add(x, y, z, yaw, sx, sy, sz, color) {
    const key = Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell);
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = []));
    b.push([x, y, z, yaw, sx, sy, sz, color]);
  }
  build(group, chunks) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const [key, list] of this.buckets) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, list.length);
      let cx = 0, cz = 0;
      list.forEach((it, i) => {
        q.setFromAxisAngle(up, it[3]);
        m.compose(p.set(it[0], it[1], it[2]), q, s.set(it[4], it[5], it[6]));
        mesh.setMatrixAt(i, m);
        if (it[7] !== undefined) mesh.setColorAt(i, col.set(it[7]));
        cx += it[0]; cz += it[2];
      });
      mesh.castShadow = this.shadow;
      mesh.receiveShadow = this.receive;
      mesh.computeBoundingSphere();
      mesh.userData.center = new THREE.Vector3(cx / list.length, 0, cz / list.length);
      group.add(mesh);
      chunks.push(mesh);
    }
  }
}

function rngFrom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box sitting on the ground (y = 0 at its base). UVs are in metres per face, unused by clay.
function buildingBox(w, h, d, texW, texH) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const k = f * 4 + v;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / texW, (uv.getY(k) * dims[f][1]) / texH);
    }
  }
  return g;
}

// Tree = tapered trunk + a crown of leaf cards. Card normals point away from the
// crown centre so the canopy shades like a soft volume instead of flat quads.
function treeGeometry(seed) {
  const r = rngFrom(seed);
  const trunk = new THREE.CylinderGeometry(0.14, 0.28, 4.2, 7, 1);
  trunk.translate(0, 2.1, 0);
  const cards = [];
  const cy = 5.2, rx = 2.7, ry = 1.7;
  const center = new THREE.Vector3(0, cy, 0);
  for (let i = 0; i < 46; i++) {
    const size = 1.5 + r() * 1.3;
    const q = new THREE.PlaneGeometry(size, size);
    q.rotateX(r() * Math.PI);
    q.rotateY(r() * Math.PI);
    q.rotateZ(r() * Math.PI);
    // position on/inside a squashed ellipsoid, biased outward
    const u = r() * Math.PI * 2, v = Math.acos(2 * r() - 1), rad = 0.55 + 0.45 * Math.sqrt(r());
    q.translate(Math.cos(u) * Math.sin(v) * rx * rad, cy + Math.cos(v) * ry * rad, Math.sin(u) * Math.sin(v) * rx * rad);
    const p = q.attributes.position, n = q.attributes.normal;
    const tmp = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) {
      tmp.fromBufferAttribute(p, k).sub(center);
      tmp.y *= 1.6;
      tmp.normalize();
      n.setXYZ(k, tmp.x, tmp.y, tmp.z);
    }
    cards.push(q);
  }
  const crown = mergeGeometries(cards);
  return { trunk, crown };
}

function lampGeometry() {
  const pole = new THREE.CylinderGeometry(0.09, 0.14, 10, 8);
  pole.translate(0, 5, 0);
  const parts = [pole];
  for (const side of [-1, 1]) {
    const arm = new THREE.BoxGeometry(3.2, 0.08, 0.08);
    arm.translate(side * 1.6, 9.8, 0);
    const head = new THREE.BoxGeometry(0.9, 0.16, 0.36);
    head.translate(side * 3.1, 9.72, 0);
    parts.push(arm, head);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

// ---------------------------------------------------------------------------

// Extrudes OSM footprints into one clay mesh per chunk: walls plus a flat or hipped roof.
// No textures or per-building colours, so each chunk is a single cheap draw call.
function buildRealBuildings(list, mat, group, chunks, occ, OC, density) {
  const CELL = 1200;
  const buckets = new Map();
  const bucket = (x, z) => {
    const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { p: [], cx: 0, cz: 0, n: 0 }));
    return b;
  };

  for (const b of list) {
    const h = b[1] / 10, roofType = b[2];
    const pts = [];
    for (let k = 3; k < b.length; k += 2) pts.push([b[k] / 10, b[k + 1] / 10]);
    const n = pts.length;
    // orient so the shoelace area in (x, z) is positive: outward normal of edge d is (dz, -dx)
    let A = 0;
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; A += p[0] * q[1] - q[0] * p[1]; }
    if (A < 0) pts.reverse();
    let cx = 0, cz = 0, minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    for (const [x, z] of pts) {
      cx += x; cz += z;
      minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z);
    }
    cx /= n; cz /= n;
    const bk = bucket(cx, cz);
    bk.cx += cx; bk.cz += cz; bk.n++;
    const P = bk.p;

    // occupancy for procedural scenery
    for (let a = Math.floor(minx / OC); a <= Math.floor(maxx / OC); a++)
      for (let c = Math.floor(minz / OC); c <= Math.floor(maxz / OC); c++) occ.add(a + ',' + c);
    const dk = Math.floor(cx / 100) + ',' + Math.floor(cz / 100);
    density.set(dk, (density.get(dk) || 0) + 1);

    // walls: (a0, a1, b1) and (a0, b1, b0) wind outward
    const y0 = -0.05;
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
      P.push(ax, y0, az, ax, h, az, bx, h, bz, ax, y0, az, bx, h, bz, bx, y0, bz);
    }

    if (roofType === 1) {
      // hipped roof approximated as a pyramid over the footprint, with a small eave overhang
      const rh = Math.min(3.4, 0.6 + 0.2 * Math.sqrt(Math.abs(A) / 2));
      const e = (p) => [cx + (p[0] - cx) * 1.06, cz + (p[1] - cz) * 1.06];
      for (let i = 0; i < n; i++) {
        const p = e(pts[i]), q = e(pts[(i + 1) % n]);
        P.push(p[0], h, p[1], cx, h + rh, cz, q[0], h, q[1]); // faces up and out
      }
    } else {
      const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [i0, i1, i2] of tris) {
        const a = pts[i0], b2 = pts[i1], c = pts[i2];
        const up = (b2[0] - a[0]) * (c[1] - a[1]) - (b2[1] - a[1]) * (c[0] - a[0]) < 0; // keep the normal pointing up
        for (const [x, z] of up ? [a, b2, c] : [a, c, b2]) P.push(x, h, z);
      }
    }
  }

  for (const bk of buckets.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bk.p, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat.clay);
    m.castShadow = m.receiveShadow = true;
    m.userData.center = new THREE.Vector3(bk.cx / bk.n, 0, bk.cz / bk.n);
    group.add(m);
    chunks.push(m);
  }
}

export function buildWorld(track, renderer, scene, buildings = null) {
  const group = new THREE.Group();
  const chunks = [];
  scene.add(group);

  const tex = {
    asphalt: T.asphalt(renderer),
    rough: T.asphaltRough(renderer),
    grass: T.grass(renderer),
    paving: T.paving(renderer),
    concrete: T.concrete(renderer),
    curb: T.curbStripes(renderer),
    macro: T.groundMacro(renderer),
  };

  const mat = {
    asphalt: new THREE.MeshStandardMaterial({ map: tex.asphalt, roughnessMap: tex.rough, roughness: 0.92, metalness: 0 }),
    asphaltSide: new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.95, color: 0xb0aaa0 }),
    line: new THREE.MeshStandardMaterial({ color: 0xeeece4, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    lineYellow: new THREE.MeshStandardMaterial({ color: 0xe4b43a, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    grassTop: new THREE.MeshStandardMaterial({ map: tex.grass, roughness: 1 }),
    curb: new THREE.MeshStandardMaterial({ map: tex.curb, roughness: 0.8 }),
    paving: new THREE.MeshStandardMaterial({ map: tex.paving, roughness: 0.9 }),
    concrete: new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.9 }),
    // every building is the same matte clay: no maps, no per-building colour
    clay: new THREE.MeshLambertMaterial({ color: 0xe4e1db }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 1 }),
    leaves: new THREE.MeshStandardMaterial({ map: T.leaves(renderer), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.45, metalness: 0.7 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x2c3035, roughness: 0.5, metalness: 0.6 }),
  };
  tex.asphalt.repeat.set(1, 1);
  const signMats = [];             // direction and U-turn signs brighten at night
  const lampList = [];             // median lamps: { x, y, z, nx, nz, s }

  // --- ground: one big plane with holes cut where underpass trenches drop below grade
  const GS = 26000;
  const E = (i) => track.elev[i];
  const isFly = (i) => track.featAt[i] >= 0 && track.features[track.featAt[i]].kind === 'flyover';
  const isUnder = (i) => track.featAt[i] >= 0 && track.features[track.featAt[i]].kind === 'underpass';
  const groundShape = new THREE.Shape([
    new THREE.Vector2(-GS / 2, -GS / 2), new THREE.Vector2(GS / 2, -GS / 2),
    new THREE.Vector2(GS / 2, GS / 2), new THREE.Vector2(-GS / 2, GS / 2),
  ]);
  const fr0 = {};
  for (const f of track.features) {
    if (f.kind !== 'underpass') continue;
    const left = [], right = [];
    for (let ss = f.s0; ss <= f.s1; ss += track.step) {
      track.sample(ss, fr0);
      // shape space is (x, -z) because the plane is rotated onto XZ afterwards
      left.push(new THREE.Vector2(fr0.x + fr0.nx * XS.mainOuter, -(fr0.z + fr0.nz * XS.mainOuter)));
      right.push(new THREE.Vector2(fr0.x - fr0.nx * XS.mainOuter, -(fr0.z - fr0.nz * XS.mainOuter)));
    }
    groundShape.holes.push(new THREE.Path([...left, ...right.reverse()]));
  }
  const ground = new THREE.ShapeGeometry(groundShape);
  ground.rotateX(-Math.PI / 2);
  {
    const gp = ground.attributes.position;
    const uv = new Float32Array(gp.count * 2), uv1 = new Float32Array(gp.count * 2);
    for (let k = 0; k < gp.count; k++) {
      // detail uv: 1 tile per 24 m; uv1: whole plane for the macro tint
      uv[k * 2] = gp.getX(k) / 24; uv[k * 2 + 1] = -gp.getZ(k) / 24;
      uv1[k * 2] = gp.getX(k) / GS + 0.5; uv1[k * 2 + 1] = -gp.getZ(k) / GS + 0.5;
    }
    ground.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    ground.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  }
  tex.macro.channel = 1;
  tex.macro.repeat.set(6, 6);
  const groundMat = new THREE.MeshStandardMaterial({ map: tex.grass, roughness: 1 });
  // multiply in the macro tint texture (sampled with uv1)
  groundMat.onBeforeCompile = (sh) => {
    sh.uniforms.macroMap = { value: tex.macro };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uv1;\nvarying vec2 vMacroUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMacroUv = uv1 * 6.0;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D macroMap;\nvarying vec2 vMacroUv;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= texture2D(macroMap, vMacroUv).rgb * 1.15;');
  };
  const groundMesh = new THREE.Mesh(ground, groundMat);
  groundMesh.position.y = -0.06;
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  // --- ring road surfaces
  const gap = (i) => track.gap[i] === 1;
  const gapMed = (i) => track.gapMedian[i] === 1;
  const W = XS.walkOuter;
  const addMesh = (geo, m, cast = false) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.receiveShadow = true;
    mesh.castShadow = cast;
    group.add(mesh);
    return mesh;
  };
  // main carriageways follow the elevation profile; slow lanes stay at grade
  addMesh(flat(track, -XS.mainOuter, XS.mainOuter, E, { uScale: 5, vScale: 5 }), mat.asphalt);
  // at-grade junction surface underneath flyovers
  addMesh(flat(track, -XS.mainOuter, XS.mainOuter, 0, { uScale: 5, vScale: 5, skip: (i) => !isFly(i) || E(i) < 2 }), mat.asphalt);

  for (const side of [1, -1]) {
    addMesh(flat(track, side * XS.mainOuter, side * XS.slowOuter, 0, { uScale: 5, vScale: 5 }), mat.asphalt);
    // central median (one half per side so the kerb faces work out)
    raised(track, 0, side * XS.median, 0.2, mat.grassTop, mat.curb, group, gapMed, E);
    // separator between main carriageway and slow lane
    raised(track, side * XS.mainOuter, side * XS.sepOuter, 0.2, mat.grassTop, mat.curb, group, (i) => gap(i) || (isFly(i) && E(i) > 0.3));
    // sidewalk
    raised(track, side * XS.slowOuter, side * W, 0.16, mat.paving, mat.concrete, group, null);

    // lane markings (main lanes ride the elevation; edge of slow lane stays at grade)
    const lines = new THREE.Group();
    lines.add(new THREE.Mesh(dashes(track, side * LANES[0], 0, 0, 0.15, gapMed), mat.line));
    lines.add(new THREE.Mesh(dashes(track, side * LANES[3], 0, 0, 0.15, gapMed), mat.line));
    lines.add(new THREE.Mesh(dashes(track, side * LANES[1], 3, 5, 0.13, gapMed), mat.line));
    lines.add(new THREE.Mesh(dashes(track, side * LANES[2], 3, 5, 0.13, gapMed), mat.line));
    lines.add(new THREE.Mesh(dashes(track, side * (XS.slowOuter - 0.4), 0, 0, 0.12, null, false), mat.line));
    lines.traverse((o) => { if (o.isMesh) { o.position.y = 0.012; o.receiveShadow = true; } });
    group.add(lines);

    // flyover: parapet, deck fascia (solid embankment on the low part of the ramps), underside
    const E1 = (i) => E(i) > GRADE.deck + 3.5;
    raised(track, side * (XS.mainOuter + 0.0), side * GRADE.edge, 1.05, mat.concrete, mat.concrete, group, (i) => !isFly(i) || E(i) < 0.05, E);
    addMesh(wall(track, side * GRADE.edge, (i) => (E1(i) ? E(i) - GRADE.deck : -0.05), E, side, {
      skip: (i) => !isFly(i) || E(i) < 0.05, uScale: 3, vScale: 3,
    }), mat.concrete, true);
    // underpass: retaining wall from the trench floor up to grade, then a barrier on top
    addMesh(wall(track, side * XS.mainOuter, E, 0.2, -side, {
      skip: (i) => !isUnder(i) || E(i) > -0.05, uScale: 3, vScale: 3,
    }), mat.concrete, true);
  }
  // deck underside, only where the deck is clear of the ground
  addMesh(flat(track, -GRADE.edge, GRADE.edge, (i) => E(i) - GRADE.deck, {
    skip: (i) => !isFly(i) || E(i) <= GRADE.deck + 3.5, wantNormal: [0, -1, 0], uScale: 4, vScale: 4,
  }), mat.concrete);

  // bridge slabs carrying crossing streets over underpass trenches
  const slabs = [];
  for (const [idx] of track.data.junctions) {
    if (!isUnder(idx) || E(idx) > -4) continue;
    const s = idx * track.step;
    if (slabs.some((q) => track.dist(q, s) < 40)) continue;
    slabs.push(s);
  }
  for (const s of slabs) {
    track.sample(s, fr0);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(XS.sepOuter * 2 + 1, 1.3, 24), mat.concrete);
    slab.position.set(fr0.x, -0.04 - 0.65, fr0.z);
    slab.rotation.y = Math.atan2(fr0.tx, fr0.tz);
    slab.castShadow = slab.receiveShadow = true;
    group.add(slab);
  }
  const nearSlab = (s, r) => slabs.some((q) => track.dist(q, s) < r);
  // trench-edge barriers, open where a slab carries the crossing street
  for (const side of [1, -1]) {
    raised(track, side * XS.mainOuter, side * (XS.mainOuter + 0.35), 0.95, mat.concrete, mat.concrete, group,
      (i) => !isUnder(i) || E(i) > -0.5 || nearSlab(i * track.step, 16), 0.2);
  }

  // --- crossing city roads (flat ribbons)
  const crossPos = [], crossIdx = [];
  const roadGrid = new Map();
  const RG = 60;
  const addRoadSeg = (x1, z1, x2, z2, hw) => {
    const minx = Math.floor((Math.min(x1, x2) - hw - 20) / RG), maxx = Math.floor((Math.max(x1, x2) + hw + 20) / RG);
    const minz = Math.floor((Math.min(z1, z2) - hw - 20) / RG), maxz = Math.floor((Math.max(z1, z2) + hw + 20) / RG);
    for (let gx = minx; gx <= maxx; gx++) for (let gz = minz; gz <= maxz; gz++) {
      const k = gx + ',' + gz;
      if (!roadGrid.has(k)) roadGrid.set(k, []);
      roadGrid.get(k).push([x1, z1, x2, z2, hw]);
    }
  };
  for (const r of track.data.roads) {
    const hw = r.h === 'trunk' ? 7 : r.h === 'trunk_link' ? 3.5 : 5;
    const p = r.p;
    for (let i = 0; i < p.length - 1; i++) {
      const [x1, z1] = p[i], [x2, z2] = p[i + 1];
      const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz);
      if (l < 0.5) continue;
      const nx = -dz / l * hw, nz = dx / l * hw;
      const b = crossPos.length / 3;
      // extend slightly so consecutive segments overlap at bends
      const ex = dx / l * 1.5, ez = dz / l * 1.5;
      crossPos.push(x1 + nx - ex, 0, z1 + nz - ez, x1 - nx - ex, 0, z1 - nz - ez, x2 + nx + ex, 0, z2 + nz + ez, x2 - nx + ex, 0, z2 - nz + ez);
      crossIdx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      addRoadSeg(x1, z1, x2, z2, hw);
    }
  }
  {
    const g = new THREE.BufferGeometry();
    const uv = [];
    for (let k = 0; k < crossPos.length; k += 3) uv.push(crossPos[k] / 5, crossPos[k + 2] / 5);
    g.setAttribute('position', new THREE.Float32BufferAttribute(crossPos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    for (let k = 0; k < crossIdx.length; k += 3) {
      const a = crossIdx[k], b = crossIdx[k + 1], c = crossIdx[k + 2];
      const ax = crossPos[b * 3] - crossPos[a * 3], az = crossPos[b * 3 + 2] - crossPos[a * 3 + 2];
      const bx = crossPos[c * 3] - crossPos[a * 3], bz = crossPos[c * 3 + 2] - crossPos[a * 3 + 2];
      if (az * bx - ax * bz < 0) { crossIdx[k + 1] = c; crossIdx[k + 2] = b; }
    }
    g.setIndex(crossIdx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat.asphalt);
    m.position.y = -0.03;
    m.receiveShadow = true;
    group.add(m);
  }
  // --- railways (ballast bed with sleepers + two steel rails)
  {
    const bedTex = T.railBed(renderer);
    const bedMat = new THREE.MeshStandardMaterial({ map: bedTex, roughness: 0.95 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9da3a8, roughness: 0.35, metalness: 0.9 });
    const ribbon = (pts, a, b, y, vTile) => {
      const pos = [], uv = [], idx = [];
      let along = 0;
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
        let tx = p1[0] - p0[0], tz = p1[1] - p0[1];
        const l = Math.hypot(tx, tz) || 1;
        tx /= l; tz /= l;
        const nx = tz, nz = -tx;
        if (i > 0) along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        pos.push(pts[i][0] + nx * a, y, pts[i][1] + nz * a, pts[i][0] + nx * b, y, pts[i][1] + nz * b);
        uv.push(0, along / vTile, 1, along / vTile);
        if (i > 0) {
          const k = i * 2;
          idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      // make every triangle face up
      for (let k = 0; k < idx.length; k += 3) {
        const A = idx[k], B = idx[k + 1], C = idx[k + 2];
        const ax = pos[B * 3] - pos[A * 3], az = pos[B * 3 + 2] - pos[A * 3 + 2];
        const bx = pos[C * 3] - pos[A * 3], bz = pos[C * 3 + 2] - pos[A * 3 + 2];
        if (az * bx - ax * bz < 0) { idx[k + 1] = C; idx[k + 2] = B; }
      }
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const beds = [], rails = [];
    for (const r of track.data.rails || []) {
      if (r.length < 2) continue;
      beds.push(ribbon(r, -1.6, 1.6, -0.02, 0.65));
      for (const off of [-0.72, 0.72]) rails.push(ribbon(r, off - 0.04, off + 0.04, 0.16, 4));
      for (let i = 0; i < r.length - 1; i++) addRoadSeg(r[i][0], r[i][1], r[i + 1][0], r[i + 1][1], 3);
    }
    if (beds.length) {
      const bed = new THREE.Mesh(mergeGeometries(beds), bedMat);
      bed.receiveShadow = true;
      const rail = new THREE.Mesh(mergeGeometries(rails), steel);
      rail.receiveShadow = true;
      group.add(bed, rail);
    }
  }

  const nearRoad = (x, z, clearance) => {
    const list = roadGrid.get(Math.floor(x / RG) + ',' + Math.floor(z / RG));
    if (!list) return false;
    for (const [x1, z1, x2, z2, hw] of list) {
      const dx = x2 - x1, dz = z2 - z1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)));
      const px = x1 + dx * t - x, pz = z1 + dz * t - z;
      if (px * px + pz * pz < (hw + clearance) ** 2) return true;
    }
    return false;
  };
  // keep scenery off the ring road itself (other sections can pass close by on bends)
  const ringGrid = new Map();
  for (let i = 0; i < track.n; i += 2) {
    const k = Math.floor(track.px[i] / RG) + ',' + Math.floor(track.pz[i] / RG);
    if (!ringGrid.has(k)) ringGrid.set(k, []);
    ringGrid.get(k).push(i);
  }
  const nearRing = (x, z, r) => {
    const gx = Math.floor(x / RG), gz = Math.floor(z / RG);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = ringGrid.get(gx + a + ',' + (gz + b));
      if (!list) continue;
      for (const i of list) if ((track.px[i] - x) ** 2 + (track.pz[i] - z) ** 2 < r * r) return true;
    }
    return false;
  };

  // --- real buildings from OSM footprints (extruded walls, flat or hipped roofs)
  const occ = new Set();          // 8 m cells covered by a real footprint
  const density = new Map();      // real buildings per 100 m cell
  const OC = 8;
  const occupied = (x, z, r = 0) => {
    for (let a = Math.floor((x - r) / OC); a <= Math.floor((x + r) / OC); a++)
      for (let b = Math.floor((z - r) / OC); b <= Math.floor((z + r) / OC); b++) if (occ.has(a + ',' + b)) return true;
    return false;
  };
  const densityAt = (x, z) => density.get(Math.floor(x / 100) + ',' + Math.floor(z / 100)) || 0;
  if (buildings && buildings.b) buildRealBuildings(buildings.b, mat, group, chunks, occ, OC, density);

  // --- scenery (procedural fill only where OSM has no buildings)
  const rnd = rngFrom(1234);
  const archetypes = [
    [6, 7, 12], [6, 10.5, 14], [12, 7, 14], [8, 10.5, 16], [12, 14, 18],
  ].map(([w, h, d]) => ({ w, h, d, geo: buildingBox(w, h, d, 6, 7) }));
  const shops = archetypes.map((a) => new Scatter(a.geo, mat.clay));
  const houseGeo = buildingBox(8, 3.6, 9, 6, 7);
  const houses = new Scatter(houseGeo, mat.clay);
  const roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.translate(0, 0.5, 0);
  const roofs = new Scatter(roofGeo, mat.clay);
  const treeKinds = [treeGeometry(5), treeGeometry(9)];
  const trunks = treeKinds.map((t) => new Scatter(t.trunk, mat.trunk));
  const crowns = treeKinds.map((t) => new Scatter(t.crown, mat.leaves));
  const lamps = new Scatter(lampGeometry(), mat.metal);

  const leafColors = ['#c8e0b0', '#d8eac0', '#b8d4a0', '#e4f0c8', '#c0d8a8', '#f0f0c8'];

  const fr = {};
  const tree = (x, z, scale) => {
    const k = (rnd() * 2) | 0;
    const yaw = rnd() * Math.PI * 2;
    trunks[k].add(x, 0, z, yaw, scale, scale, scale);
    crowns[k].add(x, 0, z, yaw, scale, scale * (0.9 + rnd() * 0.3), scale, leafColors[(rnd() * leafColors.length) | 0]);
  };
  const zoneNoise = (s, side) => {
    const a = Math.sin(s * 0.0011 + side * 1.7) + Math.sin(s * 0.0027 + 3.1 * side) * 0.6 + Math.sin(s * 0.0071) * 0.3;
    return a; // > -0.6 urban, else greener
  };

  for (const side of [1, -1]) {
    let s = 0;
    while (s < track.length) {
      const urban = zoneNoise(s, side) > -0.7;
      track.sample(s, fr);
      const yaw = Math.atan2(fr.tx, fr.tz);
      if (urban) {
        const a = archetypes[(rnd() < 0.55 ? 0 : (rnd() * archetypes.length) | 0)];
        const wNeed = a.w + 0.3;
        track.sample(s + wNeed / 2, fr);
        const d = side * (W + 3 + a.d / 2 + rnd() * 1.5);
        const x = fr.x + fr.nx * d, z = fr.z + fr.nz * d;
        const idx = fr.i;
        const real = densityAt(x, z) > 2 || occupied(x, z, Math.max(a.w, a.d) / 2);
        if (!real && !track.gap[idx] && !nearRoad(x, z, a.d * 0.6) && !nearRing(x, z, W + 2 + a.d / 2 - 0.5)) {
          const sy = 0.9 + rnd() * 0.25;
          const yaw2 = Math.atan2(fr.tx, fr.tz);
          shops[archetypes.indexOf(a)].add(x, -0.05, z, yaw2, 1, sy, 1);
          if (rnd() < 0.45) roofs.add(x, a.h * sy - 0.05, z, yaw2, a.w * 1.08, 2.2 + rnd(), a.d * 1.05);
        }
        s += wNeed + (rnd() < 0.15 ? 4 + rnd() * 8 : 0.2);
      } else {
        const d = side * (W + 4 + rnd() * 14);
        const x = fr.x + fr.nx * d, z = fr.z + fr.nz * d;
        if (!nearRoad(x, z, 4) && !nearRing(x, z, W + 2) && !occupied(x, z, 3)) tree(x, z, 0.9 + rnd() * 0.6);
        s += 7 + rnd() * 12;
      }
    }

    // separator trees (shade over the slow lane) and back-lot villages
    for (let s2 = rnd() * 20; s2 < track.length; s2 += 18 + rnd() * 14) {
      track.sample(s2, fr);
      if (track.gap[fr.i] || track.featAt[fr.i] >= 0) continue; // keep crowns clear of decks and trenches
      const d = side * (XS.mainOuter + XS.sepOuter) / 2;
      tree(fr.x + fr.nx * d, fr.z + fr.nz * d, 0.75 + rnd() * 0.35);
    }
    for (let s2 = 0; s2 < track.length; s2 += 7 + rnd() * 9) {
      track.sample(s2, fr);
      const d = side * (W + 26 + rnd() * 170);
      const x = fr.x + fr.nx * d, z = fr.z + fr.nz * d;
      if (nearRoad(x, z, 7) || nearRing(x, z, W + 20) || occupied(x, z, 6)) continue;
      if (rnd() < 0.62 && densityAt(x, z) === 0) {
        const yaw = Math.atan2(fr.tx, fr.tz) + (rnd() < 0.7 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.3;
        const sx = 0.8 + rnd() * 0.5, sz = 0.8 + rnd() * 0.5;
        houses.add(x, -0.05, z, yaw, sx, 0.9 + rnd() * 0.3, sz);
        roofs.add(x, 3.6 * 1.0 - 0.1, z, yaw, 8 * sx * 1.12, 2 + rnd() * 1.2, 9 * sz * 1.12);
      } else {
        tree(x, z, 0.9 + rnd() * 0.8);
      }
    }
  }

  // street lamps on the central median
  for (let s = 0; s < track.length; s += 42) {
    track.sample(s, fr);
    if (track.gapMedian[fr.i] || nearSlab(s, 20)) continue;
    lamps.add(fr.x, track.elev[fr.i] + 0.2, fr.z, Math.atan2(fr.tx, fr.tz), 1, 1, 1);
    lampList.push({ x: fr.x, y: track.elev[fr.i] + 0.2, z: fr.z, nx: fr.nx, nz: fr.nz, s });
  }

  // flyover piers: a single column with a hammerhead cap under the median
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  unitBox.translate(0, 0.5, 0);
  const piers = new Scatter(unitBox, mat.concrete);
  for (const f of track.features) {
    if (f.kind !== 'flyover') continue;
    for (let s = f.s0; s < f.s1; s += 30) {
      track.sample(s, fr);
      const y = track.elevAt(s) - GRADE.deck;
      if (y < 3.5) continue;
      const yaw = Math.atan2(fr.tx, fr.tz);
      piers.add(fr.x, 0, fr.z, yaw, 1.8, y - 1.1, 1.8);
      piers.add(fr.x, y - 1.2, fr.z, yaw, 17, 1.2, 2.4);
    }
  }

  // U-turn openings: a blue U-turn sign facing each direction, hazard bollards on the median ends
  const signFaceGeo = new THREE.CircleGeometry(0.45, 32);
  signFaceGeo.rotateY(Math.PI); // face approaching traffic (-z)
  signFaceGeo.translate(0, 2.35, -0.03);
  const signBackGeo = new THREE.CircleGeometry(0.45, 32);
  signBackGeo.translate(0, 2.35, 0);
  const signPoleGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.4, 8);
  signPoleGeo.translate(0, 1.2, 0);
  const bollardGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.95, 12);
  bollardGeo.translate(0, 0.475, 0);
  const uTex = T.uturnSign(renderer);
  const uSignMat = new THREE.MeshStandardMaterial({ map: uTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: uTex, emissiveIntensity: 0.15 });
  signMats.push(uSignMat);
  const uSigns = new Scatter(signFaceGeo, uSignMat);
  const uBacks = new Scatter(signBackGeo, mat.darkMetal);
  const uPoles = new Scatter(signPoleGeo, mat.metal);
  const bollards = new Scatter(bollardGeo, new THREE.MeshStandardMaterial({ map: T.hazardBands(renderer), roughness: 0.6 }));
  for (const o of track.openings) {
    if (track.featAt[o.idx] >= 0) continue;
    let a = o.idx, b = o.idx;
    while (track.gapMedian[(a - 1 + track.n) % track.n]) a--;
    while (track.gapMedian[(b + 1) % track.n]) b++;
    const sStart = a * track.step, sEnd = (b + 1) * track.step;
    for (const [sn, dir] of [[sStart - 3, 1], [sEnd + 3, -1]]) {
      track.sample(sn, fr);
      const y = track.elevAt(sn) + 0.2;
      const x = fr.x + fr.nx * 0.55 * dir, z = fr.z + fr.nz * 0.55 * dir;
      const yaw = Math.atan2(fr.tx * dir, fr.tz * dir);
      uSigns.add(x, y, z, yaw, 1, 1, 1);
      uBacks.add(x, y, z, yaw, 1, 1, 1);
      uPoles.add(x, y, z, yaw, 1, 1, 1);
    }
    for (const sn of [sStart - 0.6, sEnd + 0.6]) {
      track.sample(sn, fr);
      bollards.add(fr.x, track.elevAt(sn) + 0.2, fr.z, 0, 1, 1, 1);
    }
  }

  for (const sc of [...shops, houses, roofs, ...trunks, ...crowns, lamps, piers, uSigns, uBacks, uPoles, bollards]) sc.build(group, chunks);

  // --- overhead direction signs before each junction, and traffic lights
  const gantryParts = [];
  // one set per carriageway: dir 1 = clockwise (outer), -1 = anticlockwise (inner).
  // Local frame: +z = travel direction, +x = that direction's left (its outer side).
  for (const j of track.junctions) for (const dir of [1, -1]) {
    const s = j.s - 230 * dir;
    if (track.featureAt(j.s) || track.featureAt(s)) continue; // grade-separated: no signals, no stopping
    track.sample(s, fr);
    const yaw = Math.atan2(fr.tx * dir, fr.tz * dir);
    const g = new THREE.Group();
    g.position.set(fr.x, 0, fr.z);
    g.rotation.y = yaw;
    for (const d of [XS.median + 0.4, XS.sepOuter - 0.8]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 7.6, 10), mat.darkMetal);
      pole.position.set(d, 3.8, 0);
      gantryParts.push(pole);
      g.add(pole);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(XS.sepOuter - XS.median - 1.2, 0.35, 0.35), mat.darkMetal);
    beam.position.set((XS.median + XS.sepOuter) / 2, 7.3, 0);
    g.add(beam);
    const signTex = T.roadSign(renderer, j.name, 'Ring Road · 200 m');
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(8.2, 2.64),
      new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.12 }),
    );
    signMats.push(panel.material);
    panel.position.set(6.7, 6.2, -0.2);
    panel.rotation.y = Math.PI; // face oncoming (our) traffic
    const back = new THREE.Mesh(new THREE.BoxGeometry(8.3, 2.74, 0.12), mat.darkMetal);
    back.position.set(6.7, 6.2, -0.1);
    g.add(panel, back, beam);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(g);

  }

  // --- traffic signals at their OSM positions, grouped into junctions that cycle:
  // ring road green -> amber -> red while the crossing streets get their turn.
  const signalHeadMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5 });
  const LAMP = { r: 0xff4636, a: 0xffb52e, g: 0x5dff8a, off: 0x242424 };
  const signal = (x, z, yaw, lamps, arm = 5) => {
    const tl = new THREE.Group();
    tl.position.set(x, 0, z);
    tl.rotation.y = yaw;
    const tp = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 6, 8), mat.darkMetal);
    tp.position.y = 3;
    const armM = new THREE.Mesh(new THREE.BoxGeometry(arm, 0.14, 0.14), mat.darkMetal);
    armM.position.set(-arm / 2, 5.9, 0);
    const hx = -arm + 0.4;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.2, 0.36), signalHeadMat);
    head.position.set(hx, 5.3, 0);
    // lamps top to bottom: red, amber, green; they face -z (towards approaching traffic)
    [[5.65, lamps.r], [5.3, lamps.a], [4.95, lamps.g]].forEach(([y, m]) => {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), m);
      l.position.set(hx, y, -0.19);
      l.rotation.y = Math.PI;
      tl.add(l);
    });
    tl.add(tp, armM, head);
    tl.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(tl);
  };
  const CYCLE = 48; // seconds: ring green 0-30, amber 30-33, red 33-48 (cross green 34-44, amber 44-47)
  const junctions = [];
  const sorted = (track.data.signals || []).slice().sort((p, q) => p[0] - q[0]);
  for (const sg of sorted) {
    const last = junctions.at(-1);
    if (last && sg[0] - last.idxMax <= 40) { last.list.push(sg); last.idxMax = sg[0]; }
    else junctions.push({ list: [sg], idxMax: sg[0] });
  }
  for (const j of junctions) {
    const lampSet = () => ({ r: new THREE.MeshBasicMaterial({ color: LAMP.off }), a: new THREE.MeshBasicMaterial({ color: LAMP.off }), g: new THREE.MeshBasicMaterial({ color: LAMP.off }) });
    j.ring = lampSet();
    j.cross = lampSet();
    j.offset = (j.list[0][0] * 7.3) % CYCLE;
    j.stop = { 1: null, '-1': null }; // stop-line s per travel direction
    j.s = j.list[0][0] * track.step;
    for (const [idx, d, sx, sz] of j.list) {
      const f = track.featAt[idx] >= 0 ? track.features[track.featAt[idx]] : null;
      if (f && Math.abs(d) < GRADE.edge + 1) continue; // over a trench or under a deck
      track.sample(idx * track.step, fr);
      const dir = d >= 0 ? 1 : -1;
      if (Math.abs(d) <= 14) {
        // stop line on a ring carriageway: pole on that carriageway's kerb, arm over the lanes
        const pd = dir * (XS.mainOuter + 0.8);
        signal(fr.x + fr.nx * pd, fr.z + fr.nz * pd, Math.atan2(fr.tx * dir, fr.tz * dir), j.ring);
        const s = idx * track.step, cur = j.stop[dir];
        if (cur === null || (dir > 0 ? s < cur : s > cur)) j.stop[dir] = s;
      } else {
        // crossing-street approach: traffic heads towards the ring, the head faces it
        const ax = -fr.nx * dir, az = -fr.nz * dir;
        const ox = fr.tx * 5 * dir, oz = fr.tz * 5 * dir; // step to the street's kerb
        signal(sx + ox, sz + oz, Math.atan2(ax, az), j.cross, 4);
      }
    }
  }
  const ringPhase = (j, time) => {
    const u = (time + j.offset) % CYCLE;
    return u < 30 ? 'g' : u < 33 ? 'a' : 'r';
  };
  const signals = {
    junctions,
    ringPhase,
    update(time) {
      for (const j of junctions) {
        const u = (time + j.offset) % CYCLE;
        const ring = ringPhase(j, time);
        const cross = u >= 34 && u < 44 ? 'g' : u >= 44 && u < 47 ? 'a' : 'r';
        for (const k of ['r', 'a', 'g']) {
          j.ring[k].color.setHex(ring === k ? LAMP[k] : LAMP.off);
          j.cross[k].color.setHex(cross === k ? LAMP[k] : LAMP.off);
        }
      }
    },
  };

  // --- Merapi and Merbabu on the northern horizon
  const mountain = (x, z, radius, height, seed, color) => {
    const g = new THREE.ConeGeometry(radius, height, 96, 24, true);
    const p = g.attributes.position;
    const r = rngFrom(seed);
    const ph = [r() * 6, r() * 6, r() * 6];
    for (let k = 0; k < p.count; k++) {
      const vx = p.getX(k), vy = p.getY(k), vz = p.getZ(k);
      const a = Math.atan2(vz, vx);
      const t = (vy + height / 2) / height; // 0 base .. 1 top
      // concave volcano profile + ridges
      const profile = Math.pow(1 - t, 1.9);
      const ridge = 1 + 0.08 * Math.sin(a * 13 + ph[0]) * (1 - t) + 0.05 * Math.sin(a * 29 + ph[1]) + 0.04 * Math.sin(a * 5 + ph[2]);
      const rr = Math.max(radius * 0.035, radius * profile * ridge);
      p.setXYZ(k, Math.cos(a) * rr, vy + height / 2, Math.sin(a) * rr);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, fog: false }));
    m.position.set(x, -40, z);
    return m;
  };
  const mountains = [mountain(9000, -32000, 15000, 2900, 3, 0x6f7f92), mountain(6500, -43000, 14000, 3100, 7, 0x7e8ea2)];
  group.add(...mountains);

  // --- night kit: glowing lamp heads, halos, and pools of sodium light on the road.
  // Everything lives in one group that is only shown at night.
  const nightGroup = new THREE.Group();
  nightGroup.visible = false;
  group.add(nightGroup);
  const glowTex = T.glow(renderer);
  const LAMP_COLOR = 0xffc37a;
  {
    const headGeo = new THREE.BoxGeometry(0.86, 0.06, 0.32);
    const heads = new Scatter(headGeo, new THREE.MeshBasicMaterial({ color: 0xfff0d0 }), { shadow: false, receive: false });
    const poolGeo = new THREE.CircleGeometry(15, 28);
    poolGeo.rotateX(-Math.PI / 2);
    const pools = new Scatter(poolGeo, new THREE.MeshBasicMaterial({
      map: T.glow(renderer, 0.3), color: LAMP_COLOR, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }), { shadow: false, receive: false });
    const halo = [];
    for (const l of lampList) {
      for (const side of [-1, 1]) {
        const hx = l.x + l.nx * 3.1 * side, hz = l.z + l.nz * 3.1 * side;
        heads.add(hx, l.y + 9.62, hz, Math.atan2(-l.nz, l.nx), 1, 1, 1); // just under the lamp head, long side across the road
        halo.push(hx, l.y + 9.55, hz);
        pools.add(l.x + l.nx * 6.7 * side, l.y - 0.16, l.z + l.nz * 6.7 * side, 0, 1, 1, 1);
      }
    }
    heads.build(nightGroup, chunks);
    pools.build(nightGroup, chunks);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(halo, 3));
    const halos = new THREE.Points(hg, new THREE.PointsMaterial({
      map: glowTex, color: LAMP_COLOR, size: 4.2, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halos.frustumCulled = false;
    nightGroup.add(halos);
  }
  const mountainDay = mountains.map((m) => m.material.color.getHex());
  const setNight = (on) => {
    nightGroup.visible = on;
    mat.clay.emissive.setHex(on ? 0x16130f : 0x000000); // keep silhouettes readable in the dark
    for (const m of signMats) m.emissiveIntensity = on ? 0.85 : 0.14;
    mountains.forEach((m, i) => m.material.color.setHex(on ? 0x0b1019 : mountainDay[i]));
  };

  return { group, chunks, signals, setNight, lamps: lampList, glowTex };
}
