// 纸上交锋 · PAPER STRIKE —— 传输层
//
// 一个接口，三种实现。这不是过度设计，是整个联机方案里最划算的一步：
//
//   · 进程内回环（LocalTransport）  → 能在 node 里跑无 DOM 的双端收敛测试
//   · 跨 tab 广播（BroadcastChannel）→ 一个浏览器开两个标签页就能跑通整套同步
//   · WebRTC（见 rtc-transport.js）  → 最后换上去的一个实现
//
// 因此有一条铁律：**上层的 NetSession 只认这个接口，绝不直接 new RTCPeerConnection。**
// 破了这条，上面两个实现带来的测试能力就全部作废。
//
// 本文件不引用任何浏览器专有 API（BroadcastChannel 在 node 里也有），可直接单测。

import { encode, decode, readVersion, PROTOCOL_VERSION } from './protocol.js'

export const TRANSPORT_STATE = {
  IDLE: 'idle',
  GATHERING: 'gathering',         // 正在收集网络候选（非 trickle，等它收完）
  OFFER_READY: 'offer-ready',     // 本端已生成邀请码，等对方
  ANSWER_READY: 'answer-ready',   // 本端已生成应战码，等对方
  CONNECTING: 'connecting',       // 双方描述都已就位，正在打洞
  OPEN: 'open',
  FAILED: 'failed',
  CLOSED: 'closed'
}

/** 可靠通道：事件、回合状态。不可靠通道：输入帧与快照 —— 丢一帧只是稍旧，不值得重传 */
export const CHANNEL = { RELIABLE: 'reliable', UNRELIABLE: 'unreliable' }

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * 所有传输实现的共同骨架。
 *
 * 子类只需要实现两件事：
 *   _rawSend(channel, text)  —— 把一段字符串丢到线上
 *   this._receive(text)      —— 收到一段字符串时调用
 * 编解码、统计、监听器、状态广播都在这里统一做，免得三种实现各写一遍再各错一遍。
 */
export class Transport {
  constructor({ isHost = false } = {}) {
    this.isHost = !!isHost
    this._state = TRANSPORT_STATE.IDLE
    this._detail = ''
    this._messageCbs = []
    this._stateCbs = []
    this._closed = false
    this._stats = { sent: 0, recv: 0, dropped: 0, badPackets: 0, sentBytes: 0, recvBytes: 0 }
    this._openedAt = 0
  }

  get state() { return this._state }
  get detail() { return this._detail }
  get stats() { return { ...this._stats, uptimeMs: this._openedAt ? now() - this._openedAt : 0 } }

  onMessage(cb) {
    this._messageCbs.push(cb)
    return () => { const i = this._messageCbs.indexOf(cb); if (i >= 0) this._messageCbs.splice(i, 1) }
  }

  onState(cb) {
    this._stateCbs.push(cb)
    cb(this._state, this._detail)   // 订阅时立刻回放当前状态，省得调用方再查一遍初值
    return () => { const i = this._stateCbs.indexOf(cb); if (i >= 0) this._stateCbs.splice(i, 1) }
  }

  /**
   * 发一条报文。channel 决定走可靠还是不可靠通道 ——
   * 回环与广播没有真正的通道之分，但接口保持一致，换 WebRTC 时上层不用改。
   */
  send(channel, obj) {
    if (this._closed || this._state !== TRANSPORT_STATE.OPEN) return false
    const text = encode(obj)
    this._stats.sent++
    this._stats.sentBytes += text.length
    this._rawSend(channel, text)
    return true
  }

  /** 收到原始文本时的统一入口：解析失败只计数、不抛，也绝不打断渲染循环 */
  _receive(text) {
    if (this._closed) return
    this._stats.recv++
    this._stats.recvBytes += typeof text === 'string' ? text.length : 0
    const m = decode(text)
    if (!m) {
      this._stats.badPackets++
      // 版本不符与畸形包在 decode 里是同一个 null，这里用 readVersion 把前者挑出来 ——
      // 「对方版本不同」是用户能自己解决的问题，值得单独说
      const v = readVersion(text)
      if (v !== null && v !== PROTOCOL_VERSION) {
        this._setState(this._state, '对方协议版本 v' + v + '，本端是 v' + PROTOCOL_VERSION)
      }
      return
    }
    for (const cb of this._messageCbs.slice()) {
      try { cb(m) } catch (err) { console.warn('[net] 报文处理抛了异常，已吞掉：', err) }
    }
  }

  _setState(state, detail = '') {
    if (this._state === state && this._detail === detail) return
    const first = this._state !== TRANSPORT_STATE.OPEN && state === TRANSPORT_STATE.OPEN
    this._state = state
    this._detail = detail
    if (first) this._openedAt = now()
    for (const cb of this._stateCbs.slice()) {
      try { cb(state, detail) } catch (err) { console.warn('[net] 状态回调抛了异常，已吞掉：', err) }
    }
  }

  /** 给「复制诊断信息」按钮用。连不上时用户能把它复制给我们，比「连不上」三个字有用得多 */
  diagnosis() {
    const s = this.stats
    return [
      '角色：' + (this.isHost ? '房主' : '挑战者'),
      '状态：' + this._state + (this._detail ? '（' + this._detail + '）' : ''),
      '协议：v' + PROTOCOL_VERSION,
      '收/发：' + s.recv + ' / ' + s.sent + ' 条，' + s.recvBytes + ' / ' + s.sentBytes + ' 字节',
      '丢弃：' + s.dropped + ' 条，坏包：' + s.badPackets + ' 条',
      '在线：' + Math.round(s.uptimeMs / 1000) + ' 秒'
    ].join('\n')
  }

  close(reason = '') {
    if (this._closed) return
    this._closed = true
    this._setState(TRANSPORT_STATE.CLOSED, reason)
    this._messageCbs.length = 0
    this._stateCbs.length = 0
  }
}

// ---------------------------------------------------------------------------
// 进程内回环：node 测试用
// ---------------------------------------------------------------------------

/**
 * 造一对互相连通的回环传输，返回 [a, b]。
 *
 * 一次性返回两端而不是「造一个再从它身上取对端」—— 回环没有「先有一端」这回事，
 * 硬做成单端接口只会让调用方多写一行没意义的代码。
 *
 * latencyMs / jitterMs / lossRate 是模拟真实链路的手段。第 3 期要拿它验证
 * 「80 ms 延迟、2% 丢包下两端仍然收敛」，这是整个第 3 期唯一能自动化的部分。
 */
export function createLoopbackPair({ latencyMs = 0, jitterMs = 0, lossRate = 0, name = 'local' } = {}) {
  const timers = new Set()
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn() }, ms)
    timers.add(t)
    return t
  }

  const make = (isHost) => {
    const self = new Transport({ isHost })
    self.name = name
    self._peer = null
    self._rawSend = (channel, text) => {
      const peer = self._peer
      if (!peer || peer._closed) return
      // 只有不可靠通道才模拟丢包 —— 可靠通道丢包是自相矛盾的，那会把测试引到错误结论上
      if (channel === CHANNEL.UNRELIABLE && lossRate > 0 && Math.random() < lossRate) {
        self._stats.dropped++
        return
      }
      const jitter = jitterMs > 0 ? (Math.random() * 2 - 1) * jitterMs : 0
      const delay = Math.max(0, latencyMs + jitter)
      if (delay === 0) peer._receive(text)
      else later(() => peer._receive(text), delay)
    }
    self.close = function close(reason = '') {
      Transport.prototype.close.call(this, reason)
      for (const t of timers) clearTimeout(t)
      timers.clear()
    }
    return self
  }

  const a = make(true)
  const b = make(false)
  a._peer = b
  b._peer = a
  // 回环是「已经连上」的状态，直接开门 —— 它没有握手阶段可言
  a._setState(TRANSPORT_STATE.OPEN)
  b._setState(TRANSPORT_STATE.OPEN)
  return [a, b]
}

// ---------------------------------------------------------------------------
// 跨 tab 广播：一个浏览器两个标签页就能验证整套同步
// ---------------------------------------------------------------------------

/**
 * 靠 BroadcastChannel 在同源的多个标签页之间传话。
 *
 * 它可靠且有序，所以「不可靠通道」在这里没有真实性可言 —— 但它的价值不在保真，
 * 而在于**不用 WebRTC、不用 STUN、不用第二台机器**就能把上层跑起来。
 *
 * 注意 BroadcastChannel 不会把消息回投给发送者自己，所以两个标签页天然互收。
 * 但仍然带上 from/to：多开一个标签页时不会互相串味。
 *
 * ⚠️ **寻址按角色，不按 id。** 收端比较的是 `to` 与自己的角色（host/guest），
 * 而不是与 `selfId`。曾经这里比的是 `selfId`，于是调用方一旦传了自定义 id，
 * 两端就永远对不上，消息被**静默丢弃** —— 状态照样是 open，只是什么都收不到。
 * 这个坑很贵：表现为「连上了但没反应」，能把人引到完全错误的方向去查。
 */
export function createBroadcastTransport({ roomId = 'paper-strike', isHost = false, selfId = null } = {}) {
  if (typeof BroadcastChannel !== 'function') {
    throw new Error('当前环境没有 BroadcastChannel')
  }
  const self = new Transport({ isHost })
  self.name = 'broadcast'
  const role = isHost ? 'host' : 'guest'
  const peerRole = isHost ? 'guest' : 'host'
  const id = selfId || role + '-' + Math.random().toString(36).slice(2, 8)
  self.selfId = id
  const ch = new BroadcastChannel(roomId)
  // 广播是「一开频道就算连上」——没有握手，所以直接进 OPEN
  self._setState(TRANSPORT_STATE.OPEN)

  self._rawSend = (channel, text) => {
    ch.postMessage({ from: id, role, to: peerRole, ch: channel, text })
  }
  ch.onmessage = (ev) => {
    const d = ev.data
    if (!d || typeof d.text !== 'string') return
    if (d.from === id) return                       // 自己发的，忽略
    if (d.to && d.to !== role) return               // 发给别人的，忽略
    self._receive(d.text)
  }
  const baseClose = self.close.bind(self)
  self.close = (reason = '') => {
    baseClose(reason)
    try { ch.close() } catch {}
  }
  return self
}

/** 把 BroadcastChannel 的可用性做成一次询问，UI 好据此决定要不要提示用户换浏览器 */
export function hasBroadcastTransport() {
  return typeof BroadcastChannel === 'function'
}
