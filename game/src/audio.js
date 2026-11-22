'use strict';
/* Port Azura: Sunset Heat — procedural WebAudio sound.
   No audio files: the engine hum, police siren, ambient pad and every effect
   are synthesised live. The context is created on the first user gesture,
   as browsers require; M toggles mute. */

PA.Audio = (function () {
  let ctx = null, master = null, muted = false;
  let engineOsc = null, engineGain = null, engineFilter = null;
  let sirenOsc = null, sirenGain = null, sirenLFO = null;
  let padNodes = null;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
    startPad();
  }

  function startPad() {
    /* A slow warm chord pad for the sunset mood: two detuned triangles
       through a lowpass, swelling on a long LFO. */
    padNodes = { oscs: [] };
    const g = ctx.createGain(); g.gain.value = 0.035;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 620;
    [110, 164.81, 220].forEach(function (freq, i) {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'sine' : 'triangle';
      o.frequency.value = freq;
      o.detune.value = (i - 1) * 6;
      o.connect(f); o.start();
      padNodes.oscs.push(o);
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.016;
    lfo.connect(lfoGain); lfoGain.connect(g.gain); lfo.start();
    f.connect(g); g.connect(master);
  }

  function setEngine(on, speedRatio) {
    if (!ctx) return;
    if (on && !engineOsc) {
      engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth';
      engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 420;
      engineGain = ctx.createGain(); engineGain.gain.value = 0.0;
      engineOsc.connect(engineFilter); engineFilter.connect(engineGain); engineGain.connect(master);
      engineOsc.start();
    }
    if (!engineOsc) return;
    const t = ctx.currentTime;
    if (on) {
      engineOsc.frequency.setTargetAtTime(52 + speedRatio * 165, t, 0.08);
      engineFilter.frequency.setTargetAtTime(320 + speedRatio * 900, t, 0.1);
      engineGain.gain.setTargetAtTime(0.055 + speedRatio * 0.05, t, 0.12);
    } else {
      engineGain.gain.setTargetAtTime(0.0, t, 0.15);
    }
  }

  function setSiren(on) {
    if (!ctx) return;
    if (on && !sirenOsc) {
      sirenOsc = ctx.createOscillator(); sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 840;
      sirenLFO = ctx.createOscillator(); sirenLFO.type = 'square'; sirenLFO.frequency.value = 0.85;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 190;
      sirenLFO.connect(lfoGain); lfoGain.connect(sirenOsc.frequency);
      sirenGain = ctx.createGain(); sirenGain.gain.value = 0.0;
      sirenOsc.connect(sirenGain); sirenGain.connect(master);
      sirenOsc.start(); sirenLFO.start();
    }
    if (!sirenOsc) return;
    sirenGain.gain.setTargetAtTime(on ? 0.028 : 0.0, ctx.currentTime, 0.2);
  }

  /* One-shot synth blips. */
  function tone(freqA, freqB, dur, type, vol, when) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freqA, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freqB), t0 + dur);
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, freq) {
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 900;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }

  return {
    init: init,
    setEngine: setEngine,
    setSiren: setSiren,
    toggleMute: function () {
      muted = !muted;
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.05);
      return muted;
    },
    isMuted: function () { return muted; },
    checkpoint: function () { tone(880, 880, 0.09, 'square', 0.1); tone(1318, 1318, 0.14, 'square', 0.1, 0.09); },
    cash: function () { tone(1046, 1046, 0.08, 'triangle', 0.14); tone(1568, 1568, 0.16, 'triangle', 0.14, 0.08); },
    punch: function () { noise(0.09, 0.25, 500); tone(150, 60, 0.09, 'sine', 0.2); },
    crash: function (hard) { noise(hard ? 0.32 : 0.16, hard ? 0.4 : 0.22, hard ? 500 : 800); tone(90, 40, 0.25, 'sine', hard ? 0.3 : 0.15); },
    pickup: function () { tone(660, 990, 0.12, 'triangle', 0.13); },
    alarm: function () { tone(520, 520, 0.12, 'square', 0.1); tone(520, 520, 0.12, 'square', 0.1, 0.18); },
    click: function () { tone(700, 700, 0.05, 'square', 0.07); },
  };
})();
