import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XS } from './track.js';

// ---------------------------------------------------------------------------
// Model: load the glTF, bake all node transforms, re-orient to +z forward / +y up,
// and split the merged wheel meshes into four spinning (and two steering) wheels.

export async function loadCarModel(url, onProgress) {
  const gltf = await new GLTFLoader().loadAsync(url, (e) => {
    if (onProgress && e.total) onProgress(e.loaded / e.total);
  });
  const src = gltf.scene;
  src.updateMatrixWorld(true);

  const parts = [];
  src.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    g.computeBoundingBox();
    parts.push({ g, m: o.material, name: o.material.name || '' });
  });

  const unionOf = (filter) => {
    const b = new THREE.Box3();
    parts.filter(filter).forEach((p) => b.union(p.g.boundingBox));
    return b;
  };
  const all = unionOf(() => true);
  const size = all.getSize(new THREE.Vector3());
  const center = all.getCenter(new THREE.Vector3());
  const axes = ['x', 'y', 'z'].sort((a, b) => size[a] - size[b]);
  const upAx = axes[0], fwdAx = axes[2];
  const tyreC = unionOf((p) => /sidewall/.test(p.name)).getCenter(new THREE.Vector3());
  const rearC = unionOf((p) => /rear_light/.test(p.name)).getCenter(new THREE.Vector3());
  const noseC = unionOf((p) => /steeringwheel/.test(p.name)).getCenter(new THREE.Vector3());
  const up = new THREE.Vector3();
  up[upAx] = Math.sign(center[upAx] - tyreC[upAx]) || 1;
  const fwd = new THREE.Vector3();
  // the steering wheel sits ahead of the rear light cluster
  fwd[fwdAx] = Math.sign((noseC[fwdAx] - rearC[fwdAx])) || 1;
  const lat = new THREE.Vector3().crossVectors(up, fwd);
  const toCar = new THREE.Matrix4().makeBasis(lat, up, fwd).invert();
  parts.forEach((p) => { p.g.applyMatrix4(toCar); p.g.computeBoundingBox(); });

  // ground at tyre bottom, origin at the centre of the wheelbase
  const tyres = unionOf((p) => /sidewall/.test(p.name));
  const ox = (tyres.min.x + tyres.max.x) / 2;
  const oz = (tyres.min.z + tyres.max.z) / 2;
  const oy = tyres.min.y;
  parts.forEach((p) => { p.g.translate(-ox, -oy, -oz); p.g.computeBoundingBox(); });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // wheels
  const isWheel = (p) => /sidewall|wheel_hub|discs/.test(p.name);
  const wheelBits = { FL: [], FR: [], RL: [], RR: [] };
  for (const p of parts.filter(isWheel)) {
    const g = p.g;
    if (!g.index) {
      const a = new Uint32Array(g.attributes.position.count);
      for (let i = 0; i < a.length; i++) a[i] = i;
      g.setIndex(new THREE.BufferAttribute(a, 1));
    }
    const idx = g.index.array;
    const pos = g.attributes.position;
    const buckets = { FL: [], FR: [], RL: [], RR: [] };
    for (let t = 0; t < idx.length; t += 3) {
      let cx = 0, cz = 0;
      for (let k = 0; k < 3; k++) { cx += pos.getX(idx[t + k]); cz += pos.getZ(idx[t + k]); }
      // +x is the car's left (x = up × forward)
      const key = (cz > 0 ? 'F' : 'R') + (cx > 0 ? 'L' : 'R');
      buckets[key].push(idx[t], idx[t + 1], idx[t + 2]);
    }
    for (const key in buckets) {
      if (!buckets[key].length) continue;
      const sub = g.clone();
      sub.setIndex(buckets[key]);
      wheelBits[key].push({ g: sub, m: p.m });
    }
  }
  const wheels = {};
  for (const key in wheelBits) {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const { g } of wheelBits[key]) {
      const pos = g.attributes.position, idx = g.index.array;
      for (let i = 0; i < idx.length; i++) box.expandByPoint(v.fromBufferAttribute(pos, idx[i]));
    }
    const c = box.getCenter(new THREE.Vector3());
    const steer = new THREE.Group();
    steer.position.copy(c);
    const spin = new THREE.Group();
    steer.add(spin);
    for (const { g, m } of wheelBits[key]) {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.copy(c).negate();
      spin.add(mesh);
    }
    root.add(steer);
    wheels[key] = { steer, spin, radius: (box.max.y - box.min.y) / 2 };
  }

  // steering wheel assembly rotates as one
  const swBox = unionOf((p) => /steeringwheel/.test(p.name)).expandByScalar(0.03);
  const swCenter = swBox.getCenter(new THREE.Vector3());
  const steeringWheel = new THREE.Group();
  steeringWheel.position.copy(swCenter);
  body.add(steeringWheel);

  for (const p of parts) {
    if (isWheel(p)) continue;
    const mesh = new THREE.Mesh(p.g, p.m);
    if (swBox.containsBox(p.g.boundingBox)) {
      mesh.position.copy(swCenter).negate();
      steeringWheel.add(mesh);
    } else {
      body.add(mesh);
    }
  }

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const m = o.material;
    if (m && m.isMeshStandardMaterial) {
      m.envMapIntensity = 1.0;
      if (/glass/.test(m.name)) { m.transparent = true; m.opacity = Math.min(m.opacity, 0.35); }
    }
  });

  const finalBox = new THREE.Box3().setFromObject(root);
  const wheelbase = wheels.FL.steer.position.z - wheels.RL.steer.position.z;
  return {
    root, body, wheels, steeringWheel,
    info: {
      length: finalBox.max.z - finalBox.min.z,
      width: finalBox.max.x - finalBox.min.x,
      height: finalBox.max.y - finalBox.min.y,
      wheelbase,
      cockpit: swCenter.clone(),
    },
  };
}

// ---------------------------------------------------------------------------
// Physics in track coordinates: s (distance along the loop), d (lateral offset,
// +left), psi (heading relative to the road tangent). Kerbs act as soft walls.

const G = 9.81;
// speed (km/h) at 12,000 rpm in each gear
const GEAR_TOP = [82, 118, 152, 186, 220, 256, 292, 340];
const RPM_MAX = 12000, RPM_IDLE = 4200;
// speed into a wall (km/h) above which a hit counts as a crash rather than a scrape
export const CRASH_KMH = 50;

export class CarPhysics {
  constructor(track, info) {
    this.track = track;
    this.wheelbase = info.wheelbase || 3.6;
    this.halfWidth = (info.width || 1.9) / 2;
    this.s = 0;
    this.d = 6.75; // middle lane
    this.side = 1; // which carriageway: 1 = outer (clockwise), -1 = inner (anticlockwise)
    this.medianOpen = false;
    this.crashCount = 0;
    this.crashCooldown = 0;
    this.crashTimer = 0;      // brief power loss after an impact
    this.lastCrash = null;    // { kmh, wall: +1 left / -1 right of the road frame, s, d }
    this.psi = 0;
    this.v = 0;
    this.steer = 0;
    this.gear = 1;
    this.rpm = RPM_IDLE;
    this.throttle = 0;
    this.brake = 0;
    this.shiftTimer = 0;
    this.accel = 0;
    this.latAcc = 0;
    this.reverse = false;
    this.scrape = 0;
    this.odometer = 0;
    this.events = []; // 'up' | 'down' for audio
    this.frame = {};
  }

  get kmh() { return Math.abs(this.v) * 3.6; }

  gearLabel() {
    if (this.reverse) return 'R';
    if (this.v < 0.4 && this.throttle < 0.05) return 'N';
    return String(this.gear);
  }

  update(dt, input) {
    const steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const spd = Math.abs(this.v);

    // speed-sensitive steering, eased in and out
    // generous lock at parking speeds so U-turns fit through median openings
    const maxSteer = 0.6 / (1 + spd / 8) + 0.02;
    const target = steerIn * maxSteer;
    const rate = steerIn === 0 ? 4.5 : 2.6;
    this.steer += (target - this.steer) * Math.min(1, rate * dt);

    // pedals: forward/backward intents, with reverse at standstill
    if (this.reverse && this.v > 0.6) this.reverse = false;
    if (!this.reverse && this.v < -0.6) this.reverse = true;
    let throttle = 0, brake = 0;
    if (!this.reverse) {
      if (input.up) throttle = 1;
      if (input.down) {
        if (this.v > 0.6) brake = 1;
        else { this.reverse = true; }
      }
    } else {
      if (input.down) throttle = 1;
      if (input.up) {
        if (this.v < -0.6) brake = 1;
        else { this.reverse = false; }
      }
    }
    this.throttle += (throttle - this.throttle) * Math.min(1, 9 * dt);
    this.brake = brake;

    // gearbox
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    const kmh = spd * 3.6;
    if (!this.reverse) {
      const rpmIn = (g) => (kmh / GEAR_TOP[g - 1]) * RPM_MAX;
      if (this.gear < 8 && rpmIn(this.gear) > 11650 && this.shiftTimer <= 0) {
        this.gear++;
        this.shiftTimer = 0.09;
        this.events.push('up');
      } else if (this.gear > 1 && rpmIn(this.gear - 1) < 9900 && this.shiftTimer <= 0) {
        this.gear--;
        this.shiftTimer = 0.07;
        this.events.push('down');
      }
      const targetRpm = Math.max(RPM_IDLE + this.throttle * (spd < 1 ? 2500 : 0), Math.min(RPM_MAX + 200, rpmIn(this.gear)));
      this.rpm += (targetRpm - this.rpm) * Math.min(1, 18 * dt);
    } else {
      this.gear = 1;
      const targetRpm = RPM_IDLE + (kmh / 40) * 6000;
      this.rpm += (targetRpm - this.rpm) * Math.min(1, 10 * dt);
    }

    // longitudinal: power-limited drive, grip-limited launch, drag, brakes
    const dir = this.reverse ? -1 : 1;
    let a = 0;
    const P = 760000, m = 800;
    const shiftCut = (this.shiftTimer > 0 && !this.reverse ? 0.15 : 1) * (this.crashTimer > 0 ? 0.3 : 1);
    if (this.reverse) {
      a += dir * this.throttle * (spd * 3.6 < 35 ? 5 : 0);
    } else {
      const rpmShape = 0.82 + 0.18 * Math.sin(Math.min(1, this.rpm / RPM_MAX) * Math.PI * 0.9);
      a += this.throttle * Math.min(13.5, (P * rpmShape) / (m * Math.max(spd, 1))) * shiftCut;
    }
    const drag = 0.00104 * this.v * Math.abs(this.v);
    const roll = 0.18 * Math.sign(this.v);
    const engineBrake = this.throttle < 0.1 ? 1.4 * Math.sign(this.v) * Math.min(1, spd / 3) : 0;
    a -= drag + roll + engineBrake;
    a -= G * this.track.slopeAt(this.s) * Math.cos(this.psi); // ramps
    if (this.brake) a -= Math.sign(this.v) * Math.min(34, 6 + spd * 0.6);
    const vPrev = this.v;
    this.v += a * dt;
    if (vPrev !== 0 && Math.sign(this.v) !== Math.sign(vPrev) && !throttle) this.v = 0;
    if (Math.abs(this.v) < 0.05 && !throttle) this.v = 0;
    this.accel = (this.v - vPrev) / Math.max(dt, 1e-4);

    // lateral: kinematic bicycle with a lateral-g cap
    let yawRate = (this.v * Math.tan(this.steer)) / this.wheelbase;
    const latMax = 3.2 * G;
    const yawCap = latMax / Math.max(spd, 1);
    yawRate = Math.max(-yawCap, Math.min(yawCap, yawRate));
    this.latAcc = yawRate * this.v;

    // integrate in track frame
    this.prevS = this.s;
    const f = this.track.sample(this.s, this.frame);
    const denom = Math.max(0.2, 1 - f.k * this.d);
    const ds = (this.v * Math.cos(this.psi)) / denom;
    this.psi += (yawRate - f.k * ds) * dt;
    this.d += this.v * Math.sin(this.psi) * dt;
    this.s = this.track.wrap(this.s + ds * dt);
    this.odometer += Math.abs(ds) * dt;

    // Kerbs and walls. Light contact slides you along (scrape); hitting one faster than
    // CRASH_KMH into it bounces you off and costs most of your speed. The central median
    // is a wall too, except at its openings, where you can U-turn to the other side.
    const dMin = XS.median + this.halfWidth + 0.15;
    const dMax = XS.mainOuter - this.halfWidth - 0.15;
    this.scrape = Math.max(0, this.scrape - dt * 4);
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);
    this.crashTimer = Math.max(0, this.crashTimer - dt);
    const crashSpeed = CRASH_KMH / 3.6;
    const crashed = (kmh, wall) => this.registerCrash(kmh, wall);
    // side wall: mirror the heading off the wall (damped) and lose speed with the angle
    const bounceSide = (kmh, wall) => {
      const c = Math.cos(this.psi);
      this.v *= 0.25 + 0.35 * c * c;
      const target = Math.abs(this.psi) > Math.PI / 2 ? Math.sign(this.psi) * Math.PI : 0;
      this.psi = target - (this.psi - target) * 0.3;
      crashed(kmh, wall);
    };
    const scrape = () => {
      const into = Math.abs(Math.sin(this.psi));
      this.v *= 1 - Math.min(0.3, into * 1.5) * dt;
      // straighten up along the kerb, whichever way we're travelling
      const target = Math.abs(this.psi) > Math.PI / 2 ? Math.sign(this.psi) * Math.PI : 0;
      this.psi = target + (this.psi - target) * Math.max(0, 1 - 10 * dt);
      this.scrape = Math.min(1, this.scrape + into * 6 + spd * 0.004);
    };
    this.contactWall = 0; // which wall we're touching this step: +1 left, -1 right (road frame)
    const sideWall = (wall) => {
      this.contactWall = wall;
      const into = Math.abs(this.v * Math.sin(this.psi));
      if (into > crashSpeed && this.crashCooldown <= 0) bounceSide(into * 3.6, wall);
      else scrape();
    };

    // the end of a median opening is a wall across the road
    const step = this.track.step, n = this.track.n;
    const wasOpen = this.medianOpen;
    let open = this.track.gapMedian[Math.floor(this.s / step) % n] === 1;
    if (wasOpen && !open && Math.abs(this.d) < dMin - 0.3) {
      this.s = this.prevS;
      open = true;
      const into = Math.abs(this.v * Math.cos(this.psi));
      // nose into the kerb end: rebound backwards, or just stop if it was gentle
      if (into > crashSpeed && this.crashCooldown <= 0) { this.v *= -0.25; crashed(into * 3.6, 0); }
      else if (this.crashCooldown <= 0) this.v = 0;
    }
    this.medianOpen = open;
    if (this.medianOpen) this.side = this.d >= 0 ? 1 : -1;

    const lateral = this.v * Math.sin(this.psi);
    const lo = this.side > 0 && !this.medianOpen ? dMin : -dMax;
    const hi = this.side < 0 && !this.medianOpen ? -dMin : dMax;
    if (this.d > hi) { this.d = hi; if (lateral > 0) sideWall(1); }
    if (this.d < lo) { this.d = lo; if (lateral < 0) sideWall(-1); }
    while (this.psi > Math.PI) this.psi -= Math.PI * 2;
    while (this.psi < -Math.PI) this.psi += Math.PI * 2;
  }

  // Counts an impact (walls here, vehicles from traffic.js). wall: +1 left, -1 right, 0 nose.
  registerCrash(kmh, wall) {
    this.crashCount++;
    this.crashCooldown = 0.5;
    this.crashTimer = 0.6;
    this.lastCrash = { kmh, wall, s: this.s, d: this.d };
    this.scrape = 1;
  }

  // world position + yaw for rendering
  pose(outPos) {
    const f = this.track.sample(this.s, this.frame);
    outPos.set(f.x + f.nx * this.d, this.track.elevAt(this.s), f.z + f.nz * this.d);
    const c = Math.cos(this.psi), s = Math.sin(this.psi);
    const dx = f.tx * c + f.nx * s, dz = f.tz * c + f.nz * s;
    return Math.atan2(dx, dz);
  }
}
