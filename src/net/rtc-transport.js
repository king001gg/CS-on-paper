// 纸上交锋 · PAPER STRIKE —— WebRTC 传输
//
// 这是 transport.js 那个接口的第三个实现，也是唯一一个碰真实网络的。
// 它是**唯一**允许出现 RTCPeerConnection 的地方 —— 上层只认 Transport 接口这条铁律
// 一旦破掉，回环与广播带来的测试能力就全部作废。
//
// 三条设计约束，每条都有代价，都写在这里免得后人重新踩：
//
// 1. **非 trickle（vanilla ICE）**：等 iceGatheringState 变成 complete 才把 SDP 交出去。
//    trickle 要额外传 candidate，而我们的信令是「用户手动复制一条消息」——
//    每来一个 candidate 就让用户复制一次，这个 UX 不可接受。代价是建链慢几百毫秒。
// 2. **iceServers 默认空数组**：零外部请求，代价是只能同局域网直连（见 describeIceError）。
//    绝不在代码里硬编码 STUN 地址；要用必须是用户自己在面板里填的。
// 3. **房主发起，挑战者应答**：只有发起方 createDataChannel，应答方走 ondatachannel 收。
//    两边都建通道会需要重新协商，那是另一套复杂度，不在本期内。

import { Transport, TRANSPORT_STATE, CHANNEL } from './transport.js'
import { encodeSignal, decodeSignal, describeIceError } from './signaling.js'

/** 单条消息的兜底上限。真正的上限由 SCTP 协商决定（见 _maxMessageSize） */
const FALLBACK_MAX_MESSAGE = 64 * 1024
/** 不可靠通道积压超过这个量就丢新包 —— 链路卡住时保护内存，别让它无限涨 */
const MAX_BUFFERED = 1024 * 1024

export function isRtcSupported() {
  return typeof RTCPeerConnection === 'function'
}

export class RtcTransport extends Transport {
  constructor({ iceServers = [], gatherTimeoutMs = 8000, isHost = false } = {}) {
    super({ isHost })
    if (!isRtcSupported()) throw new Error('当前浏览器不支持 RTCPeerConnection')

    this.gatherTimeoutMs = gatherTimeoutMs
    this._channels = { [CHANNEL.RELIABLE]: null, [CHANNEL.UNRELIABLE]: null }
    this._candidates = []
    this._rttMs = null
    this._maxMessageSize = FALLBACK_MAX_MESSAGE
    this._opened = new Set()

    // 空 iceServers 是刻意的：本轮不引入任何第三方服务，代价见文件头
    this.pc = new RTCPeerConnection({ iceServers })
    this.pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      const c = ev.candidate
      // 只留下类型与协议用于诊断展示，**绝不保存 address** ——
      // 那里面是用户的内网 IP，而「复制诊断信息」按钮会把它带到聊天窗口里
      this._candidates.push({ type: c.type, protocol: c.protocol })
    }
    this.pc.oniceconnectionstatechange = () => this._onIceState()
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') this._onIceState(true)
    }
    // 只有应答方会走到这里：发起方自己建的通道不会触发 ondatachannel
    this.pc.ondatachannel = (ev) => this._bindChannel(ev.channel)
  }

  get iceState() { return this.pc.iceConnectionState }
  get candidates() { return this._candidates.slice() }
  get rttMs() { return this._rttMs }
  get localSdp() { return this.pc.localDescription ? this.pc.localDescription.sdp : null }

  /**
   * ⚠️ `disconnected` 不当失败处理。
   * 它是**常见且可自愈**的中间态（网络抖动、对方短暂卡顿都会触发），
   * 几秒内自己回到 connected 是常态。把它判死是 WebRTC 的经典误用 ——
   * 真正该放弃的是 `failed`，那时 ICE 已经走完重试流程了。
   */
  _onIceState(forceFailed = false) {
    const s = this.pc.iceConnectionState
    if (this._closed) return
    if (s === 'failed' || forceFailed) {
      this._setState(TRANSPORT_STATE.FAILED, describeIceError('failed', this._candidates))
    } else if (s === 'disconnected') {
      this._setState(this._state, describeIceError('disconnected', this._candidates))
    } else if (s === 'closed') {
      this._setState(TRANSPORT_STATE.CLOSED, '连接已关闭')
    }
  }

  /** 通道绑定：发起方建完就调，应答方在 ondatachannel 里调 */
  _bindChannel(ch) {
    const which = ch.label === CHANNEL.UNRELIABLE ? CHANNEL.UNRELIABLE : CHANNEL.RELIABLE
    this._channels[which] = ch
    ch.binaryType = 'arraybuffer'
    ch.onopen = () => {
      this._opened.add(which)
      // 两条通道都开了才算连上。只开一条也能用，但少一条说明协商出了岔子，
      // 这时报「已连接」会让后面丢包丢得莫名其妙
      if (this._opened.size === 2) this._setState(TRANSPORT_STATE.OPEN, this._describeLink())
    }
    ch.onclose = () => {
      this._opened.delete(which)
      if (!this._closed) this._setState(TRANSPORT_STATE.CLOSED, '数据通道被对方关闭')
    }
    ch.onerror = (ev) => {
      this._setState(this._state, '数据通道出错：' + (ev && ev.error ? ev.error.message : '未知'))
    }
    ch.onmessage = (ev) => this._receive(typeof ev.data === 'string' ? ev.data : '')
  }

  _rawSend(channel, text) {
    const ch = this._channels[channel] || this._channels[CHANNEL.RELIABLE]
    if (!ch || ch.readyState !== 'open') {
      this._stats.dropped++
      return
    }
    // 积压太深说明链路已经跟不上了。继续往里塞只会让内存涨到崩，
    // 而快照本来就是「旧了就不值钱」的数据 —— 丢掉是正确的处置
    if (ch.bufferedAmount > MAX_BUFFERED && channel === CHANNEL.UNRELIABLE) {
      this._stats.dropped++
      return
    }
    if (text.length > this._maxMessageSize) {
      this._stats.dropped++
      return
    }
    try {
      ch.send(text)
    } catch {
      // 通道可能刚好在这两行之间关掉。发送失败不该影响渲染循环
      this._stats.dropped++
    }
  }

  /** 造邀请：建房主的两条通道 → 生成 offer → 等候选收完 */
  async createOffer() {
    this._setState(TRANSPORT_STATE.GATHERING, '正在收集网络候选…')
    this._makeChannel(CHANNEL.RELIABLE, { ordered: true })
    this._makeChannel(CHANNEL.UNRELIABLE, { ordered: false, maxRetransmits: 0 })

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    const complete = await this._waitForIce()
    this._setState(TRANSPORT_STATE.OFFER_READY, complete ? '' : '候选收集超时')
    return { sdp: this.localSdp, complete }
  }

  /**
   * 不可靠通道的降级：如果浏览器不接受 maxRetransmits，就退成「无序但可靠」。
   * 语义会变（丢帧变成重传，延迟抖动变大），但比整条通道建不起来强得多。
   */
  _makeChannel(label, opts) {
    let ch
    try {
      ch = this.pc.createDataChannel(label, opts)
    } catch {
      ch = this.pc.createDataChannel(label, { ordered: false })
    }
    this._bindChannel(ch)
    return ch
  }

  /** 接邀请 → 生成应战。返回应战码用的 SDP */
  async acceptOffer(sdp) {
    this._setState(TRANSPORT_STATE.GATHERING, '正在收集网络候选…')
    await this.pc.setRemoteDescription({ type: 'offer', sdp })
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    const complete = await this._waitForIce()
    this._setState(TRANSPORT_STATE.ANSWER_READY, complete ? '' : '候选收集超时')
    return { sdp: this.localSdp, complete }
  }

  /** 接应战：双方描述齐了，开始打洞 */
  async acceptAnswer(sdp) {
    await this.pc.setRemoteDescription({ type: 'answer', sdp })
    const max = this.pc.sctp && this.pc.sctp.maxMessageSize
    if (max) this._maxMessageSize = Math.min(max, FALLBACK_MAX_MESSAGE)
    this._setState(TRANSPORT_STATE.CONNECTING, '正在打洞…')
  }

  /**
   * 等候选收集完毕。
   *
   * ⚠️ 必须先查一次当前状态：iceGatheringState 可能**在我们挂上监听之前**
   * 就已经是 complete 了（加速网卡、纯 host 候选、本机回环都会这么快），
   * 那样只挂监听会一直等到超时，然后报一个根本不存在的「超时」。
   */
  _waitForIce() {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve(true)
    return new Promise((resolve) => {
      let timer = null
      // 只还原自己套的那一层，别把构造函数里记录候选的处理器一并清掉 ——
      // 超时收场时收集可能还没真的结束，那些候选正是诊断要用的
      const prev = this.pc.onicecandidate
      const done = (ok) => {
        if (timer !== null) clearTimeout(timer)
        this.pc.removeEventListener('icegatheringstatechange', onChange)
        this.pc.onicecandidate = prev
        resolve(ok)
      }
      // onicecandidate 的 null 候选是「收集结束」的另一个信号，两个都听更稳
      this.pc.onicecandidate = (ev) => {
        if (prev) prev(ev)
        if (!ev.candidate) done(true)
      }
      const onChange = () => {
        if (this.pc.iceGatheringState === 'complete') done(true)
      }
      this.pc.addEventListener('icegatheringstatechange', onChange)
      timer = setTimeout(() => done(false), this.gatherTimeoutMs)
    })
  }

  /** 拉一次 RTT。UI 每秒调一次即可 —— getStats 不便宜，别每帧调 */
  async refreshRtt() {
    if (this._closed || typeof this.pc.getStats !== 'function') return null
    try {
      const stats = await this.pc.getStats()
      let best = null
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number') {
          if (best === null || r.currentRoundTripTime < best) best = r.currentRoundTripTime
        }
      })
      this._rttMs = best === null ? null : Math.round(best * 1000)
    } catch {
      // 连接正在关闭时 getStats 会抛，不值得打断 UI
    }
    return this._rttMs
  }

  _describeLink() {
    const kinds = [...new Set(this._candidates.map((c) => c.type))].join('/') || '未知'
    const rtt = this._rttMs === null ? '' : '，延迟 ' + this._rttMs + ' ms'
    return '候选：' + kinds + rtt
  }

  /**
   * 覆盖基类：把只有 RTC 才知道的东西加进诊断信息。
   * 连不上时用户能把这坨复制给我们，比「连不上」三个字有用得多。
   */
  diagnosis() {
    const kinds = [...new Set(this._candidates.map((c) => c.type))].join('/') || '无'
    return [
      super.diagnosis(),
      'ICE：' + this.pc.iceConnectionState + ' / 收集 ' + this.pc.iceGatheringState,
      '连接：' + this.pc.connectionState,
      '候选：' + this._candidates.length + ' 条（' + kinds + '）',
      '延迟：' + (this._rttMs === null ? '未测出' : this._rttMs + ' ms')
    ].join('\n')
  }

  close(reason = '') {
    if (this._closed) return
    for (const which of [CHANNEL.RELIABLE, CHANNEL.UNRELIABLE]) {
      const ch = this._channels[which]
      if (ch) { try { ch.close() } catch {} }
    }
    try { this.pc.close() } catch {}
    super.close(reason)
  }
}

export function createRtcTransport(opts = {}) {
  return new RtcTransport(opts)
}

// ---------------------------------------------------------------------------
// 邀请码 / 应战码：把传输层与信令层的字符串工程接起来
// ---------------------------------------------------------------------------

/**
 * 房主：造邀请码。
 * 返回 { text, complete, candidates } —— complete 为 false 表示候选没收完就发出去了，
 * UI 必须把这个警告显式告诉用户，而不是让他拿着一份残缺的邀请码去排查半天。
 */
export async function buildOfferBlob(t) {
  const { sdp, complete } = await t.createOffer()
  const text = await encodeSignal({ t: 'offer', sdp })
  return { text, complete, candidates: t.candidates }
}

/** 挑战者：吃邀请码，吐出应战码 */
export async function acceptOfferBlob(t, text) {
  const o = await decodeSignal(text)
  if (!o || o.t !== 'offer' || typeof o.sdp !== 'string') {
    return { error: '这段文本不是有效的邀请码。请确认完整复制了以 PS1- 开头、以 -END 结尾的那一整段。' }
  }
  const { sdp, complete } = await t.acceptOffer(o.sdp)
  const out = await encodeSignal({ t: 'answer', sdp })
  return { text: out, complete, candidates: t.candidates }
}

/** 房主：吃应战码，打通 */
export async function acceptAnswerBlob(t, text) {
  const o = await decodeSignal(text)
  if (!o || o.t !== 'answer' || typeof o.sdp !== 'string') {
    return { error: '这段文本不是有效的应战码。请确认完整复制了以 PS1- 开头、以 -END 结尾的那一整段。' }
  }
  await t.acceptAnswer(o.sdp)
  return { ok: true }
}
