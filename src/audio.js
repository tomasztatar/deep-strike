// Fully synthesized WebAudio sound design — no audio files needed.
export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.7;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());

    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);

    this.verb = c.createConvolver();
    this.verb.buffer = this._impulse(3.5, 2.2);
    const vg = c.createGain();
    vg.gain.value = 0.55;
    this.verb.connect(vg).connect(this.master);

    // Underwater muffling for most SFX
    this.sfx = c.createBiquadFilter();
    this.sfx.type = 'lowpass';
    this.sfx.frequency.value = 3200;
    this.sfx.connect(this.master);
    const wet = c.createGain();
    wet.gain.value = 0.6;
    this.sfx.connect(wet).connect(this.verb);

    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._ambient();
    this._engine();
    this._ww2Loops();
  }

  get ready() {
    return !!this.ctx && !this.muted;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  _impulse(sec, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _noise(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur);
    return s;
  }

  _env(param, t, attack, peak, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _ambient() {
    const c = this.ctx;
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = c.createGain();
    g.gain.value = 0.4;
    src.connect(lp).connect(g).connect(this.master);
    src.start();

    const o = c.createOscillator();
    o.frequency.value = 49;
    const og = c.createGain();
    og.gain.value = 0.05;
    o.connect(og).connect(this.master);
    o.start();
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.06;
    const lg = c.createGain();
    lg.gain.value = 0.035;
    lfo.connect(lg).connect(og.gain);
    lfo.start();
  }

  _engine() {
    const c = this.ctx;
    this.engOsc = c.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc.frequency.value = 30;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 170;
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    this.engOsc.connect(lp).connect(this.engGain).connect(this.master);
    this.engOsc.start();

    const cav = c.createBufferSource();
    cav.buffer = this.noiseBuf;
    cav.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.8;
    this.cavGain = c.createGain();
    this.cavGain.gain.value = 0;
    cav.connect(bp).connect(this.cavGain).connect(this.master);
    cav.start();
  }

  setEngine(speed01, boost) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engOsc.frequency.setTargetAtTime(26 + speed01 * 48, t, 0.25);
    this.engGain.gain.setTargetAtTime(speed01 > 0.005 ? 0.04 + speed01 * 0.13 : 0, t, 0.3);
    this.cavGain.gain.setTargetAtTime(boost ? 0.14 : 0, t, 0.15);
  }

  _tone(type, freq, t, attack, peak, decay, dest, freqEnd) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = c.createGain();
    this._env(g.gain, t, attack, peak, decay);
    o.connect(g);
    for (const d of dest) g.connect(d);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  ping(vol = 1, freq = 1180) {
    if (!this.ready || vol < 0.01) return;
    const t = this.ctx.currentTime;
    this._tone('sine', freq, t, 0.004, 0.42 * vol, 1.9, [this.master, this.verb], freq * 0.97);
    this._tone('sine', freq, t + 1.15, 0.004, 0.1 * vol, 1.2, [this.verb]);
  }

  enemyPing(vol = 1) {
    if (!this.ready || vol < 0.01) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 860, t, 0.006, 0.32 * vol, 1.4, [this.master, this.verb], 820);
    this._tone('triangle', 430, t, 0.006, 0.12 * vol, 1.0, [this.verb]);
  }

  launch(vol = 1) {
    if (!this.ready || vol < 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noise(t, 0.9);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(1700, t + 0.55);
    const g = c.createGain();
    this._env(g.gain, t, 0.02, 0.55 * vol, 0.7);
    n.connect(bp).connect(g).connect(this.sfx);
    this._tone('sine', 120, t, 0.005, 0.8 * vol, 0.35, [this.sfx], 38);
  }

  explosion(vol = 1, big = false) {
    if (!this.ready || vol < 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const dur = big ? 2.6 : 1.6;
    const n = this._noise(t, dur + 0.1);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1600, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + dur);
    const g = c.createGain();
    this._env(g.gain, t, 0.008, 1.0 * vol, dur);
    n.connect(lp).connect(g);
    g.connect(this.master);
    g.connect(this.verb);
    this._tone('sine', big ? 60 : 75, t, 0.005, 1.0 * vol, big ? 1.8 : 1.1, [this.master], 20);
  }

  clang(vol = 1) {
    if (!this.ready || vol < 0.01) return;
    const c = this.ctx, t = c.currentTime;
    for (const f of [173, 241, 317, 433]) this._tone('square', f, t, 0.003, 0.05 * vol, 0.9 + Math.random() * 0.5, [this.sfx], f * 0.92);
    const n = this._noise(t, 0.3);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = c.createGain();
    this._env(g.gain, t, 0.002, 0.35 * vol, 0.2);
    n.connect(hp).connect(g).connect(this.sfx);
  }

  creak() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone('sawtooth', 70 + Math.random() * 30, t, 0.3, 0.06, 1.2, [this.sfx], 45);
  }

  beep(freq = 880, vol = 0.22, dur = 0.12) {
    if (!this.ready) return;
    this._tone('square', freq, this.ctx.currentTime, 0.005, vol, dur, [this.master]);
  }

  alarm() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone('square', 700, t, 0.005, 0.12, 0.1, [this.master]);
    this._tone('square', 940, t + 0.12, 0.005, 0.12, 0.1, [this.master]);
  }

  lockTone() {
    if (!this.ready) return;
    this._tone('sine', 1650, this.ctx.currentTime, 0.003, 0.12, 0.06, [this.master]);
  }

  pickup() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [660, 880, 1320].forEach((f, i) => this._tone('sine', f, t + i * 0.07, 0.005, 0.22, 0.25, [this.master, this.verb]));
  }

  fanfare() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this._tone('triangle', f, t + i * 0.12, 0.01, 0.2, 0.5, [this.master, this.verb]));
  }

  decoy() {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noise(t, 0.6);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    const g = c.createGain();
    this._env(g.gain, t, 0.01, 0.3, 0.5);
    n.connect(bp).connect(g).connect(this.sfx);
    this._tone('sine', 1900, t, 0.01, 0.08, 0.4, [this.sfx], 2600);
  }

  // ================= WWII sounds =================
  _ww2Loops() {
    const c = this.ctx;
    // Diesel: low sawtooth, chugging amplitude modulation
    const d = c.createOscillator();
    d.type = 'sawtooth';
    d.frequency.value = 34;
    const dlp = c.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 260;
    this.dieselAM = c.createGain();
    this.dieselAM.gain.value = 0.6;
    const chug = c.createOscillator();
    chug.type = 'square';
    chug.frequency.value = 6;
    const chugG = c.createGain();
    chugG.gain.value = 0.4;
    chug.connect(chugG).connect(this.dieselAM.gain);
    this.dieselGain = c.createGain();
    this.dieselGain.gain.value = 0;
    d.connect(dlp).connect(this.dieselAM).connect(this.dieselGain).connect(this.master);
    d.start(); chug.start();
    this.dieselOsc = d; this.chugOsc = chug;
    // Electric motor whine
    const e = c.createOscillator();
    e.type = 'sine';
    e.frequency.value = 180;
    const e2 = c.createOscillator();
    e2.type = 'triangle';
    e2.frequency.value = 60;
    this.elecGain = c.createGain();
    this.elecGain.gain.value = 0;
    e.connect(this.elecGain);
    e2.connect(this.elecGain);
    this.elecGain.connect(this.master);
    e.start(); e2.start();
    this.elecOsc = e;
    // Hydrophone: enemy screws thrumming
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 320;
    bp.Q.value = 1.4;
    this.screwAM = c.createGain();
    this.screwAM.gain.value = 0.5;
    this.screwLfo = c.createOscillator();
    this.screwLfo.frequency.value = 4;
    const lg = c.createGain();
    lg.gain.value = 0.5;
    this.screwLfo.connect(lg).connect(this.screwAM.gain);
    this.screwGain = c.createGain();
    this.screwGain.gain.value = 0;
    n.connect(bp).connect(this.screwAM).connect(this.screwGain).connect(this.master);
    n.start(); this.screwLfo.start();
    // Aircraft engine drone
    this.planeGain = c.createGain();
    this.planeGain.gain.value = 0;
    const plp = c.createBiquadFilter();
    plp.type = 'lowpass';
    plp.frequency.value = 600;
    for (const f of [86, 89.5]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(plp);
      o.start();
    }
    plp.connect(this.planeGain).connect(this.master);
  }

  /** mode: 'diesel' | 'electric' | null */
  setDrive(mode, level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.dieselGain.gain.setTargetAtTime(mode === 'diesel' ? 0.07 + level * 0.12 : 0, t, 0.4);
    this.dieselOsc.frequency.setTargetAtTime(28 + level * 16, t, 0.5);
    this.chugOsc.frequency.setTargetAtTime(4 + level * 6, t, 0.5);
    this.elecGain.gain.setTargetAtTime(mode === 'electric' && level > 0.01 ? 0.004 + level * 0.022 : 0, t, 0.4);
    this.elecOsc.frequency.setTargetAtTime(140 + level * 220, t, 0.4);
  }

  setScrews(vol, rate) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.screwGain.gain.setTargetAtTime(Math.min(0.35, vol * 0.35), t, 0.3);
    this.screwLfo.frequency.setTargetAtTime(Math.max(1, rate), t, 0.5);
  }

  setPlane(vol) {
    if (!this.ctx) return;
    this.planeGain.gain.setTargetAtTime(Math.min(0.2, vol * 0.2), this.ctx.currentTime, 0.3);
  }

  silenceLoops() {
    this.setEngine(0, false);
    this.setDrive(null, 0);
    this.setScrews(0, 1);
    this.setPlane(0);
  }

  klaxon() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this._tone('sawtooth', 260, t + i * 0.55, 0.05, 0.12, 0.4, [this.master], 430);
  }

  asdic(vol = 1, contact = false) {
    if (!this.ready || vol < 0.01) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 1480, t, 0.004, 0.3 * vol, 0.45, [this.master, this.verb], 1460);
    if (contact) this._tone('sine', 1480, t + 0.22, 0.004, 0.22 * vol, 0.3, [this.master, this.verb]);
  }

  gun(vol = 1) {
    if (!this.ready || vol < 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noise(t, 0.6);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const g = c.createGain();
    this._env(g.gain, t, 0.003, 0.7 * vol, 0.5);
    n.connect(lp).connect(g);
    g.connect(this.master);
    g.connect(this.verb);
    this._tone('sine', 90, t, 0.003, 0.6 * vol, 0.3, [this.master], 40);
  }

  flak(vol = 1) {
    if (!this.ready || vol < 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noise(t, 0.12);
    const hp = c.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1200;
    const g = c.createGain();
    this._env(g.gain, t, 0.002, 0.35 * vol, 0.09);
    n.connect(hp).connect(g).connect(this.master);
  }

  splash(vol = 1) {
    if (!this.ready || vol < 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noise(t, 0.9);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.8);
    const g = c.createGain();
    this._env(g.gain, t, 0.01, 0.4 * vol, 0.8);
    n.connect(bp).connect(g).connect(this.sfx);
  }

  groan(vol = 1) {
    if (!this.ready || vol < 0.01) return;
    const t = this.ctx.currentTime;
    this._tone('sawtooth', 62, t, 0.6, 0.12 * vol, 2.8, [this.sfx], 31);
    this._tone('square', 140, t + 0.8, 0.2, 0.04 * vol, 1.5, [this.sfx], 90);
  }
}
