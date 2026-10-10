import * as THREE from 'three';

// Procedural canvas textures, so the project ships with no image assets besides the car.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, renderer, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function speckle(ctx, w, h, r, count, colors, size = [0.5, 1.6]) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(r() * colors.length) | 0];
    const s = size[0] + r() * (size[1] - size[0]);
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

export function asphalt(renderer) {
  const [c, ctx] = canvas(512, 512);
  const r = rng(11);
  ctx.fillStyle = '#4a4a4c';
  ctx.fillRect(0, 0, 512, 512);
  // soft blotches (patch repairs, oil, wear)
  for (let i = 0; i < 70; i++) {
    const x = r() * 512, y = r() * 512, rad = 20 + r() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.6;
    g.addColorStop(0, dark ? 'rgba(30,30,32,0.18)' : 'rgba(110,108,104,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  speckle(ctx, 512, 512, r, 60000, ['#2e2e30', '#38383a', '#5b5a58', '#66645f', '#424244', '#76736c']);
  // a few hairline cracks
  ctx.strokeStyle = 'rgba(20,20,20,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    let x = r() * 512, y = r() * 512;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 10; k++) { x += (r() - 0.5) * 30; y += r() * 18; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return finish(c, renderer);
}

export function asphaltRough(renderer) {
  const [c, ctx] = canvas(256, 256);
  const r = rng(12);
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, r, 14000, ['#b0b0b0', '#ffffff', '#c4c4c4', '#9a9a9a']);
  return finish(c, renderer, { srgb: false });
}

export function grass(renderer) {
  const [c, ctx] = canvas(512, 512);
  const r = rng(21);
  ctx.fillStyle = '#5f7a3a';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 120; i++) {
    const x = r() * 512, y = r() * 512, rad = 15 + r() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const pick = ['rgba(120,110,60,0.25)', 'rgba(60,90,35,0.3)', 'rgba(140,150,80,0.2)', 'rgba(90,75,50,0.2)'][(r() * 4) | 0];
    g.addColorStop(0, pick);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 26000; i++) {
    const x = r() * 512, y = r() * 512;
    ctx.strokeStyle = ['#4d6a2c', '#6e8a42', '#83994e', '#3f5a24', '#7a7a45'][(r() * 5) | 0];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
    ctx.stroke();
  }
  return finish(c, renderer);
}

export function paving(renderer) {
  const [c, ctx] = canvas(256, 256);
  const r = rng(31);
  ctx.fillStyle = '#8d8a84';
  ctx.fillRect(0, 0, 256, 256);
  const n = 8, s = 256 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 140 + r() * 40 | 0;
    ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
    ctx.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
  }
  speckle(ctx, 256, 256, r, 5000, ['rgba(60,60,60,0.25)', 'rgba(255,255,255,0.15)']);
  return finish(c, renderer);
}

export function concrete(renderer) {
  const [c, ctx] = canvas(256, 256);
  const r = rng(41);
  ctx.fillStyle = '#b9b5ac';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, r, 9000, ['#a7a39a', '#c8c4bb', '#9a968d', '#d2cec6']);
  return finish(c, renderer);
}

// Black/white painted curb stripes, as on Indonesian road medians.
export function curbStripes(renderer) {
  const [c, ctx] = canvas(256, 32);
  const r = rng(51);
  ctx.fillStyle = '#e9e6de';
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = '#1d1d1d';
  ctx.fillRect(128, 0, 128, 32);
  speckle(ctx, 256, 32, r, 1500, ['rgba(80,70,60,0.25)', 'rgba(255,255,255,0.12)']);
  return finish(c, renderer);
}

// Large-scale tint variation for the ground (fields, dry patches, villages).
export function groundMacro(renderer) {
  const [c, ctx] = canvas(512, 512);
  const r = rng(81);
  ctx.fillStyle = '#c9c9c9';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const x = r() * 512, y = r() * 512, w = 4 + r() * 22, h = 4 + r() * 22;
    const t = r();
    ctx.fillStyle = t < 0.35 ? 'rgba(150,190,90,0.5)' : t < 0.6 ? 'rgba(190,170,120,0.45)' : t < 0.8 ? 'rgba(90,120,60,0.45)' : 'rgba(230,230,210,0.35)';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r() * Math.PI);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  return finish(c, renderer);
}

// Soft dark blob used as a contact shadow under the car.
export function blobShadow(renderer) {
  const [c, ctx] = canvas(128, 256);
  const g = ctx.createRadialGradient(64, 128, 10, 64, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.scale(1, 1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 256);
  ctx.restore();
  return finish(c, renderer, { repeat: false });
}

// Green Indonesian direction sign.
export function roadSign(renderer, title, subtitle) {
  const [c, ctx] = canvas(1024, 330);
  ctx.fillStyle = '#0d6a3b';
  ctx.fillRect(0, 0, 1024, 330);
  ctx.strokeStyle = '#f4f4f0';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 996, 302);
  ctx.fillStyle = '#f4f4f0';
  ctx.font = '600 92px "Titillium Web", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 170, 128);
  ctx.font = '400 58px "Titillium Web", Arial, sans-serif';
  ctx.fillText(subtitle, 172, 232);
  // left-turn arrow (traffic keeps left)
  ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(110, 270);
  ctx.lineTo(110, 130);
  ctx.lineTo(60, 130);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(78, 100);
  ctx.lineTo(48, 130);
  ctx.lineTo(78, 160);
  ctx.stroke();
  return finish(c, renderer, { repeat: false });
}

// Clustered leaves on transparent background, used on crown cards.
export function leaves(renderer) {
  const [c, ctx] = canvas(256, 256);
  const r = rng(91);
  ctx.clearRect(0, 0, 256, 256);
  const greens = ['#2f5520', '#3c6a27', '#4a7a2e', '#5b8c35', '#365f22', '#6d9a3e', '#29481b'];
  for (let i = 0; i < 520; i++) {
    // keep the cluster roughly round so card edges never show
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 108;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r() * Math.PI * 2);
    ctx.fillStyle = greens[(r() * greens.length) | 0];
    ctx.beginPath();
    const L = 7 + r() * 9, Wd = 3 + r() * 3;
    ctx.ellipse(0, 0, L, Wd, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,220,0.12)';
    ctx.beginPath();
    ctx.ellipse(-1, -1, L * 0.6, Wd * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return finish(c, renderer, { repeat: false });
}

// Ballast with one timber sleeper per tile (tile = 0.65 m of track).
export function railBed(renderer) {
  const [c, ctx] = canvas(128, 64);
  const r = rng(101);
  ctx.fillStyle = '#7a7268';
  ctx.fillRect(0, 0, 128, 64);
  speckle(ctx, 128, 64, r, 2600, ['#5d564e', '#8f877c', '#6b645b', '#a39a8e', '#4e4842'], [1, 2.5]);
  ctx.fillStyle = '#4a3a2c';
  ctx.fillRect(16, 22, 96, 20);
  speckle(ctx, 128, 64, r, 300, ['rgba(0,0,0,0.25)', 'rgba(255,230,200,0.08)'], [1, 2]);
  // rust stain under the rails
  ctx.fillStyle = 'rgba(110,60,30,0.35)';
  ctx.fillRect(36, 0, 6, 64);
  ctx.fillRect(86, 0, 6, 64);
  return finish(c, renderer);
}

// Blue mandatory-direction disc with a U-turn arrow (turning right, as traffic keeps left).
export function uturnSign(renderer) {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#f4f4f0';
  ctx.beginPath();
  ctx.arc(128, 128, 126, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f55c4';
  ctx.beginPath();
  ctx.arc(128, 128, 114, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(88, 196);
  ctx.lineTo(88, 110);
  ctx.arc(128, 110, 40, Math.PI, 0);
  ctx.lineTo(168, 150);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(140, 146);
  ctx.lineTo(196, 146);
  ctx.lineTo(168, 196);
  ctx.closePath();
  ctx.fill();
  return finish(c, renderer, { repeat: false });
}

// Yellow/black hazard bands for median-end bollards.
export function hazardBands(renderer) {
  const [c, ctx] = canvas(32, 128);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#141414' : '#f2c21b';
    ctx.fillRect(0, i * 16, 32, 16);
  }
  return finish(c, renderer, { repeat: false });
}

// Soft round glow: white core fading to transparent. Used for lamp halos and light pools.
export function glow(renderer, core = 0.12) {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(core, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(c, renderer, { repeat: false });
}
