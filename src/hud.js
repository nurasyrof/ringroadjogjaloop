// Bottom HUD, styled after the 2026 broadcast onboard graphic: a round speed dial
// with an rpm ring, segmented brake/throttle arcs, a location card and a minimap.

const NS = 'http://www.w3.org/2000/svg';
const CX = 250, CY = 150;
const SEGS = 10;
const rad = (a) => (a * Math.PI) / 180;
const polar = (r, a) => [CX + r * Math.cos(rad(a)), CY + r * Math.sin(rad(a))];
// SVG angles: 0 deg = right, positive = clockwise on screen
function arc(r, a0, a1) {
  const [x0, y0] = polar(r, a0), [x1, y1] = polar(r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function sector(r0, r1, a0, a1) {
  const [ax, ay] = polar(r1, a0), [bx, by] = polar(r1, a1), [cx, cy] = polar(r0, a1), [dx, dy] = polar(r0, a0);
  const sw = a1 > a0 ? 1 : 0;
  return `M${ax} ${ay} A${r1} ${r1} 0 0 ${sw} ${bx} ${by} L${cx} ${cy} A${r0} ${r0} 0 0 ${1 - sw} ${dx} ${dy} Z`;
}
const mix = (c0, c1, t) => `rgb(${c0.map((v, i) => Math.round(v + (c1[i] - v) * t)).join(',')})`;

function buildGauge(root) {
  const segs = (from, to, c0, c1) => {
    const step = (to - from) / SEGS, gap = Math.sign(step) * 1.6;
    return Array.from({ length: SEGS }, (_, i) => {
      const a0 = from + step * i + gap / 2, a1 = from + step * (i + 1) - gap / 2;
      return `<path class="g-seg" data-on="${mix(c0, c1, i / (SEGS - 1))}" d="${sector(107, 127 - i * 0.4, a0, a1)}"/>`;
    }).join('');
  };
  root.innerHTML = `
  <svg viewBox="0 0 500 278" xmlns="${NS}" aria-hidden="true">
    <defs>
      <radialGradient id="g-dial" cx="50%" cy="40%" r="60%">
        <stop offset="0" stop-color="#0d2238" stop-opacity="0.94"/>
        <stop offset="1" stop-color="#040b14" stop-opacity="0.94"/>
      </radialGradient>
      <linearGradient id="g-rpm" x1="${CX - 97}" x2="${CX + 97}" y1="0" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#49c6ff"/>
        <stop offset="0.55" stop-color="#4ff0c4"/>
        <stop offset="0.82" stop-color="#ffd34a"/>
        <stop offset="1" stop-color="#ff3b4f"/>
      </linearGradient>
      <filter id="g-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <path d="${arc(142, 160, 250)}" fill="none" stroke="rgba(120,200,255,0.22)" stroke-width="1.2"/>
    <path d="${arc(142, 20, -70)}" fill="none" stroke="rgba(120,200,255,0.22)" stroke-width="1.2"/>
    <g id="g-brake">${segs(148, 232, [255, 160, 90], [255, 59, 79])}</g>
    <g id="g-throttle">${segs(32, -52, [62, 224, 143], [170, 255, 110])}</g>
    <text class="g-cap" x="${CX - 120}" y="${CY + 104}" text-anchor="middle">BRAKE</text>
    <text class="g-cap" x="${CX + 120}" y="${CY + 104}" text-anchor="middle">THROTTLE</text>
    <g>
      <text class="g-mph" id="g-rpmnum" x="${CX - 150}" y="${CY - 92}" text-anchor="end">4.2</text>
      <text class="g-cap" x="${CX - 150}" y="${CY - 78}" text-anchor="end" style="font-size:9px">RPM ×1000</text>
    </g>
    <g id="aero">
      <path d="M${CX + 152} ${CY - 106} l8 -6 l8 6 M${CX + 152} ${CY - 98} l8 -6 l8 6" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${CX + 174}" y="${CY - 102}">ACTIVE</text>
      <text x="${CX + 174}" y="${CY - 90}">AERO</text>
    </g>
    <circle cx="${CX}" cy="${CY}" r="104" fill="none" stroke="rgba(120,200,255,0.12)"/>
    <path d="${arc(97, 135, 405)}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="7" stroke-linecap="round"/>
    <path id="rpm-arc" d="${arc(97, 135, 405)}" pathLength="100" fill="none" stroke="url(#g-rpm)" stroke-width="7" stroke-linecap="round" stroke-dasharray="0 100" filter="url(#g-glow)"/>
    <circle cx="${CX}" cy="${CY}" r="88" fill="url(#g-dial)" stroke="rgba(73,198,255,0.6)" stroke-width="1.5"/>
    <text class="g-cap" x="${CX}" y="${CY - 50}" text-anchor="middle">KM/H</text>
    <text class="g-speed" id="g-speed" x="${CX}" y="${CY + 10}" text-anchor="middle">0</text>
    <g class="g-pill" id="pill-boost"><rect x="${CX - 62}" y="${CY + 19}" width="59" height="15" rx="3"/><text x="${CX - 32.5}" y="${CY + 30}" text-anchor="middle">BOOST</text></g>
    <g class="g-pill" id="pill-uturn"><rect x="${CX + 3}" y="${CY + 19}" width="59" height="15" rx="3"/><text x="${CX + 32.5}" y="${CY + 30}" text-anchor="middle">U-TURN</text></g>
    <text class="g-mph" id="g-mph" x="${CX}" y="${CY + 58}" text-anchor="middle">0</text>
    <text class="g-cap" x="${CX}" y="${CY + 71}" text-anchor="middle" style="font-size:9px">MPH</text>
    <rect x="${CX - 28}" y="${CY + 82}" width="56" height="40" rx="8" fill="#0a1d31" stroke="rgba(73,198,255,0.85)" stroke-width="1.5"/>
    <text class="g-cap" x="${CX}" y="${CY + 94}" text-anchor="middle" style="font-size:8px;letter-spacing:1.6px">GEAR</text>
    <text class="g-gear" id="g-gear" x="${CX}" y="${CY + 117}" text-anchor="middle">N</text>
  </svg>`;
  const q = (sel) => root.querySelector(sel);
  return {
    speed: q('#g-speed'), mph: q('#g-mph'), gear: q('#g-gear'), rpm: q('#rpm-arc'), rpmNum: q('#g-rpmnum'),
    boost: q('#pill-boost'), uturn: q('#pill-uturn'), aero: q('#aero'),
    brake: [...root.querySelectorAll('#g-brake path')], throttle: [...root.querySelectorAll('#g-throttle path')],
  };
}

export class Hud {
  constructor(track) {
    this.track = track;
    this.el = {
      road: document.getElementById('road-name'),
      section: document.getElementById('road-section'),
      nextDist: document.getElementById('next-dist'),
      nextName: document.getElementById('next-name'),
      odo: document.getElementById('odo'),
      lap: document.getElementById('lap'),
      cam: document.getElementById('cam-mode'),
      map: document.getElementById('minimap'),
      toast: document.getElementById('toast'),
      overview: document.getElementById('overview'),
      dir: document.getElementById('direction'),
      crashes: document.getElementById('crashes'),
      nextUturn: document.getElementById('next-uturn'),
    };
    this.g = buildGauge(document.getElementById('gauge'));
    this.ctx = this.el.map.getContext('2d');
    this.lastLabel = null;
    this.lastGear = '';
    this.lit = { brake: -1, throttle: -1 };
    this.brakeVis = 0;
    this.prepareRoads();
  }

  prepareRoads() {
    const t = this.track;
    this.ring = new Path2D();
    for (let i = 0; i <= t.n; i += 3) {
      const k = i % t.n;
      if (i === 0) this.ring.moveTo(t.px[k], t.pz[k]);
      else this.ring.lineTo(t.px[k], t.pz[k]);
    }
    this.ring.closePath();
    // U-turn openings sit on the centreline; signals at their real positions
    this.uturnPts = t.openings.filter((o) => t.featAt[o.idx] < 0).map((o) => [t.px[o.idx], t.pz[o.idx]]);
    this.signalPts = (t.data.signals || []).map(([, , x, z]) => [x, z]);
    this.major = new Path2D();
    this.minor = new Path2D();
    this.rail = new Path2D();
    for (const r of t.data.rails || []) r.forEach(([x, z], i) => (i ? this.rail.lineTo(x, z) : this.rail.moveTo(x, z)));
    for (const r of t.data.roads) {
      const p = r.h === 'trunk' ? this.major : this.minor;
      r.p.forEach(([x, z], i) => (i ? p.lineTo(x, z) : p.moveTo(x, z)));
    }
  }

  resize() {
    const c = this.el.map;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    this.dpr = dpr;
  }

  toast(text) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
  }

  setSegments(list, key, value) {
    const n = Math.round(Math.max(0, Math.min(1, value)) * list.length);
    if (n === this.lit[key]) return;
    this.lit[key] = n;
    list.forEach((p, i) => { p.style.fill = i < n ? p.dataset.on : ''; });
  }

  update(car, pos, yaw, camMode) {
    const g = this.g;
    const kmh = Math.round(car.kmh);
    g.speed.textContent = kmh;
    g.mph.textContent = Math.round(kmh * 0.621371);
    const gear = car.gearLabel();
    if (gear !== this.lastGear) {
      g.gear.textContent = gear;
      g.gear.classList.remove('pop');
      void g.gear.getBBox();
      g.gear.classList.add('pop');
      this.lastGear = gear;
    }
    const r = Math.max(0, Math.min(1, (car.rpm - 4000) / 8000));
    g.rpm.setAttribute('stroke-dasharray', `${(r * 100).toFixed(1)} 100`);
    g.rpm.classList.toggle('limit', car.rpm > 11500);
    g.rpmNum.textContent = (car.rpm / 1000).toFixed(1);
    this.brakeVis += ((car.brake ? 1 : 0) - this.brakeVis) * 0.35;
    this.setSegments(g.brake, 'brake', this.brakeVis);
    this.setSegments(g.throttle, 'throttle', car.throttle);
    g.boost.classList.toggle('on', !car.reverse && car.throttle > 0.9 && car.rpm > 9500);
    g.uturn.classList.toggle('on', car.medianOpen);
    // 2026 cars flatten their wings on straights: show it when flat out and pointing straight
    g.aero.classList.toggle('on', kmh > 180 && car.throttle > 0.85 && Math.abs(car.steer) < 0.03);

    const t = this.track;
    const idx = Math.floor(car.s / t.step) % t.n;
    const lab = t.labelAt[idx];
    if (lab && lab !== this.lastLabel) {
      this.el.road.textContent = lab.name;
      this.el.section.textContent = lab.sec;
      if (this.lastLabel && this.lastLabel.name !== lab.name) this.toast(`${lab.name} · ${lab.sec}`);
      this.lastLabel = lab;
    }
    const feat = t.featureAt(car.s);
    if (feat !== this.lastFeature) {
      if (feat) this.toast(feat.name);
      this.lastFeature = feat;
    }
    let next = null, best = Infinity;
    // travelling the inner carriageway means s counts down
    const forward = Math.cos(car.psi) * (car.v >= 0 ? 1 : -1) >= 0;
    for (const j of t.junctions) {
      const ahead = forward ? t.wrap(j.s - car.s) : t.wrap(car.s - j.s);
      if (ahead > 15 && ahead < best) { best = ahead; next = j; }
    }
    this.el.nextDist.textContent = next ? (best > 950 ? (best / 1000).toFixed(1) + ' km' : Math.round(best / 10) * 10 + ' m') : '–';
    this.el.nextName.textContent = next ? next.name : '';
    let uBest = Infinity;
    for (const o of t.openings) {
      if (t.featAt[o.idx] >= 0) continue;
      const ahead = forward ? t.wrap(o.s - car.s) : t.wrap(car.s - o.s);
      if (ahead > 10 && ahead < uBest) uBest = ahead;
    }
    this.el.nextUturn.textContent = car.medianOpen ? 'U-turn here' : uBest < Infinity
      ? `U-turn in ${uBest > 950 ? (uBest / 1000).toFixed(1) + ' km' : Math.round(uBest / 10) * 10 + ' m'}` : '';
    this.el.nextUturn.classList.toggle('here', car.medianOpen);
    this.el.lap.textContent = Math.floor(car.odometer / t.length) + 1;
    this.el.odo.textContent = (car.odometer / 1000).toFixed(1);
    if (car.crashCount !== this.lastCrashCount) {
      if (this.lastCrashCount !== undefined) this.toast(`Crash · ${Math.round(car.lastCrash.kmh)} km/h impact`);
      this.lastCrashCount = car.crashCount;
      this.el.crashes.textContent = car.crashCount ? `${car.crashCount} crash${car.crashCount > 1 ? 'es' : ''}` : 'Driven';
    }
    this.el.cam.textContent = camMode === 'chase' ? 'Chase' : 'Cockpit';
    this.el.dir.textContent = forward ? 'CW' : 'ACW';

    this.drawMap(pos, yaw, car);
  }

  drawMap(pos, yaw, car) {
    const ctx = this.ctx, c = this.el.map, dpr = this.dpr || 1;
    const W = c.width, H = c.height;
    const R = W / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(5,12,21,0.82)';
    ctx.fillRect(0, 0, W, H);

    // heading-up: rotate world so the car points to the top; zoom with speed
    const span = 900 + Math.min(1, Math.abs(car.v) / 80) * 900; // metres from centre to edge
    const scale = (R / span);
    ctx.translate(R, R * 1.25);
    ctx.scale(scale, scale);
    ctx.rotate(yaw - Math.PI);
    ctx.translate(-pos.x, -pos.z);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 9 / scale * dpr * 0.35;
    ctx.stroke(this.minor);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 12 / scale * dpr * 0.35;
    ctx.stroke(this.major);
    ctx.setLineDash([14 / scale * dpr * 0.35, 10 / scale * dpr * 0.35]);
    ctx.strokeStyle = 'rgba(200,170,140,0.45)';
    ctx.lineWidth = 6 / scale * dpr * 0.35;
    ctx.stroke(this.rail);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(73,198,255,0.95)';
    ctx.lineWidth = 18 / scale * dpr * 0.35;
    ctx.stroke(this.ring);
    const dot = (pts, r, fill, stroke) => {
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5 * dpr / scale;
      for (const [x, z] of pts) {
        if (Math.abs(x - pos.x) > span * 1.6 || Math.abs(z - pos.z) > span * 1.6) continue;
        ctx.beginPath();
        ctx.arc(x, z, r * dpr / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };
    dot(this.signalPts, 2.6, '#ff5a4a', 'rgba(0,0,0,0.6)');
    dot(this.uturnPts, 4.2, '#ffc440', 'rgba(0,0,0,0.7)');
    ctx.restore();

    // car marker
    ctx.save();
    ctx.translate(R, R * 1.25);
    ctx.fillStyle = '#ffc440';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6 * dpr;
    ctx.beginPath();
    const s = 7 * dpr;
    ctx.moveTo(0, -s * 1.4);
    ctx.lineTo(s, s);
    ctx.lineTo(0, s * 0.45);
    ctx.lineTo(-s, s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // north indicator on the rim
    const na = yaw - Math.PI * 1.5; // screen angle of world north after the map rotation
    const nr = R - 12 * dpr;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `600 ${11 * dpr}px "Titillium Web", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', R + Math.cos(na) * nr, R + Math.sin(na) * nr);
    ctx.restore();

    // overview inset: whole loop, north-up
    this.drawOverview(pos);
  }

  drawOverview(pos) {
    const c = this.el.overview;
    if (!c || !c.clientWidth || !c.clientHeight) return; // hidden on narrow screens
    const ctx = c.getContext('2d');
    const dpr = this.dpr || 1;
    if (c.width !== Math.round(c.clientWidth * dpr)) {
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
    }
    const t = this.track;
    if (!this.bounds) {
      let a = Infinity, b = Infinity, e = -Infinity, f = -Infinity;
      for (let i = 0; i < t.n; i++) { a = Math.min(a, t.px[i]); b = Math.min(b, t.pz[i]); e = Math.max(e, t.px[i]); f = Math.max(f, t.pz[i]); }
      this.bounds = { x: a, z: b, w: e - a, h: f - b };
    }
    const B = this.bounds, pad = 8 * dpr;
    const sc = Math.min((c.width - pad * 2) / B.w, (c.height - pad * 2) / B.h);
    const ox = (c.width - B.w * sc) / 2, oz = (c.height - B.h * sc) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(sc, 0, 0, sc, ox - B.x * sc, oz - B.z * sc);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2.2 * dpr / sc;
    ctx.stroke(this.ring);
    ctx.fillStyle = '#ffc440';
    ctx.beginPath();
    ctx.arc(pos.x, pos.z, 4 * dpr / sc, 0, Math.PI * 2);
    ctx.fill();
  }
}
