// 纸上交锋 · PAPER STRIKE —— 入口、渲染循环、输入与游戏状态
import * as THREE from 'three'
import { createWorld, PALETTE, PHYS } from './world.js'
import { Player } from './player.js'
import {
  createWeaponState, updateWeaponState, tryFire, switchWeapon, cycleWeapon, startReload,
  spreadFor, damageFor, WEAPONS, adsFov, adsSensitivityScale, reloadProgress, isReloading, resetWeaponState
} from './weapon-state.js'
import { Effects, resolveShot } from './combat.js'
import { EnemyManager } from './enemies.js'
import { WeaponView } from './weapons.js'
import { GameAudio } from './audio.js'
import { UI } from './ui.js'

const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', VICTORY: 'victory', DEFEAT: 'defeat' }
const BASE_FOV = 75
const MENU_FOV = 48
const ADS_SENSITIVITY = 0.45
const MENU_CAM = { pos: new THREE.Vector3(29, 20, 33), look: new THREE.Vector3(-4, 1.5, -3) }
const MAX_PIXEL_RATIO = 1.5

const ui = new UI()
const canvas = document.getElementById('game-canvas')

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
const player = new Player(world)
const enemyManager = new EnemyManager(world, scene)
const effects = new Effects(scene)
const weaponView = new WeaponView()
const audio = new GameAudio()
const weaponState = createWeaponState('smg')

const stats = { shots: 0, hits: 0, kills: 0, headshots: 0 }
let state = STATE.MENU
let elapsed = 0
let selectedWeapon = 'smg'
let controlAcquired = false
let compatMode = false
let lastReloading = { smg: false, sniper: false }
let recoilPitch = 0
let recoilVel = 0
let stepDistance = 0
let wasOnGround = true
let camFov = MENU_FOV
let menuTime = 0
let shootPressed = false
let shootHeld = false
let adsHeld = false
let compatAds = false
const pressed = new Set()
const tmpDir = new THREE.Vector3()
const tmpVec = new THREE.Vector3()
const tmpVec2 = new THREE.Vector3()

// ---------------------------------------------------------------------------
// 控制与鼠标锁定
// ---------------------------------------------------------------------------
function clearInput() {
  pressed.clear()
  shootPressed = false
  shootHeld = false
  adsHeld = false
  compatAds = false
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
  pressed.add(e.code)
  if (compatMode && e.code === 'KeyT') compatAds = !compatAds
  if (compatMode && e.code === 'KeyF') {
    shootPressed = true
    shootHeld = true
  }
  if (e.code === 'KeyR') {
    if (startReload(weaponState)) audio.reloadStart(weaponState.current)
    else audio.dryFire()
  }
  if (e.code === 'Digit1') selectWeapon('smg')
  if (e.code === 'Digit2') selectWeapon('sniper')
})

window.addEventListener('keyup', (e) => {
  pressed.delete(e.code)
  if (e.code === 'KeyF') shootHeld = false
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
    shootPressed = true
    shootHeld = true
    if (compatMode) dragging = true
  } else if (e.button === 2) {
    adsHeld = true
  }
  lastMouse = { x: e.clientX, y: e.clientY }
})
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    shootHeld = false
    dragging = false
  } else if (e.button === 2) {
    adsHeld = false
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
  const sens = baseSensitivity() * (player.ads ? ADS_SENSITIVITY * adsSensitivityScale(weaponState, BASE_FOV) : 1)
  player.look(dx, dy, sens)
  weaponView.look(dx, dy)
})
window.addEventListener('wheel', (e) => {
  if (state !== STATE.PLAYING) return
  e.preventDefault()
  if (cycleWeapon(weaponState, e.deltaY > 0 ? 1 : -1)) applyWeaponSwitch()
}, { passive: false })

function baseSensitivity() {
  return 0.0021
}

function selectWeapon(id) {
  if (switchWeapon(weaponState, id)) applyWeaponSwitch()
}

function applyWeaponSwitch() {
  weaponView.setWeapon(weaponState.current)
  audio.uiClick()
  ui.setWeaponName(WEAPONS[weaponState.current].name)
}

// ---------------------------------------------------------------------------
// 游戏流程
// ---------------------------------------------------------------------------
function startGame() {
  resetWeaponState(weaponState, selectedWeapon)
  lastReloading = { smg: false, sniper: false }
  player.reset(world.playerSpawn)
  enemyManager.reset()
  effects.clear()
  stats.shots = 0
  stats.hits = 0
  stats.kills = 0
  stats.headshots = 0
  elapsed = 0
  recoilPitch = 0
  recoilVel = 0
  stepDistance = 0
  wasOnGround = true
  audio.init()
  audio.resume()
  audio.uiClick()
  weaponView.setWeapon(selectedWeapon, true)
  weaponView.setHidden(false)
  ui.setScope(false)
  ui.showScreen('hud')
  ui.setSelectedWeapon(selectedWeapon)
  ui.setHealth(player.health)
  ui.setAmmo(weaponState.weapons[selectedWeapon].ammo, WEAPONS[selectedWeapon].magSize)
  ui.setWeaponName(WEAPONS[selectedWeapon].name)
  ui.setEnemies(enemyManager.aliveCount)
  ui.setStatus('交火中')
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
  menuTime = 0
  ui.showScreen('menu')
  ui.setScope(false)
  if (document.pointerLockElement) document.exitPointerLock()
}

function endGame(win) {
  if (state === STATE.VICTORY || state === STATE.DEFEAT) return
  state = win ? STATE.VICTORY : STATE.DEFEAT
  clearInput()
  const timeText = formatTime(elapsed)
  const accuracy = stats.shots > 0 ? stats.hits / stats.shots : 0
  ui.setScope(false)
  ui.setStatus(win ? '任务完成' : '演习失败')
  if (win) audio.victory()
  else audio.defeat()
  ui.showResult({ win, kills: stats.kills, time: timeText, accuracy, hits: stats.hits, shots: stats.shots })
  if (document.pointerLockElement) document.exitPointerLock()
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
}

// ---------------------------------------------------------------------------
// 射击
// ---------------------------------------------------------------------------
function applySpread(dir, spread) {
  if (spread <= 0) return dir
  const angle = Math.random() * Math.PI * 2
  const radius = Math.sqrt(Math.random()) * Math.tan(spread)
  const right = tmpVec.set(1, 0, 0).applyQuaternion(camera.quaternion)
  const up = tmpVec2.set(0, 1, 0).applyQuaternion(camera.quaternion)
  dir.addScaledVector(right, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius)
  return dir.normalize()
}

function fireWeapon() {
  const id = weaponState.current
  const def = WEAPONS[id]
  const ads = player.ads
  camera.getWorldDirection(tmpDir)
  const origin = camera.position.clone()
  const dir = applySpread(tmpDir.clone(), spreadFor(weaponState, { ads, moving: player.moving })).normalize()
  const shot = resolveShot(origin, dir, { solids: world.solids, enemies: enemyManager.hitTargets, maxDist: 160 })

  stats.shots += 1
  audio.shoot(id)
  weaponView.fire(id)
  recoilVel += id === 'sniper' ? 3.1 : 0.55

  const muzzle = weaponView.muzzleWorldPosition(camera, id)
  const endPoint = shot.type === 'none' ? origin.clone().addScaledVector(dir, 140) : shot.point
  effects.spawnTracer(muzzle, endPoint)

  const noisePos = { x: player.position.x, y: player.eyeY, z: player.position.z }
  enemyManager.alertNoise(noisePos)

  if (shot.type === 'enemy') {
    const part = shot.part
    const damage = damageFor(id, part)
    stats.hits += 1
    if (part === 'head') stats.headshots += 1
    const result = shot.enemy.takeDamage(damage, part)
    effects.hitCharacter(shot.point, shot.normal)
    ui.hitMarker(part === 'head')
    audio.hitMarker(part === 'head')
    if (part === 'head') ui.comic('爆头！', 0.5 + (Math.random() - 0.5) * 0.16, 0.4)
    else ui.comic(id === 'sniper' ? 'POW!' : '啪！', 0.5 + (Math.random() - 0.5) * 0.2, 0.42)
    if (result.died) {
      stats.kills += 1
      audio.enemyDown()
      ui.setEnemies(enemyManager.aliveCount)
      ui.toast('击倒一名纸板小兵 · 剩余 ' + enemyManager.aliveCount)
      if (enemyManager.aliveCount === 0) {
        // 最后一发的击杀与命中先记入统计，再判定胜利
        ui.setEnemies(0)
        endGame(true)
      }
    }
  } else if (shot.type === 'wall') {
    effects.impact(shot.point, shot.normal, 1)
  }
  void def
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

function updatePlaying(dt) {
  elapsed += dt
  const wantAds = (adsHeld || compatAds) && !isReloading(weaponState)
  player.ads = wantAds
  player.update(dt, {
    forward: (pressed.has('KeyW') ? 1 : 0) - (pressed.has('KeyS') ? 1 : 0),
    right: (pressed.has('KeyD') ? 1 : 0) - (pressed.has('KeyA') ? 1 : 0),
    jump: pressed.has('Space'),
    ads: wantAds
  })
  // 兼容模式：方向键转身
  if (compatMode) {
    // 兼容模式：方向键转向，F 射击，T 切换瞄准（边沿触发在键盘事件里处理）
    if (pressed.has('ArrowLeft')) player.look(-34, 0, 0.0021)
    if (pressed.has('ArrowRight')) player.look(34, 0, 0.0021)
    if (pressed.has('ArrowUp')) player.look(0, -22, 0.0021)
    if (pressed.has('ArrowDown')) player.look(0, 22, 0.0021)
  }
  enemyCtx.canFight = controlAcquired && !player.dead

  // 武器
  updateWeaponState(weaponState, dt)
  const reloaded = weaponState.justReloaded
  if (reloaded) audio.reloadEnd(reloaded)
  for (const id of ['smg', 'sniper']) {
    const now = isReloading(weaponState, id)
    if (now && !lastReloading[id]) audio.reloadStart(id)
    lastReloading[id] = now
  }

  const input = { pressed: shootPressed, held: shootHeld }
  if (shootPressed || shootHeld) {
    const res = tryFire(weaponState, input)
    if (res.fired) fireWeapon()
    else if (res.reason === 'empty') audio.dryFire()
  }
  shootPressed = false

  // 后坐与镜头
  recoilPitch += recoilVel * dt
  recoilVel -= recoilVel * Math.min(1, dt * 7)
  recoilPitch -= recoilPitch * Math.min(1, dt * 5.5)

  enemyManager.update(dt, enemyCtx)
  effects.update(dt)

  // 脚步声与落地
  if (state === STATE.PLAYING && enemyManager.aliveCount === 0) {
    // 所有击杀与命中已经在上面的射击结算中记录，这里只做胜利判定
    ui.setEnemies(0)
    endGame(true)
  }

  stepDistance += Math.hypot(player.velocity.x, player.velocity.z) * dt
  if (player.onGround && stepDistance > 2.3) {
    stepDistance = 0
    audio.footstep()
  }
  if (player.onGround && !wasOnGround) audio.land()
  wasOnGround = player.onGround

  syncCamera(dt)
  updateHud()
}

function syncCamera(dt) {
  const bobAmount = player.bob * 0.045
  const bobY = Math.sin(player.stepPhase) * bobAmount
  const bobX = Math.cos(player.stepPhase * 0.5) * bobAmount * 0.6
  camera.position.set(player.position.x, player.position.y + player.eyeHeight + bobY, player.position.z)
  const right = tmpVec.set(1, 0, 0).applyQuaternion(camera.quaternion)
  camera.position.addScaledVector(right, bobX)
  camera.rotation.set(player.pitch + recoilPitch, player.yaw, Math.sin(player.stepPhase * 0.5) * player.bob * 0.012)
  const wantScope = player.ads && weaponState.current === 'sniper' && !isReloading(weaponState)
  const targetFov = player.ads ? adsFov(weaponState, BASE_FOV) : BASE_FOV
  camFov += (targetFov - camFov) * Math.min(1, dt * (wantScope ? 18 : 14))
  camera.fov = camFov
  camera.updateProjectionMatrix()

  weaponView.setHidden(wantScope)
  ui.setScope(wantScope)
  weaponView.update(dt, {
    ads: player.ads,
    scoped: wantScope,
    moving: player.moving,
    bobSpeed: player.bob,
    reloadProgress: isReloading(weaponState) ? reloadProgress(weaponState) : 0
  })
  weaponView.camera.quaternion.copy(camera.quaternion)
  weaponView.camera.fov = camera.fov
  weaponView.camera.updateProjectionMatrix()
}

function updateHud() {
  const w = weaponState.weapons[weaponState.current]
  const def = WEAPONS[weaponState.current]
  ui.setHealth(player.health)
  ui.setAmmo(w.ammo, def.magSize)
  ui.setWeaponName(def.name)
  ui.setEnemies(enemyManager.aliveCount)
  ui.setTimer(elapsed)
  const reloading = isReloading(weaponState)
  ui.setReload(reloading ? reloadProgress(weaponState) : 0, reloading, '换弹中…')
  ui.setCrosshairSpread(3 + spreadFor(weaponState, { ads: player.ads, moving: player.moving }) * 500)
  if (!player.dead) {
    const near = enemyManager.enemies.some((e) => e.alive && e.state === 'attack' && Math.hypot(e.position.x - player.position.x, e.position.z - player.position.z) < 18)
    ui.setStatus(reloading ? '换弹中' : near ? '遭到射击' : '交火中')
  }
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
  onRestart: () => startGame(),
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

ui.setMuteButtons(false)
ui.setSelectedWeapon(selectedWeapon)
onResize()
camera.position.copy(MENU_CAM.pos)
camera.lookAt(MENU_CAM.look)
camera.fov = MENU_FOV
camera.updateProjectionMatrix()
ui.showScreen('menu')
requestAnimationFrame(frame)

// 开发模式下的确定性验收入口（生产构建会被移除）
if (import.meta.env.DEV) {
  window.__PAPER_STRIKE__ = {
    state: () => state,
    snapshot: () => ({
      state,
      compatMode,
      health: player.health,
      ammo: { smg: weaponState.weapons.smg.ammo, sniper: weaponState.weapons.sniper.ammo },
      current: weaponState.current,
      enemiesAlive: enemyManager.aliveCount,
      kills: stats.kills,
      shots: stats.shots,
      hits: stats.hits,
      time: elapsed,
      reloading: isReloading(weaponState),
      playerPos: [player.position.x, player.position.y, player.position.z],
      enemyStates: enemyManager.enemies.map((e) => ({ s: e.state, a: e.alive, x: +e.position.x.toFixed(2), z: +e.position.z.toFixed(2) })),
      fov: camera.fov,
      ads: player.ads,
      weaponVisible: weaponView.models[weaponState.current].visible,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles
    }),
    start: () => startGame(),
    look: (yaw, pitch) => { player.yaw = yaw; player.pitch = pitch },
    teleport: (x, z, y = 0) => { player.position.set(x, y, z); player.velocity.set(0, 0, 0) },
    press: (code, down = true) => { if (down) pressed.add(code); else pressed.delete(code) },
    setAds: (on) => { adsHeld = !!on },
    setFire: (on) => { shootHeld = !!on; if (on) shootPressed = true },
    fireOnce: () => { shootPressed = true; shootHeld = false },
    reload: () => startReload(weaponState),
    switchTo: (id) => selectWeapon(id),
    killEnemies: (n) => {
      let left = n
      for (const e of enemyManager.enemies) {
        if (left <= 0) break
        if (e.alive) { e.takeDamage(1000); stats.kills++; left-- }
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
      recoilPitch = 0
      recoilVel = 0
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
    weaponState
  }
}
