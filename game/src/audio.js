// audio.js — all sound is procedural WebAudio: a two-oscillator engine hum
// whose pitch follows the car's speed, a two-tone police siren, an ambient
// sunset pad, and little synthesized blips, thuds and crashes. No audio
// files. The context is created lazily on the first user gesture, as
// browsers require.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.engineNodes = null;
    this.sirenNodes = null;
    this.ambientOn = false;
    this.muted = false;
    this.sirenPhase = 0;
  }

  /** Create the context and start the ambient pad. Call from a gesture. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    // One shared noise buffer for thuds and crashes.
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.startAmbient();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  /** Slow Am7 pad: four detuned triangles through a breathing lowpass. */
  startAmbient() {
    if (!this.ctx || this.ambientOn) return;
    this.ambientOn = true;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.connect(gain);
    gain.connect(this.master);
    for (const freq of [110, 164.8, 196, 261.6]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = (freq % 7) - 3;
      osc.connect(filter);
      osc.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
  }

  /** Engine hum on/off; pitch and volume follow the driven car's speed. */
  setEngine(on, speedNorm = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (on && !this.engineNodes) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = 55;
      const square = ctx.createOscillator();
      square.type = 'square';
      square.frequency.value = 28;
      const squareGain = ctx.createGain();
      squareGain.gain.value = 0.5;
      saw.connect(filter);
      square.connect(squareGain);
      squareGain.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      saw.start();
      square.start();
      this.engineNodes = { gain, filter, saw, square };
    }
    if (!this.engineNodes) return;
    const nodes = this.engineNodes;
    const t = ctx.currentTime;
    if (on) {
      const pitch = 52 + Math.abs(speedNorm) * 130;
      nodes.saw.frequency.setTargetAtTime(pitch, t, 0.06);
      nodes.square.frequency.setTargetAtTime(pitch / 2, t, 0.06);
      nodes.filter.frequency.setTargetAtTime(400 + Math.abs(speedNorm) * 900, t, 0.08);
      nodes.gain.gain.setTargetAtTime(0.1 + Math.abs(speedNorm) * 0.08, t, 0.09);
    } else {
      nodes.gain.gain.setTargetAtTime(0, t, 0.08);
    }
  }

  /** Police siren on/off; update() alternates its two tones. */
  setSiren(on) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (on && !this.sirenNodes) {
      const gain = ctx.createGain();
      gain.gain.value = 0.028;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 720;
      osc.connect(gain);
      gain.connect(this.master);
      osc.start();
      this.sirenNodes = { gain, osc };
    }
    if (!on && this.sirenNodes) {
      const nodes = this.sirenNodes;
      this.sirenNodes = null;
      nodes.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      nodes.osc.stop(ctx.currentTime + 0.3);
    }
  }

  /** Per-frame: alternate the siren tone. */
  update(dt) {
    if (this.sirenNodes && this.ctx) {
      this.sirenPhase += dt;
      const high = this.sirenPhase % 0.9 < 0.45;
      this.sirenNodes.osc.frequency.setTargetAtTime(high ? 960 : 715, this.ctx.currentTime, 0.03);
    }
  }

  /** A short synthesized blip. */
  blip(freq = 880, dur = 0.09, type = 'square', vol = 0.12) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  /** Mission marker reached: a rising two-note chirp. */
  checkpoint() {
    this.blip(740, 0.09, 'square', 0.12);
    setTimeout(() => this.blip(1180, 0.12, 'square', 0.12), 70);
  }

  /** Cash reward: a quick register arpeggio. */
  cash() {
    this.blip(988, 0.08, 'square', 0.13);
    setTimeout(() => this.blip(1319, 0.08, 'square', 0.13), 60);
    setTimeout(() => this.blip(1760, 0.16, 'square', 0.13), 120);
  }

  /** A burst of filtered noise: punches (short/low) and crashes (long). */
  noiseHit(dur = 0.1, cutoff = 500, vol = 0.25) {
    if (!this.ctx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.7 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
  }

  punch() {
    this.noiseHit(0.09, 420, 0.3);
  }

  crash(strength = 0.5) {
    this.noiseHit(0.22 + strength * 0.2, 300 + strength * 500, 0.2 + strength * 0.25);
  }
}
