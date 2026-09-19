// 纸上交锋 · PAPER STRIKE —— 双实例联机验收
// 用法：node tests/net-qa.js [url] [outDir]
//
// 开两个标签页，用真实的代码路径建链：广播通道一条、WebRTC 一条。
// 完全不需要第二台机器，也不需要 STUN —— host candidate 在同一台机器上必然可用。
//
// ⚠️ 这里能证明的是「**代码路径是通的**」，不是「两台电脑在同一个 wifi 下一定能连上」。
// 真实跨机、跨防火墙、以及聊天软件对邀请码的破坏，仍然只能靠人工验（见 SKILL.md）。
//
// 与 browser-qa.js 的连接方式不同，这里**不复用**它的 CDP 管道：
// 那个脚本连的是页面级 websocket，撑不起多 tab。改造它有两条路 ——
// 一是把 sessionId 穿进每个 send()（要动 363 行里最核心的一段），
// 二是浏览器级 ws 只用来 createTarget，每个 tab 各开各的页面级 ws。
// 走的是第二条：事件天然按连接分流，不用在 onmessage 里按 sessionId 分发，
// 而且 browser-qa.js 一行都不用改 —— 那是 36 项断言的验收闸门，不该为这个冒回归风险。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import http from 'node:http'

const URL_ARG = process.argv[2] || 'http://127.0.0.1:5173/'
const OUT = resolve(process.argv[3] || 'artifacts')
const PORT = Number(process.env.PS_CDP_PORT || 9445)   // 与 browser-qa 错开，两个脚本能同时跑

const CANDIDATES = [
  process.env.PS_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].filter(Boolean)

const browser = CANDIDATES.find((p) => existsSync(p))
if (!browser) {
  console.error('找不到可用的 Chrome / Edge，请用 PS_BROWSER 指定浏览器路径。')
  process.exit(2)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJson(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (r) => {
      let d = ''
      r.on('data', (c) => (d += c))
      r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } })
    }).on('error', rej)
  })
}

mkdirSync(OUT, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'ps-net-'))
const child = spawn(browser, [
  '--headless=new',
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--hide-scrollbars',
  // ⚠️ 这一条是 headless 下 WebRTC 能连上的关键，也是本脚本与 browser-qa 唯一有意义的差异。
  // Chrome 默认把 host candidate 里的局域网 IP 换成随机的 .local 域名（mDNS 混淆，防指纹追踪）。
  // 同机两个 tab 之间，这个 .local 名字经常解析不到，表现为「候选有、就是连不上」，
  // 极难查。关掉它，候选里就是老老实实的 IP。
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  '--window-size=1280,800',
  'about:blank'
], { stdio: 'ignore' })

// ---------------------------------------------------------------------------
// CDP：浏览器级连接（只用来开 tab）+ 每个 tab 一条页面级连接
// ---------------------------------------------------------------------------

let browserWs = null
for (let i = 0; i < 80 && !browserWs; i++) {
  await sleep(400)
  try {
    const v = await getJson('/json/version')
    if (v.webSocketDebuggerUrl) browserWs = v.webSocketDebuggerUrl
  } catch {}
}
if (!browserWs) {
  console.error('无法连接到浏览器调试端口')
  child.kill()
  process.exit(1)
}

/** 一条独立的 CDP 连接。每个 tab 一条，互不干扰 */
class Tab {
  constructor(ws, label) {
    this.ws = ws
    this.label = label
    this.msgId = 0
    this.pending = new Map()
    this.consoleErrors = []
    this.externalRequests = []
    this.targetOrigin = new URL(URL_ARG).origin
    ws.onmessage = (ev) => this._onMessage(ev)
  }

  _onMessage(ev) {
    const m = JSON.parse(ev.data)
    if (m.id && this.pending.has(m.id)) {
      this.pending.get(m.id)(m)
      this.pending.delete(m.id)
      return
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      this.consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      this.consoleErrors.push('EXCEPTION: ' + (d.exception?.description || d.text))
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      this.consoleErrors.push('LOG: ' + m.params.entry.text)
    }
    if (m.method === 'Network.requestWillBeSent') {
      const u = m.params.request.url
      if (/^https?:/i.test(u) && new URL(u).origin !== this.targetOrigin) this.externalRequests.push(u)
    }
  }

  send(method, params = {}) {
    const id = ++this.msgId
    return new Promise((res) => {
      this.pending.set(id, res)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    const ex = r.result?.exceptionDetails
    if (ex) throw new Error('[' + this.label + '] ' + ex.text + ' ' + (ex.exception?.description || ''))
    return r.result?.result?.value
  }

  async waitFor(expr, timeoutMs = 20000, interval = 250) {
    const deadline = Date.now() + timeoutMs
    let last
    while (Date.now() < deadline) {
      try { last = await this.evaluate(expr) } catch (e) { last = 'ERR ' + e.message }
      if (last) return last
      await sleep(interval)
    }
    return null
  }

  async screenshot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    if (!r.result?.data) return null
    writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'))
    return name
  }
}

/** 开一个新标签页并连上它。用浏览器级 ws 调 createTarget，再回 /json/list 取该 tab 的 ws 地址 */
async function openTab(label) {
  const bws = new WebSocket(browserWs)
  await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej })
  const created = await new Promise((res) => {
    bws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) res(m) }
    bws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank' } }))
  })
  bws.close()
  const targetId = created.result?.targetId
  if (!targetId) throw new Error('createTarget 失败：' + JSON.stringify(created))

  let info = null
  for (let i = 0; i < 40 && !info; i++) {
    await sleep(150)
    const list = await getJson('/json/list')
    info = list.find((t) => t.id === targetId && t.webSocketDebuggerUrl) || null
  }
  if (!info) throw new Error('拿不到新标签页的调试地址')

  const ws = new WebSocket(info.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const tab = new Tab(ws, label)
  await tab.send('Runtime.enable')
  await tab.send('Page.enable')
  await tab.send('Network.enable')
  await tab.send('Log.enable')
  return tab
}

/** 把 tab 导航到目标页面并等到开发钩子就位 */
async function load(tab) {
  await tab.send('Page.navigate', { url: URL_ARG })
  const ok = await tab.waitFor('!!(window.__PAPER_STRIKE__ && window.__PAPER_STRIKE__.state)', 30000)
  if (!ok) throw new Error('[' + tab.label + '] 页面没能加载出开发钩子')
}

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) })
  console.log((ok ? '\u2714 ' : '\u2716 ') + name + (detail ? '  ' + detail : ''))
}

// ---------------------------------------------------------------------------
// 开跑
// ---------------------------------------------------------------------------

let a = null
let b = null
try {
  a = await openTab('A')
  b = await openTab('B')
  await load(a)
  await load(b)
  check('两个标签页都加载出了开发钩子', true, 'A/B')

  // 让页面把模块挂到 window 上。Vite dev 会把 /src/**.js 当 ES 模块直接服务，
  // 所以这里 import 的就是**页面自己用的那份代码**，不是另拷一份逻辑
  for (const t of [a, b]) {
    await t.evaluate(`(async () => {
      window.__net = {
        transport: await import('/src/net/transport.js'),
        rtc: await import('/src/net/rtc-transport.js'),
        protocol: await import('/src/net/protocol.js')
      }
      return true
    })()`)
  }
  check('两端都能加载网络模块', true, 'transport / rtc / protocol')

  // ---- 1. 广播通道：证明上层收发链路是通的，且与 WebRTC 无关 ----
  await a.evaluate(`(() => {
    const m = window.__net.transport, p = window.__net.protocol
    window.__got = []
    window.__t = m.createBroadcastTransport({ roomId: 'ps-netqa', isHost: true, selfId: 'A' })
    window.__t.onMessage((x) => window.__got.push(x))
    return window.__t.state
  })()`)
  await b.evaluate(`(() => {
    const m = window.__net.transport, p = window.__net.protocol
    window.__got = []
    window.__t = m.createBroadcastTransport({ roomId: 'ps-netqa', isHost: false, selfId: 'B' })
    window.__t.onMessage((x) => window.__got.push(x))
    return window.__t.state
  })()`)
  await sleep(600)

  const bcastStates = (await a.evaluate('window.__t.state')) + '/' + (await b.evaluate('window.__t.state'))
  check('广播通道两端都进入 open', bcastStates === 'open/open', bcastStates)

  await a.evaluate(`(() => {
    const p = window.__net.protocol
    window.__t.send('reliable', p.msg(p.MSG.PING, { q: 42 }))
    window.__t.send('unreliable', p.msg(p.MSG.SNAPSHOT, { k: 7 }))
    return true
  })()`)
  await sleep(700)
  const bGot = await b.evaluate('window.__got.map(m => m.t + ":" + (m.q ?? m.k)).sort().join(",")')
  check('广播通道两个通道的报文都送到了对端', bGot === 'ping:42,snapshot:7', bGot)

  await b.evaluate(`(() => { window.__t.send('reliable', window.__net.protocol.msg('pong', { q: 42 })); return true })()`)
  await sleep(700)
  const aGot = await a.evaluate('window.__got.map(m => m.t).join(",")')
  check('广播通道反向也通', aGot === 'pong', aGot)

  // 坏包不该打断任何人 —— 这一条在浏览器里再验一次，因为真实链路上什么都会来
  await b.evaluate("window.__t._receive('{\\u0022v\\u0022:99}'); window.__t._receive('不是 JSON'); true")
  await sleep(200)
  const badState = await b.evaluate('window.__t.state + "|" + window.__t.stats.badPackets')
  check('浏览器里收到坏包只计数、不改状态', badState === 'open|2', badState)

  await a.evaluate('window.__t.close(); true')
  await b.evaluate('window.__t.close(); true')

  // ---- 2. WebRTC：真实的手动 SDP 交换，且中途故意按聊天软件的方式破坏它 ----
  const rtcSupported = await a.evaluate('window.__net.rtc.isRtcSupported()')
  if (!rtcSupported) {
    check('浏览器支持 RTCPeerConnection', false, '不支持，后面几条跳过')
  } else {
    check('浏览器支持 RTCPeerConnection', true)

    // 房主造邀请码
    const offer = await a.evaluate(`(async () => {
      window.__rt = window.__net.rtc.createRtcTransport({ isHost: true, iceServers: [] })
      window.__rgot = []
      window.__rt.onMessage((x) => window.__rgot.push(x))
      const r = await window.__net.rtc.buildOfferBlob(window.__rt)
      return { text: r.text, complete: r.complete, candidates: r.candidates.map(c => c.type) }
    })()`)
    check('房主生成邀请码', offer && offer.text && offer.text.startsWith('PS1-'),
      offer ? offer.text.length + ' 字符 / ' + offer.text.split('\n').length + ' 行' : 'null')
    check('邀请码收集到了网络候选', offer && offer.candidates && offer.candidates.length > 0,
      offer ? offer.candidates.join('/') : '无')

    // ⚠️ 关键一步：模拟聊天软件对邀请码的破坏。
    // 折行换成空格、-- 变 em dash、前后加话、引号包起来。
    // 四台机器上手工测这个要来回发好几轮微信，这里一次全验完
    const mangled = offer.text
      .replace(/\n/g, '\r\n')          // 换成另一种换行
      .replace(/-/g, '—')              // 全角破折号：微信/QQ 的智能标点最常干的事
      .replace(/—END$/, '-END')        // 但后缀得留个真的，好验证后缀路径
    const wrapped = '这是邀请码，你复制一下：\n' + mangled + '\n弄好了跟我说'

    const answer = await b.evaluate(`(async () => {
      window.__rt = window.__net.rtc.createRtcTransport({ isHost: false, iceServers: [] })
      window.__rgot = []
      window.__rt.onMessage((x) => window.__rgot.push(x))
      const r = await window.__net.rtc.acceptOfferBlob(window.__rt, ${JSON.stringify(wrapped)})
      return r.error ? { error: r.error } : { text: r.text, complete: r.complete }
    })()`)
    check('挑战者能吃下被聊天软件破坏过的邀请码', answer && answer.text,
      answer && answer.error ? answer.error : (answer.text.length + ' 字符'))

    // 应战码回程也破坏一次，用另一种破坏方式（折行 + 全角空格）
    const answerMangled = answer.text.replace(/\n/g, '　')
    const applied = await a.evaluate(`(async () => {
      const r = await window.__net.rtc.acceptAnswerBlob(window.__rt, ${JSON.stringify(answerMangled)})
      return r.error ? { error: r.error } : { ok: true }
    })()`)
    check('房主能吃下应战码', applied && applied.ok, applied && applied.error ? applied.error : 'ok')

    // 等真正连上
    const openA = await a.waitFor('window.__rt.state === "open"', 20000)
    const openB = await b.waitFor('window.__rt.state === "open"', 20000)
    check('两端都进入 open', !!(openA && openB),
      await a.evaluate('window.__rt.state') + ' / ' + await b.evaluate('window.__rt.state'))

    if (openA && openB) {
      const diag = await a.evaluate('window.__rt.diagnosis()')
      check('诊断信息里有候选类型与 ICE 状态', /候选：/.test(diag) && /ICE：/.test(diag),
        diag.split('\n').slice(1, 4).join(' | '))

      // 双向、双通道收发
      await a.evaluate(`(() => {
        const p = window.__net.protocol
        window.__rt.send('reliable', p.msg('hello', { n: 'A' }))
        window.__rt.send('unreliable', p.msg('snapshot', { k: 100 }))
        return true
      })()`)
      await sleep(900)
      const bGot2 = await b.evaluate('window.__rgot.map(m => m.t + ":" + (m.n ?? m.k)).sort().join(",")')
      check('WebRTC 两个通道的报文都送到了', bGot2 === 'hello:A,snapshot:100', bGot2)

      await b.evaluate(`(() => { window.__rt.send('reliable', window.__net.protocol.msg('hit', { dmg: 25 })); return true })()`)
      await sleep(900)
      const aGot2 = await a.evaluate('window.__rgot.map(m => m.t + ":" + m.dmg).join(",")')
      check('WebRTC 反向也通', aGot2 === 'hit:25', aGot2)

      await a.evaluate('window.__rt.refreshRtt()')
      const rtt = await a.evaluate('window.__rt.rttMs')
      check('能测出往返延迟', typeof rtt === 'number' && rtt >= 0, rtt + ' ms')

      await a.screenshot('net-01-offer')
      await b.screenshot('net-02-answer')

      // 断链要能被另一端感知
      await b.evaluate('window.__rt.close("测试收工"); true')
      const aSawClose = await a.waitFor('window.__rt.state === "closed" || window.__rt.state === "failed"', 12000)
      check('一端断开后另一端能感知到', !!aSawClose, await a.evaluate('window.__rt.state'))
    }

    await a.evaluate('try { window.__rt.close("收工") } catch {}; true')
    await b.evaluate('try { window.__rt.close("收工") } catch {}; true')
  }

  // ---- 3. 面板 UI：走用户真正走的那条路 ----
  // 上面那一段验的是模块接口，这一段验的是「用户点得通吗」。
  // 两者都要有：模块对了但按钮绑错，用户一样用不了。
  const click = (t, id) => t.evaluate(`(() => { const b = document.getElementById(${JSON.stringify(id)}); if (!b) return 'no-el'; b.click(); return 'ok' })()`)
  const val = (t, id) => t.evaluate(`document.getElementById(${JSON.stringify(id)}).value`)
  const setVal = (t, id, v) => t.evaluate(`(() => { document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)}; return true })()`)
  const status = (t) => t.evaluate(`document.getElementById('net-status').textContent`)
  const stepShown = (t, step) =>
    t.evaluate(`(() => { const s = document.querySelector('#net .net-step[data-step="${step}"]'); return !!s && !s.classList.contains('hidden') })()`)

  await click(a, 'btn-net')
  await click(b, 'btn-net')
  await sleep(300)
  check('两个标签页都能从准备页打开对战面板', await stepShown(a, 'role') && await stepShown(b, 'role'))

  // 房主：点「我是房主」→ 等邀请码填进文本框
  await click(a, 'btn-net-host')
  const offerReady = await a.waitFor('document.getElementById("offer-out").value.length > 0', 20000)
  const panelOffer = await val(a, 'offer-out')
  check('房主点一下就拿到了邀请码', !!offerReady && panelOffer.startsWith('PS1-'),
    panelOffer ? panelOffer.length + ' 字符' : '文本框是空的')
  await a.screenshot('net-03-panel-host')

  // 挑战者：粘贴 → 生成应战码
  await click(b, 'btn-net-guest')
  // 按微信的方式破坏一遍再粘进去：这就是用户实际会遇到的输入
  const wechat = '在吗，邀请码给你\n' + panelOffer.replace(/-/g, '—').replace(/\n/g, ' \n ')
  await setVal(b, 'offer-in', wechat)
  await click(b, 'btn-make-answer')
  const answerReady = await b.waitFor('document.getElementById("answer-out").value.length > 0', 20000)
  const panelAnswer = await val(b, 'answer-out')
  check('挑战者粘贴被破坏过的邀请码后拿到应战码', !!answerReady && panelAnswer.startsWith('PS1-'),
    panelAnswer ? panelAnswer.length + ' 字符' : await status(b))
  await b.screenshot('net-04-panel-guest')

  // 房主：粘贴应战码 → 应用
  await setVal(a, 'answer-in', panelAnswer.split('\n').join('\n> '))
  await click(a, 'btn-apply-answer')

  const linkedA = await a.waitFor('window.__PAPER_STRIKE__.netPanel.isLinked', 25000)
  const linkedB = await b.waitFor('window.__PAPER_STRIKE__.netPanel.isLinked', 25000)
  check('走完面板流程后两端都显示已连接', !!(linkedA && linkedB),
    await status(a) + ' | ' + await status(b))
  check('连上后面板切到「已连接」那一步', await stepShown(a, 'linked') && await stepShown(b, 'linked'))

  if (linkedA && linkedB) {
    // 用户实际踩到过的场景：第一次应用应战码成功后界面几秒没动静（正在打洞），
    // 于是又点了一次「应用应战码」。那时 signalingState 已经回到 stable，
    // 旧代码把浏览器的 `Called in wrong state: stable` 原样甩到了界面上。
    // 两道防线都要有：按钮锁住，且万一还是调到了传输层，给的必须是人话。
    check('应战码应用成功后「应用应战码」保持禁用，用户点不到第二次',
      (await a.evaluate('document.getElementById("btn-apply-answer").disabled')) === true)

    const reapply = await a.evaluate(`(async () => {
      try {
        await window.__PAPER_STRIKE__.netPanel.transport.acceptAnswer('v=0')
        return { threw: false, message: '' }
      } catch (e) { return { threw: true, message: e.message } }
    })()`)
    check('重复应用应战码时给的是人话，不是浏览器原始异常',
      reapply.threw && !/RTCPeerConnection|setRemoteDescription|Failed to execute/.test(reapply.message),
      reapply.message || '（没抛错，连接状态被改坏了）')

    await sleep(1500)   // 等一轮 RTT 刷新
    const info = await a.evaluate('document.getElementById("net-link-info").textContent')
    check('已连接页显示了身份、延迟与候选类型', /身份：/.test(info) && /延迟：/.test(info) && /候选：/.test(info), info)
    await a.screenshot('net-05-panel-linked')

    // 面板持有的连接必须真的能用，而不只是界面显示「已连接」
    const liveMsgs = await a.evaluate(`(() => {
      const t = window.__PAPER_STRIKE__.netPanel.transport
      window.__live = []
      return !!t
    })()`)
    await b.evaluate(`(() => {
      window.__PAPER_STRIKE__.netPanel.transport.onMessage((m) => (window.__live = window.__live || []).push(m))
      return true
    })()`)
    await a.evaluate(`(() => {
      const p = window.__net.protocol
      window.__PAPER_STRIKE__.netPanel.transport.send('reliable', p.msg('hello', { n: 'panel' }))
      return true
    })()`)
    await sleep(900)
    const panelGot = await b.evaluate('(window.__live || []).map(m => m.t + ":" + m.n).join(",")')
    check('面板建立的那条连接真的能传数据', liveMsgs && panelGot === 'hello:panel', panelGot)

    // 点「进入决斗场地」应该真的进决斗
    await click(a, 'btn-net-start')
    await sleep(1800)
    const inDuel = await a.evaluate('JSON.stringify({ s: window.__PAPER_STRIKE__.state(), m: window.__PAPER_STRIKE__.snapshot().mode })')
    check('房主可以直接从面板进入决斗场地', inDuel === '{"s":"playing","m":"duel"}', inDuel)
    await a.screenshot('net-06-panel-duel')
  }

  // 退回准备页必须把连接也断掉 —— 留着 PeerConnection 会继续持有网络探测
  await b.evaluate('document.getElementById("btn-net-back").click(); true')
  await sleep(400)
  const closedAfterBack = await b.evaluate('window.__PAPER_STRIKE__.netPanel.transport')
  check('退回准备页会把连接一起断掉', closedAfterBack === null,
    closedAfterBack === null ? '连接已释放' : '仍然持有 transport')

  // ---- 4. 全程没有跨源请求 ----
  const ext = [...a.externalRequests, ...b.externalRequests]
  check('两端都没有发出跨源请求', ext.length === 0, ext.slice(0, 3).join(' '))

  const errs = [...a.consoleErrors, ...b.consoleErrors]
  check('两端控制台都没有错误', errs.length === 0, errs.slice(0, 3).join(' | '))
} catch (err) {
  check('执行过程未抛异常', false, err.message)
  if (a) await a.screenshot('net-crash-A').catch(() => {})
  if (b) await b.screenshot('net-crash-B').catch(() => {})
} finally {
  const pass = results.filter((r) => r.ok).length
  writeFileSync(join(OUT, 'net-report.json'), JSON.stringify({
    url: URL_ARG, results, pass, total: results.length
  }, null, 2))
  console.log('\n通过 ' + pass + '/' + results.length)
  try { child.kill() } catch {}
  await sleep(400)
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
  process.exit(pass === results.length ? 0 : 1)
}
