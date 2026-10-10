import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Track, buildWorld } from './track.js';
import { loadCarModel, CarPhysics } from './car.js';
import { EngineAudio } from './audio.js';
import { Hud } from './hud.js';
import { Traffic } from './traffic.js';
import { blobShadow } from './textures.js';

const $ = (id) => document.getElementById(id);
const setProgress = (p, label) => {
  $('load-bar').style.transform = `scaleX(${p})`;
  if (label) $('load-label').textContent = label;
};

// --- renderer / scene ------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.7;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 90000);

// golden-hour sun from the west-south-west
const sunElevation = 13, sunAzimuth = 248;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sunElevation), THREE.MathUtils.degToRad(sunAzimuth));

const sky = new Sky();
sky.scale.setScalar(80000);
const su = sky.material.uniforms;
su.turbidity.value = 5;
su.rayleigh.value = 2.3;
su.mieCoefficient.value = 0.006;
su.mieDirectionalG.value = 0.86;
su.sunPosition.value.copy(sunDir);
scene.add(sky);

// image-based lighting from the same sky
const env = { day: null, night: null };
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  Object.assign(envSky.material.uniforms, THREE.UniformsUtils.clone(sky.material.uniforms));
  envSky.material.uniforms.sunPosition.value.copy(sunDir);
  envScene.add(envSky);
  // a dull ground half so reflections aren't all sky
  const g = new THREE.Mesh(new THREE.CircleGeometry(900, 32), new THREE.MeshBasicMaterial({ color: 0x3a3a34 }));
  g.rotation.x = -Math.PI / 2;
  g.position.y = -5;
  envScene.add(g);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 2000).texture;
  scene.environmentIntensity = 0.7;
  env.day = scene.environment;
  // night reflections: dark sky, a band of warm city glow near the horizon, a few lamp-like spots
  const nightScene = new THREE.Scene();
  nightScene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), new THREE.MeshBasicMaterial({ color: 0x05070c, side: THREE.BackSide })));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(480, 480, 60, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x2a2018, side: THREE.BackSide }));
  band.position.y = 20;
  nightScene.add(band);
  for (let i = 0; i < 10; i++) {
    const spot = new THREE.Mesh(new THREE.SphereGeometry(14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc37a }));
    const a = (i / 10) * Math.PI * 2;
    spot.position.set(Math.cos(a) * 300, 90 + (i % 3) * 30, Math.sin(a) * 300);
    nightScene.add(spot);
  }
  env.night = pmrem.fromScene(nightScene, 0, 0.1, 2000).texture;
}

scene.fog = new THREE.FogExp2(0xcdbfa8, 0.00028);

const sun = new THREE.DirectionalLight(0xffd6a6, 4.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 900;
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xc4d6ff, 0x6a5a40, 0.75);
scene.add(hemi);

// night sky: dark dome with a faint city glow at the horizon, plus stars
const nightSky = new THREE.Mesh(new THREE.SphereGeometry(42000, 32, 16), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
{
  const p = nightSky.geometry.attributes.position, c = new Float32Array(p.count * 3);
  const top = new THREE.Color(0x04060b), mid = new THREE.Color(0x0d1220), glow = new THREE.Color(0x3a2a22), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const h = Math.max(0, p.getY(i) / 42000);
    if (h < 0.12) col.copy(glow).lerp(mid, h / 0.12); else col.copy(mid).lerp(top, Math.min(1, (h - 0.12) / 0.5));
    c.set([col.r, col.g, col.b], i * 3);
  }
  nightSky.geometry.setAttribute('color', new THREE.BufferAttribute(c, 3));
}
const stars = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
{
  const sp = [];
  for (let i = 0; i < 1400; i++) {
    const a = Math.random() * Math.PI * 2, y = 0.08 + Math.random() * 0.92, r = Math.sqrt(1 - y * y);
    sp.push(Math.cos(a) * r * 40000, y * 40000, Math.sin(a) * r * 40000);
  }
  stars.geometry.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
}
nightSky.visible = stars.visible = false;
nightSky.frustumCulled = stars.frustumCulled = false;
scene.add(nightSky, stars);
const moonDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(38), THREE.MathUtils.degToRad(120));
let lightDir = sunDir;

// --- world -----------------------------------------------------------------
setProgress(0.05, 'Loading Ring Road…');
const trackData = await fetch('assets/track.json').then((r) => r.json());
const track = new Track(trackData);
setProgress(0.12, 'Building Yogyakarta…');
await new Promise((r) => requestAnimationFrame(r));
const buildings = await fetch('assets/buildings.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
const world = buildWorld(track, renderer, scene, buildings);

setProgress(0.2, 'Rolling out the RB22…');
const car = await loadCarModel('assets/car/scene.gltf', (p) => setProgress(0.2 + p * 0.75));
const carGroup = new THREE.Group();
carGroup.add(car.root);
scene.add(carGroup);

const blob = new THREE.Mesh(
  new THREE.PlaneGeometry(car.info.width * 1.25, car.info.length * 1.08),
  new THREE.MeshBasicMaterial({ map: blobShadow(renderer), transparent: true, depthWrite: false, opacity: 0.85 }),
);
blob.rotation.x = -Math.PI / 2;
blob.position.y = 0.02;
blob.renderOrder = 1;
carGroup.add(blob);

const physics = new CarPhysics(track, car.info);
const hud = new Hud(track);
hud.resize();
const audio = new EngineAudio();
const traffic = new Traffic(track, scene, world.signals);
hud.traffic = traffic;

// --- night mode: the three nearest street lamps light the car, plus headlights
const lampLights = [0, 1, 2].map(() => {
  const l = new THREE.PointLight(0xffc37a, 0, 70, 2);
  scene.add(l);
  return l;
});
const headlight = new THREE.SpotLight(0xfff1d6, 0, 160, 0.5, 0.8, 1.7);
headlight.position.set(0, 0.7, 2.4);
headlight.target.position.set(0, 0.2, 40);
carGroup.add(headlight, headlight.target);
const carGlows = [[0.42, 0.42, 2.72, 0xfff1d6, 0.9], [-0.42, 0.42, 2.72, 0xfff1d6, 0.9], [0, 0.62, -2.62, 0xff2a1a, 0.8]].map(([x, y, z, color, size]) => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: world.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sp.position.set(x, y, z);
  sp.scale.setScalar(size);
  sp.visible = false;
  carGroup.add(sp);
  return sp;
});
let night = false;
function setNight(on) {
  night = on;
  sky.visible = !on;
  nightSky.visible = stars.visible = on;
  scene.environment = on ? env.night : env.day;
  scene.environmentIntensity = on ? 0.5 : 0.7;
  scene.fog.color.setHex(on ? 0x10131c : 0xcdbfa8);
  scene.fog.density = on ? 0.00036 : 0.00028;
  lightDir = on ? moonDir : sunDir;
  sun.color.setHex(on ? 0x8fa6d6 : 0xffd6a6);
  sun.intensity = on ? 0.3 : 4.2;
  hemi.color.setHex(on ? 0x2b3a58 : 0xc4d6ff);
  hemi.groundColor.setHex(on ? 0x17130f : 0x6a5a40);
  hemi.intensity = on ? 0.22 : 0.75;
  renderer.toneMappingExposure = on ? 1.0 : 0.7;
  for (const l of lampLights) l.intensity = on ? 170 : 0;
  headlight.intensity = on ? 520 : 0;
  for (const g of carGlows) g.visible = on;
  world.setNight(on);
  traffic.setNight(on, world.glowTex);
  $('night').textContent = on ? 'Night' : 'Day';
  try { localStorage.setItem('rr-night', on ? '1' : '0'); } catch { /* private mode */ }
}
// lamps are stored in order along the road, so the nearest ones are found by arc length
function placeLampLights(s) {
  const L = world.lamps, n = L.length;
  if (!n) return;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (L[mid].s < s) lo = mid + 1; else hi = mid; }
  lampLights.forEach((light, k) => {
    const l = L[(lo - 1 + k + n) % n];
    light.position.set(l.x, l.y + 9.4, l.z);
  });
}

// --- input -----------------------------------------------------------------
const input = { up: false, down: false, left: false, right: false };
const keymap = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
let camMode = 'chase';
let started = false;
const begin = () => {
  audio.start();
  if (!started) {
    started = true;
    $('intro').classList.add('hidden');
  }
};
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey) return;
  begin();
  const k = keymap[e.code];
  if (k) { input[k] = true; e.preventDefault(); }
  if (e.code === 'KeyC' || e.code === 'KeyV') camMode = camMode === 'chase' ? 'cockpit' : 'chase';
  if (e.code === 'KeyN') setNight(!night);
  if (e.code === 'KeyM') { audio.setMuted(!audio.muted); $('mute').textContent = audio.muted ? 'Muted' : 'Sound'; }
});
window.addEventListener('keyup', (e) => {
  const k = keymap[e.code];
  if (k) input[k] = false;
});
window.addEventListener('blur', () => { for (const k in input) input[k] = false; });
window.addEventListener('pointerdown', begin);

// Keep the canvas matched to the window. Checked every frame as well as on resize,
// because a tab that loads while hidden reports a 0x0 window and never fires 'resize'.
let viewW = 0, viewH = 0;
function fitView() {
  if (innerWidth === viewW && innerHeight === viewH) return;
  viewW = innerWidth; viewH = innerHeight;
  if (!viewW || !viewH) return;
  camera.aspect = viewW / viewH;
  camera.updateProjectionMatrix();
  renderer.setSize(viewW, viewH);
  hud.resize();
}
window.addEventListener('resize', fitView);

// --- loop ------------------------------------------------------------------
// --- crash sparks and carbon debris
function particles(count, material) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) pos[i * 3 + 1] = -1000;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, material);
  pts.frustumCulled = false;
  scene.add(pts);
  return { pos, vel: new Float32Array(count * 3), life: new Float32Array(count), geo, head: 0, count };
}
const sparks = particles(240, new THREE.PointsMaterial({ color: 0xffb347, size: 0.09, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
const debris = particles(80, new THREE.PointsMaterial({ color: 0x1c1d20, size: 0.07 }));
// burst at a contact point: away from the wall (wx, wz), carried along the car's travel (fx, fz)
function emit(sys, n, x, y, z, wx, wz, fx, fz, carry, power, life) {
  for (let k = 0; k < n; k++) {
    const i = sys.head++ % sys.count;
    sys.pos.set([x + (Math.random() - 0.5) * 0.6, y + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.6], i * 3);
    const out = 1 + Math.random() * power, fw = carry * (0.4 + Math.random() * 0.6);
    sys.vel.set([-wx * out + fx * fw + (Math.random() - 0.5) * power, 0.8 + Math.random() * power * 0.8, -wz * out + fz * fw + (Math.random() - 0.5) * power], i * 3);
    sys.life[i] = life * (0.5 + Math.random());
  }
}
function stepParticles(sys, dt) {
  const { pos, vel, life } = sys;
  for (let i = 0; i < sys.count; i++) {
    if (life[i] <= 0) continue;
    life[i] -= dt;
    const j = i * 3;
    vel[j + 1] -= 9.8 * dt;
    pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
    const floor = track.elevAt(physics.s) + 0.02;
    if (pos[j + 1] < floor) { pos[j + 1] = floor; vel[j + 1] *= -0.3; vel[j] *= 0.6; vel[j + 2] *= 0.6; }
    if (life[i] <= 0) pos[j + 1] = -1000;
  }
  sys.geo.attributes.position.needsUpdate = true;
}
let shake = 0;
let seenCrashes = 0;
const wallFrame = {};

const clock = new THREE.Clock();
const carPos = new THREE.Vector3();
let camYaw = null;
const camTarget = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const tmp = new THREE.Vector3();
const swRest = car.steeringWheel.rotation.clone();
let wheelSpin = 0;
let elapsed = 0;

// "right above the driver's head": a touch behind and above the steering wheel
const cockpitEye = new THREE.Vector3(0, car.info.cockpit.y + 0.52, car.info.cockpit.z - 0.62);

function frame() {
  fitView();
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;
  const steps = 4;
  let touching = 0;
  for (let i = 0; i < steps; i++) { physics.update(dt / steps, input); touching ||= physics.contactWall; }
  // traffic moves, obeys the signals, and may bump into (or be hit by) the player
  world.signals.update(elapsed);
  traffic.update(dt, elapsed, physics);
  touching ||= traffic.touching;
  if (traffic.honkNow) { traffic.honkNow = false; audio.honk(); }

  const yaw = physics.pose(carPos);
  carGroup.position.copy(carPos);
  const grade = track.slopeAt(physics.s) * Math.cos(physics.psi);
  carGroup.rotation.set(-Math.atan(grade), yaw, 0, 'YXZ');
  const spd = Math.abs(physics.v);

  // body attitude: squat under power, dive under braking, a hint of roll
  const pitch = THREE.MathUtils.clamp(-physics.accel * 0.0011, -0.03, 0.02);
  const roll = THREE.MathUtils.clamp(physics.latAcc * 0.00045, -0.015, 0.015);
  car.body.rotation.x += (pitch - car.body.rotation.x) * Math.min(1, dt * 8);
  car.body.rotation.z += (roll - car.body.rotation.z) * Math.min(1, dt * 8);
  car.body.position.y = Math.sin(elapsed * 38) * 0.0015 * Math.min(1, spd / 40);

  wheelSpin += (physics.v / car.wheels.FL.radius) * dt;
  for (const k in car.wheels) {
    const w = car.wheels[k];
    w.spin.rotation.x = wheelSpin;
    if (k[0] === 'F') w.steer.rotation.y = physics.steer;
  }
  car.steeringWheel.rotation.set(swRest.x, swRest.y, swRest.z - physics.steer * 3.2);

  // cameras
  if (camYaw === null) camYaw = yaw;
  let dy = yaw - camYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  camYaw += dy * Math.min(1, dt * 5);

  if (camMode === 'chase') {
    car.body.visible = true;
    const dist = 6.4 + spd * 0.012;
    const yBehind = Math.max(carPos.y, track.elevAt(physics.s - dist));
    camTarget.set(carPos.x - Math.sin(camYaw) * dist, yBehind + 1.75 + spd * 0.003, carPos.z - Math.cos(camYaw) * dist);
    camera.position.lerp(camTarget, Math.min(1, dt * 14));
    lookTarget.set(carPos.x + Math.sin(camYaw) * 5, track.elevAt(physics.s + 5) + 0.85, carPos.z + Math.cos(camYaw) * 5);
    camera.lookAt(lookTarget);
    camera.fov = 56 + Math.min(1, spd / 90) * 14;
  } else {
    carGroup.updateMatrixWorld(true);
    camera.position.copy(cockpitEye);
    car.body.localToWorld(camera.position);
    camera.position.y += Math.sin(elapsed * 47) * 0.0025 * Math.min(1, spd / 60);
    tmp.set(0, cockpitEye.y - 0.55, cockpitEye.z + 25);
    car.body.localToWorld(tmp);
    camera.lookAt(tmp);
    camera.fov = 70 + Math.min(1, spd / 90) * 8;
  }
  // in chase view, frame the car a little higher so the bottom gauge doesn't cover it
  if (camMode === 'chase') camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.14, innerWidth, innerHeight);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();

  // crashes and scrapes: sparks at the contact point, debris, shake, flash, crunch
  {
    const f = track.sample(physics.s, wallFrame);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const sv = Math.abs(physics.v) * Math.sign(physics.v);
    if (physics.crashCount !== seenCrashes) {
      seenCrashes = physics.crashCount;
      const c = physics.lastCrash;
      const k = Math.min(1, c.kmh / 120);
      // side hits spark on that side; a hit on the end of a median opening sparks at the nose
      const wx = c.wall ? f.nx * c.wall : fx, wz = c.wall ? f.nz * c.wall : fz;
      const px = carPos.x + wx * 1.0, pz = carPos.z + wz * 1.0;
      emit(sparks, 60 + 80 * k, px, carPos.y + 0.3, pz, wx, wz, fx, fz, sv * 0.4, 4 + 6 * k, 0.7);
      emit(debris, 20 + 30 * k, px, carPos.y + 0.4, pz, wx, wz, fx, fz, sv * 0.3, 3 + 4 * k, 1.4);
      shake = Math.min(1, 0.35 + c.kmh / 150);
      audio.crash(c.kmh);
      const fl = $('crash-flash');
      fl.classList.remove('on');
      void fl.offsetWidth;
      fl.classList.add('on');
    } else if (touching && spd > 12) {
      const wx = f.nx * touching, wz = f.nz * touching;
      emit(sparks, Math.min(6, 1 + spd / 15), carPos.x + wx * 0.95, carPos.y + 0.12, carPos.z + wz * 0.95, wx, wz, fx, fz, sv * 0.6, 1.5, 0.35);
    }
    stepParticles(sparks, dt);
    stepParticles(debris, dt);
    if (shake > 0.002) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.45;
      camera.position.y += (Math.random() - 0.5) * shake * 0.3;
      camera.position.z += (Math.random() - 0.5) * shake * 0.45;
      camera.rotation.z += (Math.random() - 0.5) * shake * 0.05;
      shake *= Math.exp(-dt * 5);
    }
  }

  if (night) placeLampLights(physics.s);

  // shadows follow the car
  sun.position.copy(carPos).addScaledVector(lightDir, 400);
  sun.target.position.copy(carPos);

  // distance-cull scenery chunks
  for (const c of world.chunks) {
    const dx = c.userData.center.x - camera.position.x, dz = c.userData.center.z - camera.position.z;
    c.visible = dx * dx + dz * dz < 4600 * 4600;
  }

  audio.cockpit = camMode === 'cockpit';
  // trench walls (and the slab overhead) throw the engine note back
  audio.echo = Math.max(0, Math.min(1, -carPos.y / 5));
  audio.update(dt, physics);
  hud.update(physics, carPos, yaw, camMode);
  renderer.render(scene, window.__rr.viewCam || camera); // viewCam: optional debug camera
  requestAnimationFrame(frame);
}

try { if (localStorage.getItem('rr-night') === '1') setNight(true); } catch { /* private mode */ }
setProgress(1, 'Ready');
$('loader').classList.add('hidden');
$('intro').classList.remove('hidden');
requestAnimationFrame(frame);
window.__rr = { physics, camera, car, track, renderer, audio, input, THREE, traffic, world };
