// 纸上交锋 · PAPER STRIKE —— 双人对战面板
//
// 把「手动交换邀请码」这件事做成一个用户在几步之内能走完的流程。
// 这个文件只碰 DOM 与 net/ 那一层，游戏逻辑通过回调交回 main.js ——
// 面板不该知道 startGame 是怎么回事。
//
// 一条硬性约束贯穿全文件：**没点「我是房主 / 我是挑战者」之前，
// 绝不 new RTCPeerConnection**。单人模式必须保持「全程零外部请求」这个可证命题，
// 而 RTCPeerConnection 一建就会开始探网络。browser-qa 里有一条断言专门盯着这件事。

import { createRtcTransport, buildOfferBlob, acceptOfferBlob, acceptAnswerBlob, isRtcSupported } from './net/rtc-transport.js'
import { describeIceError, copyText } from './net/signaling.js'
import { TRANSPORT_STATE } from './net/transport.js'

const STEP = { ROLE: 'role', HOST: 'host', GUEST: 'guest', LINKED: 'linked' }

/**
 * 解析用户填的 STUN 地址。
 * 只认 stun: / stuns: 两种协议 —— 输入框里的东西会被直接交给浏览器去连，
 * 不校验的话它就成了一条「页面往任意地址发请求」的口子。
 * 地址由用户自己提供，本项目不内置任何一个。
 */
export function parseStunList(text) {
  const urls = String(text || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^stuns?:[^\s]+$/i.test(s))
  return urls.length ? [{ urls }] : []
}

export function createNetPanel({ onStartDuel, onBack } = {}) {
  const $ = (id) => document.getElementById(id)
  const el = {
    status: $('net-status'),
    linkInfo: $('net-link-info'),
    offerOut: $('offer-out'),
    answerIn: $('answer-in'),
    offerIn: $('offer-in'),
    answerOut: $('answer-out'),
    stun: $('net-stun'),
    steps: Array.from(document.querySelectorAll('#net .net-step'))
  }
  const btn = {
    host: $('btn-net-host'),
    guest: $('btn-net-guest'),
    copyOffer: $('btn-copy-offer'),
    applyAnswer: $('btn-apply-answer'),
    makeAnswer: $('btn-make-answer'),
    copyAnswer: $('btn-copy-answer'),
    start: $('btn-net-start'),
    diag: $('btn-net-diag'),
    back: $('btn-net-back')
  }

  let transport = null
  let rttTimer = null
  let offState = null
  let busy = false
  /** 应战码是否已经成功应用过一次。成功后「应用应战码」要一直禁用，见 setBusy */
  let answerApplied = false

  function setStep(step) {
    for (const s of el.steps) s.classList.toggle('hidden', s.dataset.step !== step)
  }

  /** kind: '' | 'ok' | 'error'。状态行是失败时唯一能说明「卡在哪」的东西，别让它沉默 */
  function setStatus(text, kind = '') {
    if (!el.status) return
    el.status.textContent = text
    el.status.classList.toggle('is-error', kind === 'error')
    el.status.classList.toggle('is-ok', kind === 'ok')
  }

  /** 把按钮锁住，防止用户在异步过程中连点 —— 重复建 PeerConnection 会留下野连接 */
  function setBusy(on) {
    busy = on
    for (const b of Object.values(btn)) {
      if (!b) continue
      // 「应用应战码」成功之后要一直禁用：打洞要好几秒，用户看界面没动静就会再点一次，
      // 而那时 signalingState 已经回到 stable，第二次只会拿到一句浏览器原始异常。
      b.disabled = on || (b === btn.applyAnswer && answerApplied)
    }
    if (btn.back) btn.back.disabled = false    // 返回永远可用，卡住时用户得能退出来
  }

  async function copy(label, text) {
    if (!text) { setStatus('还没有内容可以复制。', 'error'); return }
    const r = await copyText(text)
    if (r.ok) setStatus(label + '已复制到剪贴板。', 'ok')
    else setStatus('浏览器不允许自动复制。请手动选中上面的文本框，按 Ctrl+C 复制。', 'error')
  }

  function dropTransport() {
    if (rttTimer) { clearInterval(rttTimer); rttTimer = null }
    if (offState) { offState(); offState = null }
    if (transport) { try { transport.close('面板关闭') } catch {} transport = null }
    // 每次「重开一条连接」（open/close/选身份）都算重新开始，把成功标记一并清掉
    answerApplied = false
  }

  function watch(t) {
    offState = t.onState((state, detail) => {
      switch (state) {
        case TRANSPORT_STATE.OPEN:
          setStep(STEP.LINKED)
          setStatus('已连接。', 'ok')
          updateLinkInfo()
          // getStats 不便宜，1 秒一次足够；UI 上延迟只是给人一个「链路还活着」的信号
          if (rttTimer) clearInterval(rttTimer)
          rttTimer = setInterval(async () => { await t.refreshRtt(); updateLinkInfo() }, 1000)
          break
        case TRANSPORT_STATE.FAILED:
          setStatus(detail || describeIceError('failed', t.candidates), 'error')
          break
        case TRANSPORT_STATE.CLOSED:
          if (transport === t) setStatus(detail || '连接已断开。', 'error')
          break
        default:
          if (detail) setStatus(detail)
      }
    })
  }

  function updateLinkInfo() {
    if (!el.linkInfo) return
    if (!transport) { el.linkInfo.textContent = '通道已建立。'; return }
    const kinds = [...new Set(transport.candidates.map((c) => c.type))].join(' / ') || '未知'
    const rtt = transport.rttMs === null ? '测量中' : transport.rttMs + ' ms'
    el.linkInfo.textContent = '身份：' + (transport.isHost ? '房主' : '挑战者') +
      ' · 延迟：' + rtt + ' · 网络候选：' + kinds
  }

  /** 房主：开通道、造邀请码 */
  async function host() {
    if (busy) return
    setBusy(true)
    dropTransport()
    try {
      setStep(STEP.HOST)
      setStatus('正在收集网络候选…')
      transport = createRtcTransport({ isHost: true, iceServers: parseStunList(el.stun && el.stun.value) })
      watch(transport)
      const r = await buildOfferBlob(transport)
      if (el.offerOut) el.offerOut.value = r.text
      if (!r.complete) {
        setStatus('网络候选没收完就超时了。邀请码仍然可以发出去，但对方可能连不上 —— 失败的话请检查两台电脑是否在同一个局域网。', 'error')
      } else if (r.candidates.length === 0) {
        setStatus('没收集到任何网络候选，对方多半连不上。请确认本机网络正常。', 'error')
      } else {
        setStatus('邀请码已生成。整段复制发给对方，然后把对方回给你的应战码粘到下面。', 'ok')
      }
    } catch (err) {
      setStatus('生成邀请码失败：' + err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** 挑战者：吃邀请码、造应战码 */
  async function makeAnswer() {
    if (busy) return
    const text = el.offerIn ? el.offerIn.value : ''
    if (!text.trim()) { setStatus('请先把房主发来的邀请码粘到上面的文本框里。', 'error'); return }
    setBusy(true)
    dropTransport()
    try {
      setStatus('正在解析邀请码…')
      transport = createRtcTransport({ isHost: false, iceServers: parseStunList(el.stun && el.stun.value) })
      watch(transport)
      const r = await acceptOfferBlob(transport, text)
      if (r.error) {
        setStatus(r.error, 'error')
        dropTransport()
        return
      }
      if (el.answerOut) el.answerOut.value = r.text
      setStatus(r.complete
        ? '应战码已生成。整段复制发回给房主，等对方应用之后就会自动连上。'
        : '网络候选没收完就超时了，应战码可能连不上。', r.complete ? 'ok' : 'error')
    } catch (err) {
      setStatus('生成应战码失败：' + err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** 房主：吃应战码，开始打洞 */
  async function applyAnswer() {
    if (busy) return
    const text = el.answerIn ? el.answerIn.value : ''
    if (!text.trim()) { setStatus('请先把对方发回来的应战码粘到上面的文本框里。', 'error'); return }
    if (!transport) { setStatus('连接已经失效，请回到第 1 步重新生成邀请码。', 'error'); return }
    setBusy(true)
    try {
      setStatus('正在解析应战码…')
      const r = await acceptAnswerBlob(transport, text)
      if (r.error) { setStatus(r.error, 'error'); return }
      // 只有**成功**才上锁。应战码有误时 setRemoteDescription 会拒绝而状态不变，
      // 那种情况下用户必须还能改完再试一次。
      answerApplied = true
      setStatus('正在打洞，通常几秒内完成…如果一直连不上，请点「返回准备页」重新来一次。')
    } catch (err) {
      setStatus('应用应战码失败：' + err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function copyDiagnosis() {
    const text = transport
      ? transport.diagnosis()
      : '还没有建立任何连接。\n页面地址：' + location.href + '\n环境支持 RTCPeerConnection：' + isRtcSupported()
    const r = await copyText(text)
    setStatus(r.ok ? '诊断信息已复制。连不上的话把它发给对方或开发者，比「连不上」三个字有用得多。'
      : '浏览器不允许自动复制，请手动选中后按 Ctrl+C。', r.ok ? 'ok' : 'error')
  }

  /** 每次打开面板都回到干净状态：上一次的邀请码留在这里只会让人误用 */
  function open() {
    dropTransport()
    setBusy(false)
    if (el.offerOut) el.offerOut.value = ''
    if (el.answerIn) el.answerIn.value = ''
    if (el.offerIn) el.offerIn.value = ''
    if (el.answerOut) el.answerOut.value = ''

    if (!isRtcSupported()) {
      setStep(STEP.ROLE)
      setStatus('这个浏览器不支持 WebRTC 直连，没法对战。请换用较新的 Chrome 或 Edge。', 'error')
      if (btn.host) btn.host.disabled = true
      if (btn.guest) btn.guest.disabled = true
      return
    }
    setStep(STEP.ROLE)
    setStatus('选择身份开始。两台电脑要在同一个局域网下，并且都打开这个页面。')
  }

  function close() {
    dropTransport()
    setStep(STEP.ROLE)
    setStatus('选择身份开始。')
  }

  // -------------------------------------------------------------------------
  btn.host && (btn.host.onclick = host)
  btn.guest && (btn.guest.onclick = () => {
    if (busy) return
    dropTransport()
    setStep(STEP.GUEST)
    setStatus('把房主发来的邀请码整段粘到下面的文本框，然后点「生成应战码」。')
  })
  btn.makeAnswer && (btn.makeAnswer.onclick = makeAnswer)
  btn.applyAnswer && (btn.applyAnswer.onclick = applyAnswer)
  btn.copyOffer && (btn.copyOffer.onclick = () => copy('邀请码', el.offerOut && el.offerOut.value))
  btn.copyAnswer && (btn.copyAnswer.onclick = () => copy('应战码', el.answerOut && el.answerOut.value))
  btn.diag && (btn.diag.onclick = copyDiagnosis)
  btn.back && (btn.back.onclick = () => { close(); if (onBack) onBack() })
  btn.start && (btn.start.onclick = () => { if (!busy && onStartDuel) onStartDuel() })

  return {
    open,
    close,
    get transport() { return transport },
    get isLinked() { return !!transport && transport.state === TRANSPORT_STATE.OPEN },
    /** 面板被拆掉时（例如页面切走了）确保定时器与连接都收干净 */
    dispose() { dropTransport() }
  }
}
