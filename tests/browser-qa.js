// 纸上交锋 · PAPER STRIKE —— 可选的开发期浏览器验收辅助脚本
// 用法：node tests/browser-qa.js [url] [outDir]
// 依赖本机安装的 Chrome / Edge（也可用 PS_BROWSER 环境变量指定路径）。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import http from 'node:http'

const URL_ARG = process.argv[2] || 'http://127.0.0.1:5173/'
const OUT = resolve(process.argv[3] || 'artifacts')
const PROD = process.argv.includes('--prod')
const TARGET_ORIGIN = new URL(URL_ARG).origin
const PORT = Number(process.env.PS_CDP_PORT || 9444)

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
const profile = mkdtempSync(join(tmpdir(), 'ps-qa-'))
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
  '--window-size=1280,800',
  'about:blank'
], { stdio: 'ignore' })

let target = null
for (let i = 0; i < 80 && !target; i++) {
  await sleep(400)
  try {
    const list = await getJson('/json/list')
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null
  } catch {}
}
if (!target) {
  console.error('无法连接到浏览器调试端口')
  child.kill()
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
const consoleErrors = []
const consoleLogs = []
const failedRequests = []
const externalRequests = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
    return
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')
    consoleLogs.push(m.params.type + ': ' + text)
    if (m.params.type === 'error') consoleErrors.push(text)
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    consoleErrors.push('EXCEPTION: ' + (d.exception?.description || d.text))
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    consoleErrors.push('LOG: ' + m.params.entry.text)
  }
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
    const r = m.params.response
    failedRequests.push('HTTP ' + r.status + ': ' + r.url)
  }
  if (m.method === 'Network.loadingFailed') {
    failedRequests.push(m.params.errorText)
  }
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url
    // Local preview and public Pages are both valid; only cross-origin resources are unexpected.
    if (/^https?:/i.test(u) && new URL(u).origin !== TARGET_ORIGIN) externalRequests.push(u)
  }
}
function send(method, params = {}) {
  const id = ++msgId
  return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''))
  return r.result?.result?.value
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (!r.result?.data) return null
  const file = join(OUT, name + '.png')
  writeFileSync(file, Buffer.from(r.result.data, 'base64'))
  return file
}

async function clickSelector(selector) {
  const expr = '(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()'
  const box = await evaluate(expr)
  if (!box) throw new Error('找不到元素 ' + selector)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
}

async function waitFor(expr, timeoutMs = 25000, interval = 400) {
  const t0 = Date.now()
  for (;;) {
    const v = await evaluate(expr)
    if (v) return v
    if (Date.now() - t0 > timeoutMs) return null
    await sleep(interval)
  }
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log((ok ? '✔ ' : '✖ ') + name + (detail ? '  ' + detail : ''))
}

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
// 装一个哨兵，统计页面一共 new 了几次 RTCPeerConnection。
// 这是「单人模式仍然全程离线」这个可证命题的**替代品**：
// WebRTC 走 UDP，Network.requestWillBeSent 根本看不见它，
// 所以原有的「无跨源请求」断言在引入联机之后不再能证明「离线」这个性质。
// 页面脚本执行之前就要装好，否则会漏掉最早的几次构造。
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__RTC_COUNT__ = 0;
    (function () {
      var Real = window.RTCPeerConnection;
      if (!Real) return;
      window.RTCPeerConnection = function () {
        window.__RTC_COUNT__++;
        return new Real(...arguments);
      };
    })();`
})
await send('Page.navigate', { url: URL_ARG })
await sleep(3500)

const title = await evaluate('document.title')
check('页面加载并渲染标题', title === '纸上交锋 · PAPER STRIKE', title)

if (PROD) {
  // 生产构建验收：不包含开发入口，也不能依赖任何外网资源
  const hookType = await evaluate('typeof window.__PAPER_STRIKE__')
  check('生产构建不包含开发/作弊入口', hookType === 'undefined', hookType)
  await shot('prod-01-menu')
  await clickSelector('#btn-start')
  await sleep(2500)
  const hudShown = await evaluate('!document.getElementById("hud").classList.contains("hidden")')
  check('生产构建可以进入游戏', hudShown === true)
  await shot('prod-02-hud')
  const canvasOk = await evaluate('(function(){ const c = document.getElementById("game-canvas"); const gl = c.getContext("webgl2") || c.getContext("webgl"); return !!gl && c.width > 0 && c.height > 0 })()')
  check('画布已创建 WebGL 上下文', canvasOk === true)

  // 对战面板在**优化构建**里也要能用。这一段特别值得跑：
  // 开发钩子被剥掉之后，面板走的全是生产路径，而 WebRTC 那一层不依赖任何 dev 设施。
  // 「本地能连、发出去就连不上」这类问题，只有在这里才照得出来。
  //
  // ⚠️ 必须先重新加载回到准备页：上面已经进了游戏，#menu 是隐藏的，
  // 而 #btn-net 在 #menu 里面 —— 隐藏元素的包围盒是零尺寸，
  // 合成点击会落到 (0,0)，点了等于没点，而且**不报错**。
  await send('Page.navigate', { url: URL_ARG })
  await sleep(3000)
  await clickSelector('#btn-net')
  await sleep(600)
  check('生产构建能打开对战面板', (await evaluate('!document.getElementById("net").classList.contains("hidden")')) === true)
  await clickSelector('#btn-net-host')
  // waitFor 返回的是那个表达式的值，也就是 true/false，不是文本框内容 —— 内容要另取一次
  const offerFilled = await waitFor('document.getElementById("offer-out").value.length > 0', 25000)
  const prodOffer = await evaluate('document.getElementById("offer-out").value')
  check('生产构建里也能生成邀请码', !!offerFilled && typeof prodOffer === 'string' && prodOffer.startsWith('PS1-'),
    prodOffer ? prodOffer.length + ' 字符 / ' + prodOffer.split('\n').length + ' 行' : '文本框是空的')
  await shot('prod-03-net')

  await sleep(1200)
  check('生产构建没有控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  check('没有加载跨源第三方资源', externalRequests.length === 0, externalRequests.slice(0, 3).join(' | '))
  check('没有失败的网络请求', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '))
  writeFileSync(join(OUT, 'qa-report-prod.json'), JSON.stringify({ url: URL_ARG, results, consoleErrors, externalRequests, failedRequests }, null, 2))
  const bad = results.filter((r) => !r.ok)
  console.log('\n生产构建检查通过 ' + (results.length - bad.length) + '/' + results.length)
  ws.close()
  child.kill()
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
  process.exit(bad.length ? 1 : 0)
}

const hasHook = await evaluate('typeof window.__PAPER_STRIKE__ === "object"')
check('开发模式验收入口可用', hasHook === true, consoleErrors.slice(0, 3).join(' | ') || consoleLogs.slice(0, 5).join(' | '))
if (!hasHook) {
  console.log('页面日志：\n' + consoleLogs.join('\n'))
  console.log('错误：\n' + consoleErrors.join('\n'))
  ws.close()
  child.kill()
  process.exit(1)
}

await shot('01-menu')
const menuVisible = await evaluate('!document.getElementById("menu").classList.contains("hidden")')
check('准备页可见', menuVisible === true)

// 进入游戏（真实点击「进入训练场」）
await clickSelector('#btn-start')
await sleep(2200)
let snap = await evaluate('window.__PAPER_STRIKE__.snapshot()')
check('进入游戏状态', snap.state === 'playing', JSON.stringify(snap.state))
check('初始弹药为满弹匣', snap.ammo.smg === 30 && snap.ammo.sniper === 5, JSON.stringify(snap.ammo))
check('八名敌人就位', snap.enemiesAlive === 8, String(snap.enemiesAlive))

await evaluate('window.__PAPER_STRIKE__.setFire(true)')
await sleep(2600)
await evaluate('window.__PAPER_STRIKE__.setFire(false)')
snap = await evaluate('window.__PAPER_STRIKE__.snapshot()')
check('冲锋枪按住连射会消耗弹药', snap.ammo.smg < 30, '剩余 ' + snap.ammo.smg)
check('射击会统计到命中率分母', snap.shots >= 3, 'shots=' + snap.shots)
await shot('02-hud-firefight')

// 找一名敌人对准并开火
const aim = await evaluate('(() => { const a = window.__PAPER_STRIKE__; const s = a.snapshot(); const idx = s.enemyStates.findIndex(e => e.a); a.teleport(0, 19); a.faceEnemy(idx); return idx })()')
await sleep(500)
await shot('03-aim-enemy')

// 俯视全景（美术检查用）
await evaluate('window.__PAPER_STRIKE__.birdseye()')
await sleep(900)
await shot('02b-birdseye')
await evaluate('window.__PAPER_STRIKE__.setState("playing")')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })

// 敌人近景（用于检查五官与造型）
await evaluate('window.__PAPER_STRIKE__.closeup(0, 2.6)')
await sleep(900)
await shot('03b-enemy-closeup')
await evaluate('window.__PAPER_STRIKE__.closeup(1, 4.2)')
await sleep(700)
await shot('03c-enemy-closeup-far')

// 狙击枪测试
await evaluate('window.__PAPER_STRIKE__.switchTo("sniper")')
await sleep(700)
await evaluate('window.__PAPER_STRIKE__.setAds(true)')
await sleep(700)
await shot('04-sniper-scope')
snap = await evaluate('window.__PAPER_STRIKE__.snapshot()')
const scopeOverlay = await evaluate('!document.getElementById("scope").classList.contains("hidden")')
check('狙击枪 4 倍镜生效且枪身隐藏', snap.current === 'sniper' && snap.ads === true && snap.fov < 25 && snap.weaponVisible === false && scopeOverlay === true, JSON.stringify({ ads: snap.ads, fov: +snap.fov.toFixed(1), weaponVisible: snap.weaponVisible, overlay: scopeOverlay }))
await evaluate('window.__PAPER_STRIKE__.setAds(false)')
await sleep(500)
snap = await evaluate('window.__PAPER_STRIKE__.snapshot()')
check('松开瞄准后恢复普通视野与枪身', snap.fov > 60 && snap.weaponVisible === true, 'fov=' + snap.fov.toFixed(1))
await evaluate('window.__PAPER_STRIKE__.fireOnce()')
await sleep(300)
snap = await evaluate('window.__PAPER_STRIKE__.snapshot()')
check('狙击枪单发消耗一发', snap.ammo.sniper === 4, '剩余 ' + snap.ammo.sniper)

// 换弹与切枪
await evaluate('window.__PAPER_STRIKE__.switchTo("smg")')
await sleep(600)
await evaluate('window.__PAPER_STRIKE__.setFire(true)')
await sleep(1400)
await evaluate('window.__PAPER_STRIKE__.setFire(false)')
await evaluate('window.__PAPER_STRIKE__.reload()')
await sleep(200)
snap = await evaluate('window.__PAPER_STRIKE__.snapshot()')
check('手动换弹进行中', snap.reloading === true)
await shot('05-reloading')
await sleep(1800)
snap = await evaluate('window.__PAPER_STRIKE__.snapshot()')
check('换弹完成后弹匣补满', snap.ammo.smg === 30, '剩余 ' + snap.ammo.smg)

// 击杀全部敌人 -> 胜利
await evaluate('window.__PAPER_STRIKE__.killEnemies(8)')
await sleep(600)
snap = await evaluate('window.__PAPER_STRIKE__.snapshot()')
check('击杀统计正确', snap.kills === 8, 'kills=' + snap.kills)
await shot('06-victory')
const victoryShown = await evaluate('!document.getElementById("result").classList.contains("hidden") && document.getElementById("result-title").textContent.includes("完成")')
check('胜利结算页出现', victoryShown === true)

// 暂停 / 恢复 / 重开
await evaluate('document.getElementById("btn-again").click()')
await sleep(1200)
snap = await evaluate('window.__PAPER_STRIKE__.snapshot()')
check('重开恢复初始状态', snap.kills === 0 && snap.health === 100 && snap.enemiesAlive === 8 && snap.ammo.smg === 30, JSON.stringify({ k: snap.kills, hp: snap.health, e: snap.enemiesAlive }))

// 死亡动画：先立即移出可命中列表，动画结束再隐藏模型
const deathInfo = await evaluate('(function(){ const a = window.__PAPER_STRIKE__; const e = a.enemyManager.enemies[0]; e.takeDamage(1000); return JSON.stringify({ alive: e.alive, state: e.state, visibleNow: e.model.group.visible }) })()')
const death = JSON.parse(deathInfo)
check('敌人死亡后立即从可命中目标移除', death.alive === false && death.state === 'dead' && death.visibleNow === true, deathInfo)
await waitFor('window.__PAPER_STRIKE__.enemyManager.enemies[0].model.group.visible === false', 20000)
check('死亡动画结束后模型隐藏', (await evaluate('window.__PAPER_STRIKE__.enemyManager.enemies[0].model.group.visible')) === false)

await evaluate('window.__PAPER_STRIKE__.setState("playing")')
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(500)
const paused = await evaluate('window.__PAPER_STRIKE__.state()')
check('Esc 可以暂停', paused === 'paused', paused)
await shot('07-pause')
await evaluate('document.getElementById("btn-resume").click()')
await sleep(600)
check('可以继续游戏', (await evaluate('window.__PAPER_STRIKE__.state()')) === 'playing')

// 移动与跳跃
const before = await evaluate('window.__PAPER_STRIKE__.snapshot().playerPos')
await evaluate('window.__PAPER_STRIKE__.press("KeyW", true)')
await sleep(900)
await evaluate('window.__PAPER_STRIKE__.press("KeyW", false)')
const after = await evaluate('window.__PAPER_STRIKE__.snapshot().playerPos')
check('WASD 可以移动', Math.hypot(after[0] - before[0], after[2] - before[2]) > 1.5, JSON.stringify([before, after]))

// 失败流程
await evaluate('(() => { const a = window.__PAPER_STRIKE__; a.setState("playing"); a.player.health = 1; return true })()')
await evaluate('(() => { const a = window.__PAPER_STRIKE__; const e = a.enemyManager.enemies[0]; e.position.set(a.player.position.x, 0, a.player.position.z - 6); e.state = "attack"; e.memory = 7; return true })()')
await waitFor('window.__PAPER_STRIKE__.snapshot().state === "defeat"', 45000)
snap = await evaluate('window.__PAPER_STRIKE__.snapshot()')
check('玩家血量归零触发失败', snap.state === 'defeat' && snap.health === 0, snap.state + ' hp=' + snap.health)
await shot('08-defeat')

// 小窗口（约 960 × 640）下的 HUD 布局
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false })
await evaluate('document.getElementById("btn-again").click()')
await sleep(1500)
await shot('09-small-window')
const layout = await evaluate('(function(){ const g = (id) => document.getElementById(id).getBoundingClientRect(); const a = g("hud").width; const boxes = { tl: document.querySelector(".hud-topleft").getBoundingClientRect(), tr: document.querySelector(".hud-topright").getBoundingClientRect(), bl: document.querySelector(".hud-bottomleft").getBoundingClientRect(), br: document.querySelector(".hud-bottomright").getBoundingClientRect() }; const overlap = (p, q) => !(p.right < q.left || q.right < p.left || p.bottom < q.top || q.bottom < p.top); const bad = overlap(boxes.tl, boxes.tr) || overlap(boxes.bl, boxes.br) || overlap(boxes.tl, boxes.bl) || overlap(boxes.tr, boxes.br); return JSON.stringify({ bad, w: a }) })()')
check('小窗口下 HUD 控件不互相遮挡', JSON.parse(layout).bad === false, layout)
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
await sleep(400)

// ---- 对战模式 ----
// 第 1 期只有开发钩子这一个入口（准备页上没有按钮）。这几条守的是三样手工验过、
// 但没有回归保护的东西：空场地、DUEL_SPAWNS、match 的 DUEL 分支，
// 外加 EnemyManager.setSpawns 重建数组后那两处按引用缓存必须重新取。
await evaluate('window.__PAPER_STRIKE__.startDuel()')
await sleep(1500)
let duel = await evaluate('window.__PAPER_STRIKE__.snapshot()')
const duelSpawns = await evaluate('JSON.stringify([window.__PAPER_STRIKE__.world.duelSpawns[0], window.__PAPER_STRIKE__.world.duelSpawns[1]])')
const sp = JSON.parse(duelSpawns)
const near = (p, s) => Math.hypot(p[0] - s.x, p[2] - s.z) < 0.5
check('决斗场地清空且双方各就各位', duel.mode === 'duel' && duel.enemiesAlive === 0 && duel.enemyStates.length === 0 && duel.opponent && duel.opponent.hasAvatar && duel.opponent.alive && near(duel.playerPos, sp[0]) && near([duel.opponent.x, 0, duel.opponent.z], sp[1]), JSON.stringify({ mode: duel.mode, e: duel.enemiesAlive, pos: duel.playerPos, opp: duel.opponent }))

const duelHud = await evaluate('(function(){ const hid = (id) => document.getElementById(id).classList.contains("hidden"); const q = (s) => document.querySelector(s); return JSON.stringify({ name: q("#hud .mission-name").textContent, countHidden: q("#hud .mission-count").classList.contains("hidden"), pipsHidden: hid("progress-pips"), oppHidden: hid("opponent-line"), oppName: document.getElementById("opponent-name").textContent, oppHp: document.getElementById("opponent-hp").textContent, status: document.getElementById("hud-status").textContent }) })()')
const dh = JSON.parse(duelHud)
check('决斗 HUD 用对手血条换掉敌人计数', dh.name.includes('决斗') && dh.countHidden === true && dh.pipsHidden === true && dh.oppHidden === false && dh.oppName === '陪练' && dh.oppHp === '100' && dh.status === '决斗中', duelHud)
await shot('11-duel-hud')

// 贴近了打 —— 出生点之间没有直线视线（world.test.js 有断言），原地开枪只会打墙
await evaluate('window.__PAPER_STRIKE__.switchTo("sniper")')
await waitFor('window.__PAPER_STRIKE__.weaponState.switchTimer <= 0', 20000)
await evaluate('(() => { const a = window.__PAPER_STRIKE__; a.teleport(6, -11); a.faceOpponent(); return true })()')
await sleep(700)
for (let i = 0; i < 4; i++) {
  await evaluate('(() => { const a = window.__PAPER_STRIKE__; a.faceOpponent(); a.fireOnce(); return true })()')
  await sleep(900)
  duel = await evaluate('window.__PAPER_STRIKE__.snapshot()')
  if (!duel.opponent || !duel.opponent.alive) break
}
const duelEnd = await evaluate('JSON.stringify({ title: document.getElementById("result-title").textContent, sub: document.getElementById("result-sub").textContent, shown: !document.getElementById("result").classList.contains("hidden"), hpText: document.getElementById("opponent-hp").textContent, hpDown: document.getElementById("opponent-hp").classList.contains("is-down") })')
const de = JSON.parse(duelEnd)
check('击倒对手即判决斗胜利', duel.state === 'victory' && duel.opponent && duel.opponent.alive === false && duel.opponent.hp === 0 && de.shown && de.title.includes('决斗胜利'), JSON.stringify({ state: duel.state, opp: duel.opponent, title: de.title }))
check('对手倒下后血条显示「已击倒」而不是整行消失', de.hpDown === true && de.hpText === '已击倒', de.hpText)
await shot('12-duel-victory')

// 对战面板的壳子：第 2 期才会往里填信令，但现在必须能开能关
await evaluate('window.__PAPER_STRIKE__.showNet()')
await sleep(400)
check('对战面板壳子可以打开', (await evaluate('!document.getElementById("net").classList.contains("hidden")')) === true)
await shot('13-net-panel')
await clickSelector('#btn-net-back')
await sleep(800)
check('对战面板可以退回准备页', (await evaluate('!document.getElementById("menu").classList.contains("hidden")')) === true)

// 切回单人：这一步专门守 EnemyManager.setSpawns 换掉数组本身之后，
// match.enemies 与 enemyCtx.enemies 有没有跟着重新取（这两个地方是按引用缓存的）
await evaluate('window.__PAPER_STRIKE__.start()')
await sleep(1500)
const solo = await evaluate('window.__PAPER_STRIKE__.snapshot()')
const refs = await evaluate('JSON.stringify({ players: window.__PAPER_STRIKE__.match.players.map(p => p.id), matchE: window.__PAPER_STRIKE__.match.enemies.length, mgrE: window.__PAPER_STRIKE__.enemyManager.enemies.length, oppHidden: document.getElementById("opponent-line").classList.contains("hidden"), countShown: !document.querySelector("#hud .mission-count").classList.contains("hidden") })')
const rf = JSON.parse(refs)
check('切回单人后敌人重建、HUD 与 match 的引用全部复位', solo.mode === 'solo' && solo.enemiesAlive === 8 && solo.opponent === null && rf.players.join() === 'p1' && rf.matchE === 8 && rf.mgrE === 8 && rf.oppHidden === true && rf.countShown === true, refs)

// 单人流程必须一次都不碰 RTCPeerConnection。跑到这里，前面的单人、决斗、
// 开关对战面板几条加起来已经把各条路径都走过了，计数仍是 0 才算真的「离线」。
const rtcCount = await evaluate('window.__RTC_COUNT__')
check('全程没有实例化 RTCPeerConnection（单人模式仍然完全离线）', rtcCount === 0, 'count=' + rtcCount)

const perf = await evaluate('window.__PAPER_STRIKE__.snapshot()')
check('渲染统计正常（有绘制调用）', perf.drawCalls > 0, 'calls=' + perf.drawCalls + ' tris=' + perf.triangles)

const nanReport = await evaluate('(function(){ const out=[]; window.__PAPER_STRIKE__.world.group.traverse(o=>{ const g=o.geometry; if(!g||!g.attributes||!g.attributes.position) return; const a=g.attributes.position.array; for(let i=0;i<a.length;i++) if(!Number.isFinite(a[i])) { out.push(o.name||o.type); break } }); return JSON.stringify(out) })()')
check('场景几何体没有 NaN 顶点', nanReport === '[]', nanReport)

const fps = await evaluate('new Promise(res => { let n = 0; const t0 = performance.now(); function tick(){ n++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now() - t0) / 1000))) } requestAnimationFrame(tick) })')
console.log('ℹ 无头软件渲染下的帧率约 ' + fps + ' FPS（仅供参考，真实显卡会高得多）')
check('控制台没有错误', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '))
check('没有失败的网络请求', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '))
check('没有加载跨源第三方资源', externalRequests.length === 0, externalRequests.slice(0, 3).join(' | '))

// WebGL 2 不可用时应给出可理解的说明，而不是黑屏
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: '(() => { const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { if (type === "webgl2" || type === "webgl" || type === "experimental-webgl") return null; return orig.call(this, type, ...rest) } })()'
})
await send('Page.navigate', { url: URL_ARG })
await sleep(3000)
const errShown = await evaluate('!document.getElementById("webgl-error").classList.contains("hidden") && document.getElementById("webgl-error-text").textContent.length > 10')
check('不支持 WebGL 2 时显示错误说明', errShown === true)
await shot('10-webgl-error')

writeFileSync(join(OUT, 'qa-report.json'), JSON.stringify({ url: URL_ARG, results, consoleErrors, consoleLogs: consoleLogs.slice(-40), failedRequests }, null, 2))
const failed = results.filter((r) => !r.ok)
console.log('\n通过 ' + (results.length - failed.length) + '/' + results.length)
if (consoleLogs.length) console.log('页面日志样例：\n' + consoleLogs.slice(-12).join('\n'))
ws.close()
child.kill()
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(failed.length ? 1 : 0)
