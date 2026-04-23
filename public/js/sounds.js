/* Casino Sounds via Web Audio API */
class CasinoSounds {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterGain = null;
  }

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.7;
      this.masterGain.connect(this.ctx.destination);
    } catch (e) { this.enabled = false; }
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.masterGain) this.masterGain.gain.value = this.enabled ? 0.7 : 0;
    return this.enabled;
  }

  _noise(duration = 0.05, vol = 0.4, decay = 8) {
    if (!this.ctx || !this.enabled) return;
    const size = Math.floor(this.ctx.sampleRate * duration);
    const buf  = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < size; i++)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, decay);
    const src  = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buf;
    gain.gain.value = vol;
    src.connect(gain);
    gain.connect(this.masterGain);
    src.start();
  }

  _tone(freq, type = 'sine', startTime = 0, dur = 0.3, vol = 0.2) {
    if (!this.ctx || !this.enabled) return;
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime + startTime;
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  cardDeal() {
    if (!this.ctx || !this.enabled) return;
    this.resume();
    this._noise(0.08, 0.35, 12);
    this._tone(800, 'sawtooth', 0.01, 0.06, 0.08);
  }

  chipPlace() {
    if (!this.ctx || !this.enabled) return;
    this.resume();
    this._noise(0.04, 0.5, 15);
    this._tone(1200, 'triangle', 0, 0.04, 0.1);
  }

  buttonClick() {
    if (!this.ctx || !this.enabled) return;
    this.resume();
    this._tone(600, 'triangle', 0, 0.08, 0.1);
  }

  win() {
    if (!this.ctx || !this.enabled) return;
    this.resume();
    const notes = [261.63, 329.63, 392.00, 523.25];
    notes.forEach((f, i) => this._tone(f, 'triangle', i * 0.1, 0.35, 0.22));
    setTimeout(() => this._noise(0.15, 0.3, 5), 400);
  }

  blackjack() {
    if (!this.ctx || !this.enabled) return;
    this.resume();
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this._tone(f, 'square', i * 0.07, 0.5, 0.18));
    setTimeout(() => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        this._tone(f, 'triangle', i * 0.06, 0.4, 0.15)
      );
    }, 500);
  }

  bust() {
    if (!this.ctx || !this.enabled) return;
    this.resume();
    const notes = [329.63, 261.63, 220.00, 196.00];
    notes.forEach((f, i) => this._tone(f, 'sawtooth', i * 0.14, 0.3, 0.2));
  }

  dealerBust() {
    if (!this.ctx || !this.enabled) return;
    this.resume();
    // Crowd cheer approximation
    for (let i = 0; i < 5; i++) {
      setTimeout(() => this._noise(0.2, 0.3, 3), i * 80);
    }
    this.win();
  }

  allIn() {
    if (!this.ctx || !this.enabled) return;
    this.resume();
    // Dramatic drum roll
    for (let i = 0; i < 10; i++) {
      setTimeout(() => this._noise(0.06, 0.4 + i * 0.04, 8), i * 120);
    }
    setTimeout(() => this._tone(110, 'sawtooth', 0, 0.8, 0.3), 0);
    setTimeout(() => this.blackjack(), 1300);
  }

  lose() {
    if (!this.ctx || !this.enabled) return;
    this.resume();
    this._tone(220, 'sawtooth', 0, 0.5, 0.2);
    this._tone(196, 'sawtooth', 0.2, 0.5, 0.15);
  }

  push() {
    if (!this.ctx || !this.enabled) return;
    this.resume();
    this._tone(392, 'triangle', 0, 0.25, 0.15);
    this._tone(392, 'triangle', 0.15, 0.25, 0.12);
  }

  tick() {
    if (!this.ctx || !this.enabled) return;
    this.resume();
    this._tone(880, 'square', 0, 0.04, 0.08);
  }
}

window.sounds = new CasinoSounds();
