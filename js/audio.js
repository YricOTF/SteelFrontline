"use strict";

const Snd = {
  ctx: null,
  voices: 0,
  lastShot: new Map(),
  lastAmbience: -Infinity,

  ensure() {
    if (!CFG.snd) return;
    try {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.ctx = new AudioContext();
        const audio = this.ctx;
        this.master = audio.createGain();
        this.ui = audio.createGain();
        this.battle = audio.createGain();
        this.ambient = audio.createGain();
        this.ambient.gain.value = 0;
        for (const bus of [this.ui, this.battle, this.ambient]) bus.connect(this.master);
        const compressor = audio.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.ratio.value = 6;
        this.master.connect(compressor).connect(audio.destination);

        this.noise = audio.createBuffer(1, audio.sampleRate * 3, audio.sampleRate);
        const samples = this.noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

        const wind = audio.createBufferSource();
        wind.buffer = this.noise;
        wind.loop = true;
        this.windFilter = audio.createBiquadFilter();
        this.windFilter.type = 'lowpass';
        this.windFilter.frequency.value = 330;
        wind.connect(this.windFilter).connect(this.ambient);
        wind.start();
        this.updateVolumes();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch (error) {
      console.debug('无法启用网页音频', error);
      this.ctx = null;
    }
  },

  updateVolumes() {
    if (!this.ctx) return;
    const time = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(CFG.snd ? CFG.volume / 100 : 0, time, 0.06);
    this.ui.gain.setTargetAtTime(CFG.sndUi ? 1 : 0, time, 0.06);
    this.battle.gain.setTargetAtTime(CFG.sndBattle ? 0.8 : 0, time, 0.06);
    this.lastAmbience = -Infinity;
  },

  updateAmbience(g) {
    if (this.ctx?.state !== 'running') return;
    const time = this.ctx.currentTime;
    if (time - this.lastAmbience < 0.24) return;
    this.lastAmbience = time;
    const playing = g?.state === 'playing' && !document.hidden && CFG.snd && CFG.sndAmbient;
    const rain = g?.cfg.weather === 'rain';
    const strength = rain ? 0.035 : 0.021;
    const gust = 0.78 + Math.sin(time * 0.66) * 0.22;
    this.ambient.gain.setTargetAtTime(playing ? strength * gust : 0, time, 0.18);
    this.windFilter.frequency.setTargetAtTime(rain ? 1250 : 270 + gust * 120, time, 0.18);
  },

  tone(bus, startFreq, endFreq, duration, volume, delay = 0, shape = 'sine') {
    if (this.ctx?.state !== 'running') return;
    const audio = this.ctx;
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.type = shape;
    oscillator.frequency.setValueAtTime(startFreq, start);
    oscillator.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(volume, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope).connect(bus);
    oscillator.start(start);
    oscillator.stop(start + duration);
  },

  burst(bus, duration, volume, frequency, tailFrequency, type = 'lowpass') {
    const audio = this.ctx;
    const now = audio.currentTime;
    const source = audio.createBufferSource();
    source.buffer = this.noise;
    const filter = audio.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, now);
    filter.frequency.exponentialRampToValueAtTime(tailFrequency, now + duration);
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(volume, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(envelope).connect(bus);
    source.start(now, Math.random() * 1.5, duration);
    return source;
  },

  signal(notes, combat = false) {
    if (!CFG.snd || (combat ? !CFG.sndBattle : !CFG.sndUi)) return;
    if (this.ctx?.state !== 'running') return;
    const bus = combat ? this.battle : this.ui;
    for (const [frequency, start, duration, gain] of notes) {
      this.tone(bus, frequency, frequency * 0.965, duration, gain, start, 'triangle');
    }
  },

  spatial(g, x, y, side, key, delay) {
    if (!CFG.snd || !CFG.sndBattle || this.ctx?.state !== 'running' || this.voices >= 16 || document.hidden) return null;
    if (side !== g.playerSide && !visible(g, g.playerSide, x, y)) return null;
    const time = this.ctx.currentTime;
    if (time - (this.lastShot.get(key) ?? -Infinity) < delay) return null;
    const listeningRadius = Math.max(280, Math.min(1000, Math.hypot(W, H) * 0.55 / g.cam.zoom));
    const distance = dist(x, y, g.cam.x, g.cam.y);
    if (distance >= listeningRadius) return null;
    const output = this.ctx.createGain();
    output.gain.value = (1 - distance / listeningRadius) ** 1.4;
    let pan = null;
    if (this.ctx.createStereoPanner) {
      pan = this.ctx.createStereoPanner();
      pan.pan.value = clamp((x - g.cam.x) * g.cam.zoom / Math.max(1, W / 2), -0.85, 0.85);
      output.connect(pan).connect(this.battle);
    } else output.connect(this.battle);
    this.lastShot.set(key, time);
    this.voices++;
    return { output, pan };
  },

  playSpatialBlast(voice, duration, gain, cutoff, tail, bass) {
    const source = this.burst(voice.output, duration, gain, cutoff, tail);
    if (bass) this.tone(voice.output, bass, bass * 0.52, duration * 0.75, gain * 0.38);
    source.onended = () => {
      voice.output.disconnect();
      voice.pan?.disconnect();
      this.voices--;
    };
  },

  fire(g, x, y, type, side) {
    const heavy = type === 'arm' || type === 'art';
    const voice = this.spatial(g, x, y, side, heavy ? 'heavy' : 'light', heavy ? 0.16 : 0.075);
    if (voice) this.playSpatialBlast(voice, heavy ? 0.33 : 0.13, heavy ? 0.21 : 0.15,
      heavy ? 2700 : 4900, heavy ? 210 : 950, heavy ? 126 : 0);
  },

  boom(g, x, y, large, side) {
    const voice = this.spatial(g, x, y, side, 'impact', large ? 0.19 : 0.11);
    if (voice) this.playSpatialBlast(voice, large ? 0.85 : 0.32, large ? 0.32 : 0.20,
      large ? 1550 : 2100, large ? 85 : 290, large ? 74 : 105);
  },

  click() { this.signal([[610, 0, 0.07, 0.075]]); },
  select() { this.signal([[420, 0, 0.065, 0.09], [630, 0.035, 0.09, 0.075]]); },
  order() { this.signal([[320, 0, 0.07, 0.09], [540, 0.045, 0.10, 0.09]]); },
  deploy() { this.signal([[225, 0, 0.11, 0.11], [345, 0.07, 0.11, 0.09]], true); },
  deployDone() { this.signal([[370, 0, 0.10, 0.12], [554, 0.09, 0.16, 0.11]], true); },
  capture() { this.signal([[392, 0, 0.18, 0.11], [523, 0.11, 0.20, 0.13], [659, 0.22, 0.25, 0.13]], true); },
  skill() { this.signal([[290, 0, 0.10, 0.085], [435, 0.06, 0.13, 0.10], [580, 0.14, 0.15, 0.10]], true); },
  eventAlert() { this.signal([[360, 0, 0.16, 0.12], [291, 0.19, 0.18, 0.11], [360, 0.4, 0.22, 0.12]], true); },
  win() { this.signal([[392, 0, 0.42, 0.12], [523, 0.13, 0.42, 0.12], [659, 0.27, 0.55, 0.11], [784, 0.41, 0.60, 0.12]]); },
  lose() { this.signal([[293, 0, 0.47, 0.13], [261, 0.20, 0.48, 0.11], [196, 0.37, 0.61, 0.11]]); },
};
