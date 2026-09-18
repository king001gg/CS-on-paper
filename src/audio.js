// 纸上交锋 · PAPER STRIKE —— Web Audio 合成音效（不依赖任何外部音频文件）
// AudioContext 只在用户点击「进入训练场」之后创建。

export class GameAudio {
  constructor() {
    this.ctx = null
    this.master = null
    this.noiseBuffer = null
    this.muted = false
    this.ready = false
    this.volume = 0.55
  }

  init() {
    if (this.ready) return true
    const Ctor = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null
    if (!Ctor) return false
    try {
      this.ctx = new Ctor()
    } catch (err) {
      return false
    }
    this.master = this.ctx.createGain()
    this.master.gain.value = this.muted ? 0 : this.volume
    this.master.connect(this.ctx.destination)
    this.noiseBuffer = this.makeNoise(0.6)
    this.ready = true
    return true
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  setMuted(muted) {
    this.muted = !!muted
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume
  }

  makeNoise(seconds) {
    const rate = this.ctx.sampleRate
    const len = Math.floor(rate * seconds)
    const buffer = this.ctx.createBuffer(1, len, rate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = white * 0.7 + last * 3.2
    }
    return buffer
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0
  }

  /** 一段带包络的噪声 */
  noise(o = {}) {
    if (!this.ready || this.muted) return null
    const t0 = this.now() + (o.delay || 0)
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    const filter = this.ctx.createBiquadFilter()
    filter.type = o.filter || 'bandpass'
    filter.frequency.value = o.freq || 1200
    filter.Q.value = o.q ?? 0.9
    const gain = this.ctx.createGain()
    const dur = o.duration || 0.1
    const peak = o.gain ?? 0.5
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + (o.attack ?? 0.004))
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
    return { src, filter, gain }
  }

  /** 一段带包络的振荡器 */
  tone(o = {}) {
    if (!this.ready || this.muted) return null
    const t0 = this.now() + (o.delay || 0)
    const osc = this.ctx.createOscillator()
    osc.type = o.type || 'sine'
    osc.frequency.setValueAtTime(o.from || 440, t0)
    if (o.to && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + (o.duration || 0.2))
    const gain = this.ctx.createGain()
    const dur = o.duration || 0.2
    const peak = o.gain ?? 0.2
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + (o.attack ?? 0.006))
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(gain)
    gain.connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
    return { osc, gain }
  }

  shoot(id) {
    if (!this.ready) return
    if (id === 'sniper') {
      this.noise({ freq: 780, q: 0.7, duration: 0.34, gain: 0.85, attack: 0.002 })
      this.tone({ type: 'triangle', from: 190, to: 46, duration: 0.3, gain: 0.5 })
      this.noise({ filter: 'highpass', freq: 3200, duration: 0.12, gain: 0.28, delay: 0.02 })
    } else {
      this.noise({ freq: 1500, q: 0.8, duration: 0.12, gain: 0.5, attack: 0.002 })
      this.tone({ type: 'square', from: 320, to: 90, duration: 0.1, gain: 0.22 })
    }
  }

  dryFire() {
    this.noise({ filter: 'highpass', freq: 2600, duration: 0.05, gain: 0.2 })
  }

  reloadStart(id) {
    const d = id === 'sniper' ? 0.1 : 0.0
    this.noise({ filter: 'highpass', freq: 1800, duration: 0.06, gain: 0.24, delay: d })
    this.tone({ type: 'square', from: 260, to: 150, duration: 0.06, gain: 0.12, delay: d })
  }

  reloadEnd(id) {
    this.noise({ filter: 'highpass', freq: 2400, duration: 0.07, gain: 0.3, delay: id === 'sniper' ? 0.18 : 0 })
    this.tone({ type: 'triangle', from: 420, to: 220, duration: 0.08, gain: 0.16 })
  }

  boltCycle() {
    this.noise({ filter: 'highpass', freq: 2000, duration: 0.05, gain: 0.2 })
    this.noise({ filter: 'highpass', freq: 1500, duration: 0.06, gain: 0.22, delay: 0.16 })
  }

  enemyShot(distance = 20) {
    const atten = Math.max(0.12, 1 - distance / 46)
    this.noise({ freq: 1100, q: 0.8, duration: 0.13, gain: 0.42 * atten, delay: 0.005 })
    this.tone({ type: 'square', from: 260, to: 80, duration: 0.1, gain: 0.14 * atten })
  }

  enemyAlert() {
    this.tone({ type: 'triangle', from: 700, to: 980, duration: 0.14, gain: 0.16 })
    this.tone({ type: 'triangle', from: 980, to: 1240, duration: 0.12, gain: 0.12, delay: 0.1 })
  }

  enemyDown() {
    this.tone({ type: 'triangle', from: 520, to: 180, duration: 0.28, gain: 0.2 })
    this.noise({ freq: 900, duration: 0.2, gain: 0.2 })
  }

  hitMarker(head = false) {
    this.tone({ type: head ? 'square' : 'triangle', from: head ? 1500 : 1050, to: head ? 900 : 700, duration: 0.07, gain: 0.18 })
  }

  playerHurt() {
    this.noise({ filter: 'lowpass', freq: 600, duration: 0.2, gain: 0.42 })
    this.tone({ type: 'sawtooth', from: 220, to: 90, duration: 0.24, gain: 0.18 })
  }

  footstep() {
    this.noise({ filter: 'lowpass', freq: 420, duration: 0.08, gain: 0.14 })
  }

  jump() {
    this.noise({ filter: 'lowpass', freq: 520, duration: 0.1, gain: 0.16 })
  }

  land() {
    this.noise({ filter: 'lowpass', freq: 320, duration: 0.14, gain: 0.26 })
  }

  uiClick() {
    this.tone({ type: 'triangle', from: 620, to: 880, duration: 0.08, gain: 0.16 })
  }

  victory() {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((f, i) => {
      this.tone({ type: 'triangle', from: f, to: f, duration: 0.34, gain: 0.2, delay: i * 0.14 })
      this.tone({ type: 'sine', from: f * 2, to: f * 2, duration: 0.2, gain: 0.07, delay: i * 0.14 })
    })
  }

  defeat() {
    const notes = [440, 392, 330, 262]
    notes.forEach((f, i) => {
      this.tone({ type: 'triangle', from: f, to: f * 0.98, duration: 0.42, gain: 0.2, delay: i * 0.2 })
    })
  }
}
