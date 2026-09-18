// 纸上交锋 · PAPER STRIKE —— 入口、渲染循环、输入与游戏状态
import * as THREE from 'three'
import { createWorld, PALETTE, PHYS, DUEL_SPAWNS } from './world.js'
import { Player } from './player.js'
import {
  switchWeapon, cycleWeapon, startReload, isReloading, WEAPONS
} from './weapon-state.js'
import { Effects } from './combat.js'
import { EnemyManager } from './enemies.js'
import { WeaponView } from './weapons.js'
import { GameAudio } from './audio.js'
import { UI } from './ui.js'
import { HumanInput, RemoteInput } from './input.js'
import { createLoadout } from './loadout.js'
import { PlayerAvatar } from './player-rig.js'
import { Match, MODE, TEAM, opponentStatus } from './match.js'
import { createNetPanel } from './net-panel.js'

const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', VICTORY: 'victory', DEFEAT: 'defeat' }
const BASE_FOV = 75
const MENU_FOV = 48
const ADS_SENSITIVITY = 0.45
const MENU_CAM = { pos: new THREE.Vector3(29, 20, 33), look: new THREE.Vector3(-4, 1.5, -3) }
const MAX_PIXEL_RATIO = 1.5

const ui = new UI()
const canvas = document.getElementById('game-canvas')

/**
 * 对战面板。游戏逻辑通过回调交回这里 —— 面板不该知道 startGame 是什么。
 *
 * ⚠️ 这个面板在**用户点「我是房主 / 我是挑战者」之前不会建任何 RTCPeerConnection**。
 * 单人模式的「全程零外部请求」是个可证命题，而连接一建就会开始探网络。
 * tests/browser-qa.js 里有一条断言专门盯着这件事，别在这里提前 new。
 */
const netPanel = createNetPanel({
  // 第 2 期只做到「通道打通」：双方各自进入本地决斗场地。
  // 真正的对手同步（谁在哪、谁打中谁）是第 3 期，届时这里会改成发一条 ROUND 报文
  onStartDuel: () => startGame(MODE.DUEL),
  onBack: () => toMenu()
})

let renderer = null
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 不可用')
} catch (err) {
  ui.showWebglError('无法创建 WebGL 2 上下文：' + (err && err.message ? err.message : '未知原因') + '<br />请使用桌面版 Chrome / Edge 并开启硬件加速。')
  throw err
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
renderer.setSize(window.innerWidth, window.innerHeight, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.autoClear = false

const scene = new THREE.Scene()
scene.background = new THREE.Color(PALETTE.sky)
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 43, 100)

const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.08, 600)
camera.rotation.order = 'YXZ'
scene.add(camera)

const hemi = new THREE.HemisphereLight(new THREE.Color('#FFF9E6'), new THREE.Color('#778B8A'), 2.55)
scene.add(hemi)
const sun = new THREE.DirectionalLight(new THREE.Color('#FFF5DB'), 3.0)
sun.position.set(-47, 87, 55)
sun.target.position.set(0, 0, 0)
scene.add(sun.target)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -46
sun.shadow.camera.right = 46
sun.shadow.camera.top = 46
sun.shadow.camera.bottom = -46
sun.shadow.camera.near = 30
sun.shadow.camera.far = 220
sun.shadow.bias = -0.0012
sun.shadow.normalBias = 0.045
scene.add(sun)
const bounce = new THREE.DirectionalLight(new THREE.Color(PALETTE.blue), 0.5)
bounce.position.set(30, 18, -30)
scene.add(bounce)

const world = createWorld(scene)
const player = new Player(world, { id: 'p1', team: 'a', isLocal: true })
const enemyManager = new EnemyManager(world, scene)
const effects = new Effects(scene)
const weaponView = new WeaponView()
const audio = new GameAudio()

// 对局：角色注册与胜负规则的唯一出处。
// 第 1 期只有 SOLO 一种模式可达 —— DUEL 的规则已在 match.js 落地并测过，
// 但入口要等第 3 期的网络面板，现在造一条走不到的代码路径只会变成没人测的死代码。
const match = new Match({ world, mode: MODE.SOLO })
match.addPlayer(player)
match.setEnemies(enemyManager.enemies)

// 持枪者：枪、后坐、镜头、统计。
// 这些原来是 main.js:84-94 的模块级全局，现在收进对象 —— 双人对战时一人一份。
const input = new HumanInput()
const loadout = createLoadout(player, {
  camera,
  weaponView,
  audio,
  ui,
  effects,
  world,
  match,
  enemies: enemyManager,
  weaponId: 'smg',
  initialFov: MENU_FOV
})

let state = STATE.MENU
let elapsed = 0
let selectedWeapon = 'smg'
let controlAcquired = false
let compatMode = false
let menuTime = 0

// ---------------------------------------------------------------------------
// 决斗对手
//
// 第 1 期的对手是**本地陪练**：一个站在对面不动的 Player + 一个可见化身。
// 它没有任何网络成分 —— 存在的意义是让「空场地 / DUEL_SPAWNS / match 的 DUEL 分支」
// 这三样能被真打一局验证，而不是只躺在单测里。
// 第 3 期把 duel.input 换成远端输入、把 applyState 的入参换成主机快照，结构不用动。
// ---------------------------------------------------------------------------
const duel = {
  opponent: null,          // Player，进 match.players，负责挨打与胜负判定
  avatar: null,            // PlayerAvatar，负责被看见
  input: new RemoteInput() // 永不 push → 每帧返回零输入 → 陪练原地站着
}

/** 模式决定的本地出生点。放在 startGame 里算，是因为 match.restart 会读 p.spawn */
function spawnFor(mode) {
  return mode === MODE.DUEL ? DUEL_SPAWNS[0] : world.playerSpawn
}

function setupLocalDuel() {
  const foe = new Player(world, { id: 'p2', team: TEAM.B, isLocal: false, name: '陪练', variant: 1 })
  foe.reset(DUEL_SPAWNS[1])
  match.addPlayer(foe)
  duel.opponent = foe
  duel.avatar = new PlayerAvatar(scene, { id: foe.id, name: foe.name, variant: foe.variant })
  duel.avatar.applyState({
    x: foe.position.x, y: foe.position.y, z: foe.position.z,
    yaw: foe.yaw, hp: foe.health, maxHp: foe.maxHealth
  }, 0)
  return foe
}

/**
 * 拆掉陪练，回到「场上只有我一个角色」的状态。
 * 必须同时从 match 里摘掉 —— 只 dispose 模型的话，那个 Player 还在 players 里，
 * DUEL 的胜负判定会以为对手还活着（或者下次 addPlayer 直接抛「重复的玩家 id」）。
 */
function clearLocalDuel() {
  if (duel.avatar) duel.avatar.dispose()
  duel.avatar = null
  if (duel.opponent) {
    match.removePlayer(duel.opponent.id)
    duel.opponent = null
  }
}

/** 任务栏只在单人模式有意义：决斗场地是空的，「剩余 0 名敌人」会读成「已经赢了」 */
function refreshEnemyHud() {
  if (match.mode === MODE.SOLO) ui.setEnemies(enemyManager.aliveCount)
}

// ---------------------------------------------------------------------------
// 控制与鼠标锁定
// ---------------------------------------------------------------------------
function clearInput() {
  input.clear()
  player.velocity.x = 0
  player.velocity.z = 0
}

function enableCompat(reason) {
  if (compatMode) return
  compatMode = true
  controlAcquired = true
  ui.setCompatHint(true)
  ui.showLockHint('已切换到兼容模式：' + reason)
  setTimeout(() => ui.hideLockHint(), 4200)
  setTimeout(() => ui.setCompatHint(false), 9000)
}

function requestControl() {
  if (compatMode) {
    controlAcquired = true
    return
  }
  const el = renderer.domElement
  if (!el.requestPointerLock) {
    enableCompat('当前环境不支持鼠标锁定')
    return
  }
  ui.showLockHint('正在请求鼠标锁定…')
  let settled = false
  try {
    const p = el.requestPointerLock()
    if (p && typeof p.then === 'function') {
      p.then(() => { settled = true }).catch(() => enableCompat('鼠标锁定被浏览器拒绝'))
    }
  } catch (err) {
    enableCompat('鼠标锁定请求失败')
  }
  setTimeout(() => {
    if (state === STATE.PLAYING && !compatMode && document.pointerLockElement !== el) {
      enableCompat(settled ? '鼠标锁定被拒绝' : '此内嵌预览不允许鼠标锁定')
    }
  }, 800)
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement
  if (locked) {
    controlAcquired = true
    ui.hideLockHint()
  } else if (state === STATE.PLAYING && !compatMode) {
    pauseGame()
  }
})
document.addEventListener('pointerlockerror', () => {
  if (state === STATE.PLAYING) enableCompat('此环境不允许鼠标锁定')
})

// ---------------------------------------------------------------------------
// 输入
// ---------------------------------------------------------------------------
const BLOCK_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

window.addEventListener('keydown', (e) => {
  if (BLOCK_KEYS.has(e.code)) e.preventDefault()
  if (e.repeat) return
  if (e.code === 'Escape') {
    if (state === STATE.PLAYING) pauseGame()
    else if (state === STATE.PAUSED) resumeGame()
    return
  }
  if (state !== STATE.PLAYING) return
  input.setKey(e.code, true)
  if (compatMode && e.code === 'KeyT') input.toggleCompatAds()
  if (compatMode && e.code === 'KeyF') input.pressFire()
  if (e.code === 'KeyR') {
    if (startReload(loadout.weaponState)) audio.reloadStart(loadout.weaponState.current)
    else audio.dryFire()
  }
  if (e.code === 'Digit1') selectWeapon('smg')
  if (e.code === 'Digit2') selectWeapon('sniper')
})

window.addEventListener('keyup', (e) => {
  input.setKey(e.code, false)
  if (e.code === 'KeyF') input.releaseFire()
})

window.addEventListener('blur', () => {
  if (state === STATE.PLAYING) pauseGame()
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === STATE.PLAYING) pauseGame()
})

// 右键菜单挂在 document 上：准备页 / 暂停页的右键同样要拦住，不能只管画布
document.addEventListener('contextmenu', (e) => e.preventDefault())

let dragging = false
let lastMouse = { x: 0, y: 0 }

renderer.domElement.addEventListener('mousedown', (e) => {
  // 右键默认行为要在状态判断之前吃掉，否则准备页/暂停时拦不住
  if (e.button === 2) e.preventDefault()
  if (state !== STATE.PLAYING) return
  if (e.button === 0) {
    input.pressFire()
    if (compatMode) dragging = true
  } else if (e.button === 2) {
    input.setAds(true)
  }
  lastMouse = { x: e.clientX, y: e.clientY }
})
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    input.releaseFire()
    dragging = false
  } else if (e.button === 2) {
    input.setAds(false)
  }
})
window.addEventListener('mousemove', (e) => {
  if (state !== STATE.PLAYING) return
  const locked = document.pointerLockElement === renderer.domElement
  let dx = 0
  let dy = 0
  if (locked) {
    dx = e.movementX || 0
    dy = e.movementY || 0
  } else if (compatMode && dragging) {
    dx = e.clientX - lastMouse.x
    dy = e.clientY - lastMouse.y
  } else {
    return
  }
  lastMouse = { x: e.clientX, y: e.clientY }
  // 观察走事件路径而不是帧路径：鼠标事件的密度高于帧率，攒到下一帧会丢精度
  player.look(dx, dy, loadout.lookSensitivity(baseSensitivity(), ADS_SENSITIVITY))
  weaponView.look(dx, dy)
})
window.addEventListener('wheel', (e) => {
  if (state !== STATE.PLAYING) return
  e.preventDefault()
  if (cycleWeapon(loadout.weaponState, e.deltaY > 0 ? 1 : -1)) applyWeaponSwitch()
}, { passive: false })

function baseSensitivity() {
  return 0.0021
}

function selectWeapon(id) {
  if (switchWeapon(loadout.weaponState, id)) applyWeaponSwitch()
}

function applyWeaponSwitch() {
  weaponView.setWeapon(loadout.weaponState.current)
  audio.uiClick()
  ui.setWeaponName(WEAPONS[loadout.weaponState.current].name)
}

// ---------------------------------------------------------------------------
// 游戏流程
// ---------------------------------------------------------------------------
function startGame(mode = MODE.SOLO) {
  clearLocalDuel()
  match.mode = mode
  // 出生点必须在 match.restart() 之前写进 player.spawn —— restart 是 p.reset(p.spawn)
  player.reset(spawnFor(mode))
  if (mode === MODE.DUEL) setupLocalDuel()

  // 决斗场地是空的。setSpawns 会换掉 enemyManager.enemies 这个数组本身，
  // 所以下面两处按引用缓存过它的地方必须重新取（见 EnemyManager.setSpawns 的注释）。
  enemyManager.setSpawns(mode === MODE.DUEL ? [] : world.enemySpawns)
  match.setEnemies(enemyManager.enemies)
  enemyCtx.enemies = enemyManager.enemies

  loadout.reset(selectedWeapon)
  effects.clear()
  // 所有参战角色回到各自出生点、回满血；DUEL 模式下对手也会一起复位
  match.restart()
  elapsed = 0
  audio.init()
  audio.resume()
  audio.uiClick()
  weaponView.setWeapon(selectedWeapon, true)
  weaponView.setHidden(false)
  ui.setScope(false)
  ui.setMode(mode)
  ui.setOpponent(null)
  ui.showScreen('hud')
  ui.setSelectedWeapon(selectedWeapon)
  ui.setHealth(player.health)
  ui.setAmmo(loadout.weaponState.weapons[selectedWeapon].ammo, WEAPONS[selectedWeapon].magSize)
  ui.setWeaponName(WEAPONS[selectedWeapon].name)
  refreshEnemyHud()
  // 这里不设 status —— loadout.writeHud 每帧都会按模式写一次，写了也会被立刻覆盖
  state = STATE.PLAYING
  controlAcquired = compatMode
  clearInput()
  requestControl()
}

function pauseGame() {
  if (state !== STATE.PLAYING) return
  state = STATE.PAUSED
  clearInput()
  ui.showScreen('pause')
  if (document.pointerLockElement) document.exitPointerLock()
}

function resumeGame() {
  if (state !== STATE.PAUSED) return
  state = STATE.PLAYING
  clearInput()
  ui.showScreen('hud')
  requestControl()
}

function toMenu() {
  state = STATE.MENU
  clearInput()
  // 回到准备页就把连接断掉：留着的 PeerConnection 会继续持有摄像头级别的网络探测
  netPanel.close()
  // 陪练跟着这一局一起退场：留在场上会出现在准备页的环绕镜头里
  clearLocalDuel()
  match.mode = MODE.SOLO
  match.setEnemies(enemyManager.enemies)
  menuTime = 0
  ui.showScreen('menu')
  ui.setMode(MODE.SOLO)
  ui.setOpponent(null)
  ui.setScope(false)
  if (document.pointerLockElement) document.exitPointerLock()
}

function endGame(win) {
  if (state === STATE.VICTORY || state === STATE.DEFEAT) return
  state = win ? STATE.VICTORY : STATE.DEFEAT
  clearInput()
  const s = loadout.stats
  const timeText = formatTime(elapsed)
  const accuracy = s.shots > 0 ? s.hits / s.shots : 0
  ui.setScope(false)
  const duelOver = match.mode === MODE.DUEL
  ui.setStatus(duelOver ? (win ? '决斗胜利' : '被击倒') : win ? '任务完成' : '演习失败')
  if (win) audio.victory()
  else audio.defeat()
  ui.showResult({ win, kills: s.kills, time: timeText, accuracy, hits: s.hits, shots: s.shots, mode: match.mode })
  if (document.pointerLockElement) document.exitPointerLock()
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------
const enemyCtx = {
  player,
  solids: world.solids,
  canFight: false,
  effects,
  audio,
  enemies: enemyManager.enemies,
  random: Math.random,
  onPlayerHit: (damage) => {
    if (state !== STATE.PLAYING || player.dead) return
    player.applyDamage(damage)
    ui.damageFlash()
    audio.playerHurt()
    if (player.dead) endGame(false)
  }
}

/** 有人被击倒时的收尾：报数、播报，再看这一局是否已经分出胜负 */
function afterKill() {
  if (match.mode === MODE.DUEL) {
    ui.toast('击倒对手')
  } else {
    ui.setEnemies(enemyManager.aliveCount)
    ui.toast('击倒一名纸板小兵 · 剩余 ' + enemyManager.aliveCount)
  }
  settleVictory()
}

/**
 * 胜负判定的唯一出口。规则本身在 match.js 里，这里只负责把结果翻译成 UI 动作。
 * 原来这段判断散在 fireWeapon 与 updatePlaying 两处硬编码，且都是「敌人清零即胜利」，
 * 决斗场地没有敌人时会开局瞬间误判 —— 所以规则必须先按模式分支（见 match.checkVictory）。
 */
function settleVictory() {
  if (state !== STATE.PLAYING) return false
  const verdict = match.checkVictory()
  if (!verdict || !verdict.over) return false
  // 最后一发的击杀与命中已经在射击结算里记入统计，这里只做胜利判定
  refreshEnemyHud()
  endGame(match.didLocalWin(verdict))
  return true
}

function updatePlaying(dt) {
  elapsed += dt
  const frame = input.sample()
  // 换弹时不许开镜 —— 夹在输入与玩家之间，所以写回帧里再交给 player
  const wantAds = frame.ads && !isReloading(loadout.weaponState)
  frame.ads = wantAds
  player.ads = wantAds
  player.update(dt, frame)

  // 兼容模式：方向键转身，F 射击，T 切换瞄准（边沿触发在键盘事件里处理）
  if (compatMode) {
    if (input.isDown('ArrowLeft')) player.look(-34, 0, 0.0021)
    if (input.isDown('ArrowRight')) player.look(34, 0, 0.0021)
    if (input.isDown('ArrowUp')) player.look(0, -22, 0.0021)
    if (input.isDown('ArrowDown')) player.look(0, 22, 0.0021)
  }
  enemyCtx.canFight = controlAcquired && !player.dead

  loadout.updateCombat(dt, frame, { onKill: afterKill })

  enemyManager.update(dt, enemyCtx)
  updateDuel(dt)
  effects.update(dt)

  settleVictory()
  loadout.updateFeet(dt)
  loadout.syncCamera(dt)
  loadout.writeHud(elapsed)
  refreshEnemyHud()
}

/**
 * 陪练的推进：物理照常跑（RemoteInput 每帧给零输入，所以它站着不动），
 * 状态再交给化身去摆。
 *
 * 第 3 期这里会变成：输入来自网络抖动缓冲、状态来自主机快照。
 * 本块的形状就是那时候的形状，只是数据源不同。
 */
function updateDuel(dt) {
  if (!duel.opponent) return
  duel.opponent.update(dt, duel.input.sample())
  duel.avatar.applyState({
    x: duel.opponent.position.x,
    y: duel.opponent.position.y,
    z: duel.opponent.position.z,
    yaw: duel.opponent.yaw,
    pitch: duel.opponent.pitch,
    hp: duel.opponent.health,
    maxHp: duel.opponent.maxHealth
  }, dt)
  duel.avatar.setDead(duel.opponent.dead)
  duel.avatar.update(dt)
  ui.setOpponent(opponentStatus(match))
}

function updateMenuCamera(dt) {
  menuTime += dt
  const t = menuTime * 0.055
  const radius = 44
  camera.position.set(MENU_CAM.pos.x + Math.sin(t) * 6, MENU_CAM.pos.y + Math.sin(t * 0.7) * 1.6, MENU_CAM.pos.z + Math.cos(t) * 6)
  camera.lookAt(MENU_CAM.look)
  if (Math.abs(camera.fov - MENU_FOV) > 0.01) {
    camera.fov = MENU_FOV
    camera.updateProjectionMatrix()
  }
  void radius
}

function render() {
  renderer.clear()
  renderer.render(scene, camera)
  if (state !== STATE.MENU) {
    renderer.clearDepth()
    renderer.render(weaponView.scene, weaponView.camera)
  }
}

let lastFrame = performance.now()
function frame(now) {
  requestAnimationFrame(frame)
  let dt = (now - lastFrame) / 1000
  lastFrame = now
  if (!Number.isFinite(dt) || dt < 0) dt = 0
  dt = Math.min(dt, 1 / 18)

  ui.update(dt)
  if (state === STATE.PLAYING) {
    updatePlaying(dt)
  } else {
    if (state === STATE.MENU) updateMenuCamera(dt)
    else if (state === STATE.PAUSED) updateMenuCamera2(dt)
    effects.update(dt)
    enemyManager.update(dt, enemyCtx)
    weaponView.update(dt, { ads: false, scoped: false, moving: false, bobSpeed: 0, reloadProgress: 0 })
  }
  render()
}

/** 暂停时不推进战斗，只让武器与特效停止抖动 */
function updateMenuCamera2() {
  weaponView.update(0, { ads: false, scoped: false, moving: false, bobSpeed: 0, reloadProgress: 0 })
}

// ---------------------------------------------------------------------------
// 窗口与启动
// ---------------------------------------------------------------------------
function onResize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  weaponView.camera.aspect = w / h
  weaponView.camera.updateProjectionMatrix()
}
window.addEventListener('resize', onResize)

ui.bind({
  onStart: () => startGame(),
  onResume: () => resumeGame(),
  // 「重新开始 / 再来一次」沿用当前模式：决斗打到一半重开，不该掉进单人局
  onRestart: () => startGame(match.mode),
  onMenu: () => toMenu(),
  onPause: () => pauseGame(),
  onMute: () => {
    audio.init()
    audio.setMuted(!audio.muted)
    ui.setMuteButtons(audio.muted)
  },
  onSelectWeapon: (id) => {
    if (!WEAPONS[id]) return
    selectedWeapon = id
    ui.setSelectedWeapon(id)
    audio.init()
    audio.uiClick()
  }
})

// 准备页的「双人对战」入口。ui.js 只管菜单/HUD/暂停/结算四屏，
// 对战屏由 net-panel.js 自己负责，所以这个按钮在这里绑
const btnNet = document.getElementById('btn-net')
if (btnNet) {
  btnNet.onclick = () => {
    audio.init()
    audio.uiClick()
    ui.showScreen('net')
    netPanel.open()
  }
}

ui.setMuteButtons(false)
ui.setSelectedWeapon(selectedWeapon)
onResize()
camera.position.copy(MENU_CAM.pos)
camera.lookAt(MENU_CAM.look)
camera.fov = MENU_FOV
camera.updateProjectionMatrix()

// 准备页的控件到这里才解禁。走到这一行时 ui.bind() 与上面的 #btn-net 都已绑好，
// 点击一定有反应；在此之前它们一直是 index.html 里写死的 disabled 状态。
// 冷启动时 bundle 下载 + 贴图/关卡同步构建要好几秒，用户等不到的话，
// 看到的是灰着的按钮，而不是一个「点了没反应」的按钮。
for (const el of document.querySelectorAll('#btn-start, #btn-net, #btn-mute-menu, .loadout-card')) {
  el.disabled = false
}

ui.showScreen('menu')
requestAnimationFrame(frame)

// 开发模式下的确定性验收入口（生产构建会被移除）
if (import.meta.env.DEV) {
  window.__PAPER_STRIKE__ = {
    state: () => state,
    snapshot: () => {
      const ws = loadout.weaponState
      return {
        state,
        mode: match.mode,
        compatMode,
        health: player.health,
        ammo: { smg: ws.weapons.smg.ammo, sniper: ws.weapons.sniper.ammo },
        current: ws.current,
        enemiesAlive: enemyManager.aliveCount,
        kills: loadout.stats.kills,
        shots: loadout.stats.shots,
        hits: loadout.stats.hits,
        time: elapsed,
        reloading: isReloading(ws),
        playerPos: [player.position.x, player.position.y, player.position.z],
        enemyStates: enemyManager.enemies.map((e) => ({ s: e.state, a: e.alive, x: +e.position.x.toFixed(2), z: +e.position.z.toFixed(2) })),
        opponent: duel.opponent
          ? {
              name: duel.opponent.name,
              hp: duel.opponent.health,
              alive: duel.opponent.alive,
              x: +duel.opponent.position.x.toFixed(2),
              z: +duel.opponent.position.z.toFixed(2),
              hasAvatar: !!duel.avatar
            }
          : null,
        fov: camera.fov,
        ads: player.ads,
        weaponVisible: weaponView.models[ws.current].visible,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles
      }
    },
    start: () => startGame(),
    /**
     * 决斗入口 —— 只存在于开发构建。
     * 准备页上已经有「双人对战」按钮走真实路径了，保留这个钩子是为了让验收脚本
     * 能直接起局（不用先跑一遍整套邀请码交换）。
     * 不带参数默认单人，方便一条命令来回切模式验证 setSpawns 的重建。
     */
    startDuel: () => startGame(MODE.DUEL),
    /** 打开对战面板。必须走 netPanel.open()，只切屏会让面板停在上一次的状态上 */
    showNet: () => { ui.showScreen('net'); netPanel.open() },
    netPanel,
    faceOpponent: () => {
      const foe = duel.opponent
      if (!foe) return null
      const dx = foe.position.x - player.position.x
      const dz = foe.position.z - player.position.z
      player.yaw = Math.atan2(-dx, -dz)
      const dy = foe.position.y + 1.2 - (player.position.y + player.eyeHeight)
      player.pitch = Math.atan2(dy, Math.hypot(dx, dz))
      return { dx, dz, dist: Math.hypot(dx, dz) }
    },
    look: (yaw, pitch) => { player.yaw = yaw; player.pitch = pitch },
    teleport: (x, z, y = 0) => { player.position.set(x, y, z); player.velocity.set(0, 0, 0) },
    press: (code, down = true) => input.setKey(code, down),
    setAds: (on) => input.setAds(on),
    setFire: (on) => { if (on) input.pressFire(); else input.releaseFire() },
    fireOnce: () => { input.pressFire(); input.releaseFire() },
    reload: () => startReload(loadout.weaponState),
    switchTo: (id) => selectWeapon(id),
    killEnemies: (n) => {
      let left = n
      for (const e of enemyManager.enemies) {
        if (left <= 0) break
        if (e.alive) { e.takeDamage(1000); loadout.stats.kills++; left-- }
      }
      ui.setEnemies(enemyManager.aliveCount)
    },
    faceEnemy: (i = 0) => {
      const e = enemyManager.enemies[i]
      if (!e) return null
      const dx = e.position.x - player.position.x
      const dz = e.position.z - player.position.z
      player.yaw = Math.atan2(-dx, -dz)
      const dy = e.position.y + 1.2 - (player.position.y + player.eyeHeight)
      player.pitch = Math.atan2(dy, Math.hypot(dx, dz))
      return { dx, dz }
    },
    setGodMode: (on) => { enemyCtx.onPlayerHit = on ? () => {} : enemyCtx.onPlayerHit },
    setState: (s) => { state = s },
    closeup: (i = 0, dist = 2.8) => {
      const e = enemyManager.enemies[i]
      if (!e) return null
      const fx = -Math.sin(e.yaw)
      const fz = -Math.cos(e.yaw)
      player.position.set(e.position.x + fx * dist, 0, e.position.z + fz * dist)
      player.velocity.set(0, 0, 0)
      const dx = e.position.x - player.position.x
      const dz = e.position.z - player.position.z
      player.yaw = Math.atan2(-dx, -dz)
      player.pitch = Math.atan2(e.position.y + 1.35 - (player.position.y + player.eyeHeight), Math.hypot(dx, dz))
      loadout.recoilPitch = 0
      loadout.recoilVel = 0
      return { x: player.position.x, z: player.position.z }
    },
    birdseye: (x = 2, y = 34, z = 40, tx = 0, tz = -6) => {
      state = STATE.PAUSED
      ui.showScreen('hud')
      camera.position.set(x, y, z)
      camera.lookAt(tx, 0, tz)
      camera.fov = 60
      camera.updateProjectionMatrix()
      return true
    },
    world,
    player,
    enemyManager,
    match,
    loadout,
    weaponState: loadout.weaponState
  }
}
