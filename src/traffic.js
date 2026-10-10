import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { XS } from './track.js';

// Ambient traffic in track coordinates (s along the loop, d lateral). Vehicles exist
// only in a window around the player and are recycled as they leave it.
//
// dir +1 = clockwise on the outer carriageway (d > 0), dir -1 = anticlockwise (d < 0).
// Lane 0 is next to the median (the fast lane, since traffic keeps left), lane 2 the
// outer main lane, lane 3 the separated slow lane (jalur lambat).

const LANE_D = [3.25, 6.75, 10.25, 16.4];
const LANE_KMH = [[68, 88], [55, 75], [42, 60], [34, 52]];
const AHEAD = 950, BEHIND = 400;
const PLAYER = { len: 5.4, wid: 1.9 };
export const VEHICLE_CRASH_KMH = 25; // closing speed above which touching a vehicle is a crash
const UTURN_R = LANE_D[0], UTURN_TIME = 3.4, UTURN_CHANCE = 0.07;

// --- low-poly vehicle models: `body` parts take the per-vehicle paint colour,
// `trim` parts (glass, tyres, lights, cargo) keep their own colours.
function part(geo, color) {
  const g = geo.toNonIndexed();
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(color, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const box = (w, h, d, x, y, z, color) => part(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
const wheel = (r, w, x, z) => part(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2).translate(x, r, z), TYRE);
const WHITE = [1, 1, 1], GLASS = [0.07, 0.09, 0.11], TYRE = [0.035, 0.035, 0.04], DARK = [0.1, 0.1, 0.11];
const HEAD = [1.0, 0.97, 0.85], TAIL = [0.75, 0.04, 0.04];

function wheels4(r, w, track, zf, zr) {
  return [wheel(r, w, track, zf), wheel(r, w, -track, zf), wheel(r, w, track, zr), wheel(r, w, -track, zr)];
}
function lights(w, y, zf, zr) {
  return [
    box(0.32, 0.14, 0.06, w, y, zf, HEAD), box(0.32, 0.14, 0.06, -w, y, zf, HEAD),
    box(0.3, 0.14, 0.06, w, y, zr, TAIL), box(0.3, 0.14, 0.06, -w, y, zr, TAIL),
  ];
}

function models() {
  const m = {};
  // MPV (the family people-carrier you see everywhere)
  m.mpv = {
    len: 4.3, wid: 1.75,
    body: [box(1.75, 0.72, 4.3, 0, 0.68, 0, WHITE), box(1.62, 0.07, 2.75, 0, 1.69, -0.25, WHITE), box(1.6, 0.1, 0.9, 0, 1.06, 1.7, WHITE)],
    trim: [box(1.58, 0.64, 2.7, 0, 1.36, -0.25, GLASS), ...wheels4(0.32, 0.22, 0.78, 1.35, -1.35), ...lights(0.6, 0.82, 2.16, -2.16), box(1.76, 0.16, 4.32, 0, 0.36, 0, DARK)],
  };
  // city hatchback
  m.hatch = {
    len: 3.7, wid: 1.65,
    body: [box(1.65, 0.62, 3.7, 0, 0.62, 0, WHITE), box(1.5, 0.06, 1.9, 0, 1.47, -0.35, WHITE)],
    trim: [box(1.48, 0.54, 1.95, 0, 1.2, -0.35, GLASS), ...wheels4(0.29, 0.2, 0.74, 1.15, -1.2), ...lights(0.56, 0.74, 1.86, -1.86), box(1.66, 0.14, 3.72, 0, 0.34, 0, DARK)],
  };
  // city bus
  m.bus = {
    len: 9.2, wid: 2.4,
    body: [box(2.4, 2.45, 9.2, 0, 1.75, 0, WHITE)],
    trim: [
      box(2.42, 0.85, 8.3, 0, 2.2, -0.1, GLASS), box(2.2, 1.0, 0.08, 0, 2.05, 4.6, GLASS),
      ...wheels4(0.48, 0.3, 1.05, 3.0, -2.9), ...lights(0.85, 0.9, 4.61, -4.61), box(2.41, 0.3, 9.22, 0, 0.6, 0, DARK),
    ],
  };
  // box truck
  m.truck = {
    len: 6.9, wid: 2.3,
    body: [box(2.2, 1.85, 1.9, 0, 1.5, 2.45, WHITE)],
    trim: [
      box(2.3, 2.3, 4.7, 0, 1.95, -1.05, [0.78, 0.77, 0.73]), box(2.0, 0.7, 0.08, 0, 1.95, 3.41, GLASS),
      box(1.0, 0.35, 6.6, 0, 0.6, 0, DARK), ...wheels4(0.45, 0.3, 1.0, 2.4, -2.2), ...lights(0.8, 0.85, 3.41, -3.41),
    ],
  };
  // motorbike with rider
  const wheelB = (z) => part(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 14).rotateZ(Math.PI / 2).translate(0, 0.3, z), TYRE);
  m.bike = {
    len: 1.95, wid: 0.75,
    body: [box(0.3, 0.34, 1.15, 0, 0.62, 0, WHITE), part(new THREE.SphereGeometry(0.15, 10, 8).translate(0, 1.62, -0.05), WHITE)],
    trim: [
      wheelB(0.65), wheelB(-0.65), box(0.46, 0.58, 0.3, 0, 1.18, -0.12, [0.13, 0.14, 0.18]),
      box(0.4, 0.2, 0.55, 0, 0.82, 0.1, [0.1, 0.11, 0.14]), box(0.55, 0.05, 0.05, 0, 1.02, 0.5, DARK),
      box(0.1, 0.1, 0.05, 0, 0.9, 0.6, HEAD), box(0.14, 0.08, 0.05, 0, 0.78, -0.62, TAIL),
    ],
  };
  for (const k in m) { m[k].body = mergeGeometries(m[k].body); m[k].trim = mergeGeometries(m[k].trim); }
  return m;
}

const PAINT = {
  mpv: ['#f2f2ee', '#c9ccd0', '#1c1d21', '#6d7278', '#8a1f24', '#1e2f55', '#d9d4c5', '#3b3f45'],
  hatch: ['#f2f2ee', '#c22d2d', '#e6b422', '#2a6fb5', '#1c1d21', '#b7bbc0', '#3c8f5a'],
  bus: ['#2f7d5b', '#2a5fa8', '#d9d9d2'],
  truck: ['#e0b62a', '#2a5fa8', '#f0efe9', '#c8392f'],
  bike: ['#1c1d21', '#c22d2d', '#2a5fa8', '#f2f2ee', '#e6b422', '#3c8f5a'],
};
// per direction: [type, count, allowed lanes]
const FLEET = [['mpv', 14, [0, 1, 2]], ['hatch', 8, [0, 1, 2]], ['bus', 2, [2]], ['truck', 3, [1, 2]], ['bike', 16, [3]], ['bike', 6, [2]]];

export class Traffic {
  constructor(track, scene, signals) {
    this.track = track;
    this.signals = signals;
    this.vehicles = [];
    this.touching = 0;      // +1 / -1 while the player rubs along a vehicle (for sparks)
    this.honk = 0;          // set > 0 when someone should honk this frame
    const M = models();
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 });
    const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
    this.meshes = {};
    const counts = {};
    for (const [type, n] of FLEET) counts[type] = (counts[type] || 0) + n * 2;
    for (const type in counts) {
      const body = new THREE.InstancedMesh(M[type].body, bodyMat, counts[type]);
      const trim = new THREE.InstancedMesh(M[type].trim, trimMat, counts[type]);
      for (const m of [body, trim]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }
      this.meshes[type] = { body, trim, next: 0 };
    }
    const col = new THREE.Color();
    for (const dir of [1, -1]) {
      for (const [type, n, lanes] of FLEET) {
        for (let i = 0; i < n; i++) {
          const mesh = this.meshes[type];
          const slot = mesh.next++;
          const paint = PAINT[type][(Math.random() * PAINT[type].length) | 0];
          mesh.body.setColorAt(slot, col.set(paint));
          this.vehicles.push({ type, slot, lanes, len: M[type].len, wid: M[type].wid, dir, s: 0, d: 0, v: 0, vDes: 0, lane: 0, state: 'drive', blocked: 0, hit: 0, psi: 0 });
        }
      }
    }
    for (const type in this.meshes) this.meshes[type].body.instanceColor.needsUpdate = true;
    // night: head/tail-light halos (4 points per vehicle) and a pool of light ahead of each
    const n = this.vehicles.length;
    this.lightPos = new Float32Array(n * 4 * 3);
    const lc = new Float32Array(n * 4 * 3);
    for (let i = 0; i < n; i++) {
      lc.set([1, 0.95, 0.8, 1, 0.95, 0.8, 1, 0.08, 0.05, 1, 0.08, 0.05], i * 12);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lightPos, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    this.lightPts = new THREE.Points(lg, new THREE.PointsMaterial({
      size: 1.5, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.lightPts.frustumCulled = false;
    this.lightPts.visible = false;
    const beamGeo = new THREE.PlaneGeometry(5, 16).rotateX(-Math.PI / 2).translate(0, 0, 8);
    this.beams = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({
      color: 0xfff1cf, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
    }), n);
    this.beams.frustumCulled = false;
    this.beams.visible = false;
    scene.add(this.lightPts, this.beams);
    this.night = false;

    // openings usable for U-turns
    this.openings = track.openings.filter((o) => track.featAt[o.idx] < 0);
    this.seeded = false;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._f = {};
  }

  setNight(on, glowTex) {
    this.night = on;
    this.lightPts.visible = this.beams.visible = on;
    if (glowTex && !this.lightPts.material.map) {
      this.lightPts.material.map = glowTex;
      this.beams.material.map = glowTex;
      this.lightPts.material.needsUpdate = this.beams.material.needsUpdate = true;
    }
  }

  // signed distance from a to b along the loop, in (-L/2, L/2]
  rel(a, b) {
    const L = this.track.length;
    let r = (b - a) % L;
    if (r > L / 2) r -= L;
    if (r < -L / 2) r += L;
    return r;
  }

  place(v, playerS, relS) {
    const t = this.track;
    for (let tries = 0; tries < 8; tries++) {
      const lane = v.lanes[(Math.random() * v.lanes.length) | 0];
      const s = t.wrap(playerS + relS + (Math.random() - 0.5) * 60 * tries);
      const d = v.dir * LANE_D[lane];
      let clear = true;
      for (const o of this.vehicles) {
        if (o !== v && o.vDes && Math.abs(o.d - d) < 2 && Math.abs(this.rel(o.s, s)) < 14) { clear = false; break; }
      }
      if (!clear) continue;
      const [lo, hi] = LANE_KMH[lane];
      v.lane = lane; v.s = s; v.d = d;
      v.vDes = (lo + Math.random() * (hi - lo)) / 3.6 * (v.type === 'bus' || v.type === 'truck' ? 0.85 : 1);
      v.v = v.vDes * 0.9;
      v.state = 'drive'; v.blocked = 0; v.hit = 0; v.psi = 0; v.wantsU = null; v.seenOpening = -1;
      return;
    }
    // no room found: park it out of sight until the next recycle
    v.s = t.wrap(playerS + relS); v.d = v.dir * LANE_D[v.lanes[0]]; v.vDes = 8; v.v = 8; v.state = 'drive';
  }

  // nearest stop line ahead for this direction that isn't showing green
  redStop(v, time) {
    let best = Infinity;
    for (const j of this.signals.junctions) {
      const stop = j.stop[v.dir];
      if (stop === null) continue;
      const ahead = this.rel(v.s, stop) * v.dir;
      if (ahead < -1 || ahead > 90) continue;
      const ph = this.signals.ringPhase(j, time);
      if (ph === 'g' || (ph === 'a' && ahead < 14)) continue;
      best = Math.min(best, ahead);
    }
    return best;
  }

  update(dt, time, player) {
    const t = this.track, V = this.vehicles;
    if (!this.seeded) {
      this.seeded = true;
      for (const v of V) this.place(v, player.s, -BEHIND + Math.random() * (AHEAD + BEHIND));
    }
    this.touching = 0;
    this.honk = Math.max(0, this.honk - dt);
    const pAlong = player.v * Math.cos(player.psi);

    for (const v of V) {
      // recycle outside the window: reappear at the far end
      const r = this.rel(player.s, v.s);
      if (r > AHEAD + 400 || r < -BEHIND - 400) this.place(v, player.s, -BEHIND + Math.random() * (AHEAD + BEHIND)); // player jumped
      else if (r > AHEAD + 60) this.place(v, player.s, -BEHIND);
      else if (r < -BEHIND - 60) this.place(v, player.s, AHEAD);

      if (v.state === 'uturn') { this.stepUturn(v, dt); continue; }

      // --- what's ahead: vehicles in my lane, the player, a red light, my U-turn spot
      let gap = Infinity, leadV = 0;
      const see = (ahead, halfLens, speed) => {
        const g = ahead - halfLens;
        if (ahead > 0 && g < gap) { gap = g; leadV = speed; }
      };
      for (const o of V) {
        if (o === v || Math.abs(o.d - v.d) > (o.wid + v.wid) / 2 + 0.35) continue;
        const ahead = this.rel(v.s, o.s) * v.dir;
        if (ahead <= 0 || ahead > 120) continue;
        see(ahead, (o.len + v.len) / 2, o.state === 'uturn' ? 0 : Math.max(0, o.v * o.dir * v.dir));
      }
      if (Math.abs(player.d - v.d) < (PLAYER.wid + v.wid) / 2 + 0.3) {
        const ahead = this.rel(v.s, player.s) * v.dir;
        if (ahead > 0 && ahead < 120) see(ahead, (PLAYER.len + v.len) / 2, Math.max(0, pAlong * v.dir));
      }
      const red = this.redStop(v, time);
      if (red < Infinity) see(red + 0.01, v.len / 2 + 1.5, 0);

      // U-turn intent: some fast-lane cars pick an opening, stop beside it, and wait for a gap
      if (v.lane === 0 && v.type !== 'bus' && v.type !== 'truck' && v.state === 'drive' && !v.wantsU) {
        for (const o of this.openings) {
          const ahead = this.rel(v.s, o.s) * v.dir;
          if (ahead > 40 && ahead < 70 && v.seenOpening !== o.idx) {
            v.seenOpening = o.idx;
            if (Math.random() < UTURN_CHANCE) v.wantsU = o;
          }
        }
      }
      if (v.wantsU) {
        const ahead = this.rel(v.s, v.wantsU.s) * v.dir;
        if (ahead < -6) v.wantsU = null;
        else {
          see(Math.max(0.02, ahead + 3.2), 0, 0); // aim to come to rest beside the opening
          if (ahead < 2.5 && v.v < 1 && this.oncomingClear(v, player, pAlong)) {
            v.state = 'uturn'; v.ut = 0; v.u0 = v.s; v.v = 0;
            continue;
          }
        }
      }

      // --- car following: free-road acceleration, braking for whatever is ahead
      let a = 2.4 * (1 - Math.pow(v.v / v.vDes, 4));
      if (v.hit > 0) { v.hit -= dt; a = -7; }
      else if (gap < Infinity) {
        const want = 3 + v.v * 0.9;
        if (gap < want) a = Math.min(a, -Math.min(8, (want - gap) * 1.3 + Math.max(0, v.v - leadV) * 1.5));
        else if (gap < want * 2.2 && v.v > leadV) a = Math.min(a, -(v.v - leadV) * (v.v - leadV) / (2 * Math.max(1, gap - want)));
      }
      v.v = Math.max(0, v.v + a * dt);
      if (gap < 0.3) v.v = Math.min(v.v, leadV);
      v.s = t.wrap(v.s + v.dir * v.v * dt);

      // --- lane changes (main lanes only) when stuck behind something slower
      const stuck = gap < 3 + v.v * 1.4 && v.v < v.vDes * 0.75 && red === Infinity && !v.wantsU;
      v.blocked = stuck ? v.blocked + dt : 0;
      const target = v.dir * LANE_D[v.lane];
      if (v.lane < 3 && v.blocked > 1.4 && Math.abs(v.d - target) < 0.1 && v.hit <= 0) {
        for (const nl of v.lane === 1 ? [0, 2] : [1]) {
          if (!v.lanes.includes(nl)) continue;
          const nd = v.dir * LANE_D[nl];
          let free = Math.abs(player.d - nd) > 2.2 || Math.abs(this.rel(v.s, player.s)) > 18;
          for (const o of V) {
            if (!free) break;
            if (o !== v && Math.abs(o.d - nd) < 2.2) {
              const ah = this.rel(v.s, o.s) * v.dir;
              if (ah > -14 && ah < 22) free = false;
            }
          }
          if (free) { v.lane = nl; v.blocked = 0; break; }
        }
      }
      const dd = v.dir * LANE_D[v.lane] - v.d;
      const stepD = Math.sign(dd) * Math.min(Math.abs(dd), 1.3 * dt * Math.min(1, v.v / 4));
      v.d += stepD;
      v.psi = v.v > 1 ? Math.atan2(stepD / dt, v.v) * v.dir : 0;

      // honk at a player who has been sitting in the way
      if (v.v < 0.5 && gap < 4 && red === Infinity && Math.abs(player.d - v.d) < 1.8 && Math.abs(player.v) < 1) {
        v.wait = (v.wait || 0) + dt;
        if (v.wait > 3.5 && this.honk <= 0) { this.honk = 6; this.honkNow = true; v.wait = 0; }
      } else v.wait = 0;
    }

    this.collide(player, pAlong);
    this.render();
  }

  oncomingClear(v, player, pAlong) {
    // traffic on the other carriageway's two inner lanes, approaching the opening
    const od = -v.dir;
    const near = (s, d, speedAlong) => {
      if (Math.sign(d) !== od || Math.abs(d) > LANE_D[1] + 1.6) return false;
      const upstream = this.rel(s, v.s) * od; // how far before the opening it still is
      return upstream > -7 && upstream < 12 + Math.max(0, speedAlong * od) * 2.6;
    };
    for (const o of this.vehicles) if (o !== v && near(o.s, o.d, o.v * o.dir)) return false;
    return !near(player.s, player.d, pAlong);
  }

  stepUturn(v, dt) {
    v.ut += dt / UTURN_TIME;
    const th = Math.min(1, v.ut) * Math.PI;
    v.s = this.track.wrap(v.u0 + v.dir * UTURN_R * 1.15 * Math.sin(th));
    v.d = v.dir * UTURN_R * Math.cos(th);
    v.psi = -th * v.dir; // always a right-hand turn across the median
    v.v = 2.5;
    if (v.ut >= 1) {
      v.dir = -v.dir;
      v.d = v.dir * UTURN_R;
      v.lane = 0; v.psi = 0; v.state = 'drive'; v.wantsU = null; v.v = 3; v.blocked = 0;
    }
  }

  collide(player, pAlong) {
    const t = this.track;
    for (const v of this.vehicles) {
      if (Math.abs(v.d) > XS.mainOuter) continue; // slow-lane traffic is behind the kerb
      const ds = this.rel(player.s, v.s), dd = v.d - player.d;
      const penS = (PLAYER.len + v.len) / 2 - 0.15 - Math.abs(ds);
      const penD = (PLAYER.wid + v.wid) / 2 - 0.1 - Math.abs(dd);
      if (penS <= 0 || penD <= 0) continue;
      const vAlong = v.state === 'uturn' ? 0 : v.v * v.dir;
      if (penD < penS * 0.6) {
        // side contact: shove the player sideways off the vehicle
        const side = Math.sign(dd) || 1;
        const lateral = player.v * Math.sin(player.psi) * side; // speed into the vehicle
        player.d -= side * penD;
        const base = Math.abs(player.psi) > Math.PI / 2 ? Math.sign(player.psi) * Math.PI : 0;
        if (lateral * 3.6 > VEHICLE_CRASH_KMH && player.crashCooldown <= 0) {
          player.psi = base - (player.psi - base) * 0.3;
          player.v *= 0.6;
          v.hit = 1.5;
          player.registerCrash(lateral * 3.6, side);
          this.honkNow = true;
        } else {
          player.psi = base + (player.psi - base) * 0.7;
          player.scrape = Math.max(player.scrape, 0.8);
          this.touching = side;
        }
        continue;
      }
      // nose-to-tail (or head-on): closing speed along the road decides
      const front = Math.sign(ds) || 1;             // vehicle is ahead (+) or behind (-) in s
      const closing = (pAlong - vAlong) * front;
      player.s = t.wrap(v.s - front * ((PLAYER.len + v.len) / 2 - 0.1));
      const c = Math.cos(player.psi);
      const setAlong = (x) => { player.v = Math.abs(c) > 0.25 ? x / c : player.v * 0.25; };
      if (closing * 3.6 > VEHICLE_CRASH_KMH && player.crashCooldown <= 0) {
        setAlong(vAlong - (pAlong - vAlong) * 0.12);
        if (v.state !== 'uturn') v.v = Math.max(0, (vAlong + (pAlong - vAlong) * 0.3) * v.dir);
        v.hit = 2.2;
        player.registerCrash(closing * 3.6, 0);
        this.honkNow = true;
      } else if (closing > 0) {
        setAlong(vAlong); // gentle nudge: just match speeds
      }
    }
  }

  render() {
    const t = this.track, f = this._f;
    this._vi = 0;
    for (const v of this.vehicles) {
      t.sample(v.s, f);
      const main = Math.abs(v.d) <= XS.mainOuter;
      const y = main ? t.elevAt(v.s) : 0;
      const heading = (v.dir > 0 ? 0 : Math.PI) + v.psi;
      const ch = Math.cos(heading), sh = Math.sin(heading);
      const dx = f.tx * ch + f.nx * sh, dz = f.tz * ch + f.nz * sh;
      const grade = main ? t.slopeAt(v.s) * ch : 0;
      this._e.set(-Math.atan(grade), Math.atan2(dx, dz), 0);
      this._q.setFromEuler(this._e);
      this._p.set(f.x + f.nx * v.d, y, f.z + f.nz * v.d);
      this._m.compose(this._p, this._q, this._one);
      const mesh = this.meshes[v.type];
      mesh.body.setMatrixAt(v.slot, this._m);
      mesh.trim.setMatrixAt(v.slot, this._m);
      if (this.night) {
        const i = this._vi++;
        // lamps sit at the corners: right vector is (dz, -dx)
        const hw = v.type === 'bike' ? 0.05 : v.wid * 0.36, hl = v.len / 2, ly = y + (v.type === 'bike' ? 0.9 : 0.8);
        const px = this._p.x, pz = this._p.z, rx = dz * hw, rz = -dx * hw;
        this.lightPos.set([
          px + dx * hl + rx, ly, pz + dz * hl + rz, px + dx * hl - rx, ly, pz + dz * hl - rz,
          px - dx * hl + rx, ly, pz - dz * hl + rz, px - dx * hl - rx, ly, pz - dz * hl - rz,
        ], i * 12);
        this._p.x += dx * hl; this._p.z += dz * hl; this._p.y += 0.05;
        this._m.compose(this._p, this._q, this._one);
        this.beams.setMatrixAt(i, this._m);
      }
    }
    if (this.night) {
      this.lightPts.geometry.attributes.position.needsUpdate = true;
      this.beams.instanceMatrix.needsUpdate = true;
    }
    for (const k in this.meshes) {
      this.meshes[k].body.instanceMatrix.needsUpdate = true;
      this.meshes[k].trim.instanceMatrix.needsUpdate = true;
    }
  }
}
