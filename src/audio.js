// Synthesised V6 hybrid engine, driven by rpm and throttle load.
// Everything is Web Audio nodes; no samples.

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.cockpit = false;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const now = ctx.currentTime;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    // --- engine voice: stacked oscillators -> pulse AM -> waveshaper -> filters
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0.0;
    const mk = (type, gain, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      o.start(now);
      return { o, g };
    };
    this.oscs = [
      { ...mk('sawtooth', 0.55), mul: 1 },
      { ...mk('sawtooth', 0.35, 9), mul: 1 },
      { ...mk('square', 0.22), mul: 0.5 },
      { ...mk('sawtooth', 0.18, -6), mul: 2 },
      { ...mk('triangle', 0.25), mul: 1.5 },
      { ...mk('sine', 0.35), mul: 0.25 },
    ];
    const pre = ctx.createGain();
    for (const v of this.oscs) v.g.connect(pre);

    // per-revolution combustion pulse (amplitude modulation)
    this.am = ctx.createGain();
    this.am.gain.value = 0.75;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'triangle';
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0.25;
    this.lfo.connect(this.lfoDepth).connect(this.am.gain);
    this.lfo.start(now);
    pre.connect(this.am);

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = this.curve(2.2);
    this.shaper.oversample = '2x';
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 1.4;
    this.lp.frequency.value = 900;
    this.body = ctx.createBiquadFilter();
    this.body.type = 'peaking';
    this.body.frequency.value = 320;
    this.body.Q.value = 0.9;
    this.body.gain.value = 3;
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 45;
    this.am.connect(this.shaper).connect(this.lp).connect(this.body).connect(this.hp).connect(this.engineBus).connect(this.master);

    // slapback echo for underpass trenches
    this.echoDelay = ctx.createDelay(0.5);
    this.echoDelay.delayTime.value = 0.055;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2500;
    this.echoWet = ctx.createGain();
    this.echoWet.gain.value = 0;
    this.engineBus.connect(this.echoDelay);
    this.echoDelay.connect(echoTone).connect(fb).connect(this.echoDelay);
    echoTone.connect(this.echoWet).connect(this.master);

    // --- MGU-K / turbo whine
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.whine.start(now);

    // --- noise sources: wind, road rumble, kerb scrape, shift clack
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    const loopNoise = () => {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      n.loop = true;
      n.start(now, Math.random() * 1.5);
      return n;
    };
    const band = (type, f, q) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter = band('bandpass', 700, 0.6);
    loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);

    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    loopNoise().connect(band('lowpass', 140, 0.8)).connect(this.roadGain).connect(this.master);

    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    loopNoise().connect(band('bandpass', 2600, 1.2)).connect(this.scrapeGain).connect(this.master);

    this.load = 0;
    this.popTimer = 0;
  }

  curve(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return c;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  burst(freq, q, dur, gain) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  // a short two-tone car horn from somewhere nearby
  honk() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    g.gain.setValueAtTime(0, t);
    for (const [on, off] of [[0, 0.18], [0.26, 0.62]]) {
      g.gain.setValueAtTime(0.0001, t + on);
      g.gain.linearRampToValueAtTime(0.11, t + on + 0.02);
      g.gain.setValueAtTime(0.11, t + off - 0.03);
      g.gain.linearRampToValueAtTime(0.0001, t + off);
    }
    for (const f of [415, 520]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.7);
    }
    lp.connect(g).connect(this.master);
  }

  // impact: low thump, crunch of carbon, and a metallic ring, scaled by impact speed
  crash(kmh) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = Math.min(1, kmh / 120);
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(90, t);
    thump.frequency.exponentialRampToValueAtTime(35, t + 0.35);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.9 * (0.5 + k), t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    thump.connect(tg).connect(this.master);
    thump.start(t);
    thump.stop(t + 0.5);
    this.burst(500, 0.8, 0.35 + 0.25 * k, 0.9 * (0.5 + k));
    this.burst(2600, 4, 0.25, 0.35 * (0.4 + k));
    this.burst(5200, 6, 0.6, 0.12 * k);
  }

  update(dt, car) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const rpm = car.rpm;
    const spd = Math.abs(car.v);
    // load follows throttle and actual acceleration, so the note hardens when pulling
    const accelLoad = Math.max(0, Math.min(1, car.accel / 10));
    const targetLoad = Math.max(car.throttle * 0.75 + accelLoad * 0.25, 0);
    this.load += (targetLoad - this.load) * Math.min(1, dt * 10);
    const load = this.load;

    const f0 = (rpm / 60) * 3; // V6: three firing pulses per revolution
    for (const v of this.oscs) v.o.frequency.setTargetAtTime(f0 * v.mul, t, 0.015);
    this.lfo.frequency.setTargetAtTime(rpm / 60 / 2, t, 0.02);
    this.lfoDepth.gain.setTargetAtTime(0.12 + 0.25 * (1 - load), t, 0.05);

    const cutoff = 500 + load * 4200 + (rpm / 12000) * 1600;
    this.lp.frequency.setTargetAtTime(this.cockpit ? cutoff * 0.8 : cutoff, t, 0.03);
    const r = rpm / 12000;
    const vol = 0.05 + 0.1 * r + load * (0.22 + 0.3 * r);
    this.engineBus.gain.setTargetAtTime(vol * (car.shiftTimer > 0 && !car.reverse ? 0.35 : 1), t, 0.02);

    this.whine.frequency.setTargetAtTime(1400 + spd * 38, t, 0.05);
    this.whineGain.gain.setTargetAtTime(0.012 + 0.03 * load * Math.min(1, spd / 40), t, 0.08);

    const w = Math.min(1, spd / 90);
    this.windGain.gain.setTargetAtTime(w * w * (this.cockpit ? 0.55 : 0.3), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(500 + spd * 12, t, 0.1);
    this.roadGain.gain.setTargetAtTime(Math.min(1, spd / 50) * 0.35, t, 0.1);
    this.scrapeGain.gain.setTargetAtTime(car.scrape * 0.25, t, 0.03);
    this.echoWet.gain.setTargetAtTime((this.echo || 0) * 0.9, t, 0.15);

    // gear change clicks and downshift blips
    while (car.events.length) {
      const e = car.events.shift();
      if (e === 'up') this.burst(1800, 2, 0.05, 0.25);
      else this.burst(900, 1.5, 0.08, 0.2);
    }
    // overrun crackle when lifting at high revs
    this.popTimer -= dt;
    if (car.throttle < 0.15 && rpm > 8000 && spd > 15 && this.popTimer <= 0) {
      this.burst(300 + Math.random() * 500, 3, 0.04 + Math.random() * 0.05, 0.35 * Math.random());
      this.popTimer = 0.04 + Math.random() * 0.18;
    }
  }
}
