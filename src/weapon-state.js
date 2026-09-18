// 纸上交锋 · PAPER STRIKE —— 武器状态机（纯逻辑，可独立验证）
// 这里不触碰 DOM / Three.js，便于用 Node 做确定性测试。

export const WEAPONS = {
  smg: {
    id: 'smg',
    name: '蜂鸟 · 冲锋枪',
    shortName: '蜂鸟',
    auto: true,
    fireInterval: 0.1,
    magSize: 30,
    bodyDamage: 20,
    headDamage: 40,
    reloadTime: 1.5,
    spreadHip: 0.022,
    spreadAds: 0.006,
    adsFovScale: 0.88,
    adsZoom: 1.15,
    switchTime: 0.35
  },
  sniper: {
    id: 'sniper',
    name: '长鸣 · 狙击枪',
    shortName: '长鸣',
    auto: false,
    fireInterval: 1.2,
    magSize: 5,
    bodyDamage: 100,
    headDamage: 200,
    reloadTime: 2.2,
    spreadHip: 0.032,
    spreadAds: 0.00035,
    adsFovScale: 0.25,
    adsZoom: 4,
    switchTime: 0.5
  }
}

export const WEAPON_ORDER = ['smg', 'sniper']

export const MOVE_SPREAD_MULTIPLIER = 1.35

function freshWeapon(id) {
  return {
    id,
    ammo: WEAPONS[id].magSize,
    cooldown: 0,
    reloadRemaining: 0,
    reloadTotal: 0,
    shotsFired: 0
  }
}

export function createWeaponState(current = 'smg') {
  return {
    current,
    weapons: { smg: freshWeapon('smg'), sniper: freshWeapon('sniper') },
    switchTimer: 0,
    justReloaded: null,
    emptyClick: false
  }
}

export function resetWeaponState(state, current = 'smg') {
  state.current = current
  state.weapons.smg = freshWeapon('smg')
  state.weapons.sniper = freshWeapon('sniper')
  state.switchTimer = 0
  state.justReloaded = null
  state.emptyClick = false
  return state
}

export function currentWeapon(state) {
  return state.weapons[state.current]
}

export function isReloading(state, id = state.current) {
  return state.weapons[id].reloadRemaining > 0
}

export function reloadProgress(state, id = state.current) {
  const w = state.weapons[id]
  if (w.reloadTotal <= 0) return 0
  return 1 - Math.max(0, w.reloadRemaining) / w.reloadTotal
}

/** 推进冷却与换弹。暂停时不调用本函数，恢复后不会补发子弹。 */
export function updateWeaponState(state, dt) {
  state.justReloaded = null
  state.emptyClick = false
  if (dt <= 0) return state
  for (const id of WEAPON_ORDER) {
    const w = state.weapons[id]
    if (w.cooldown > 0) w.cooldown = Math.max(0, w.cooldown - dt)
    if (w.reloadRemaining > 0) {
      w.reloadRemaining -= dt
      if (w.reloadRemaining <= 0) {
        w.reloadRemaining = 0
        w.reloadTotal = 0
        w.ammo = WEAPONS[id].magSize
        state.justReloaded = id
      }
    }
  }
  if (state.switchTimer > 0) state.switchTimer = Math.max(0, state.switchTimer - dt)
  return state
}

export function startReload(state, id = state.current, { force = false } = {}) {
  const w = state.weapons[id]
  const def = WEAPONS[id]
  if (w.reloadRemaining > 0) return false           // 重复按 R 不重置进度
  if (w.ammo >= def.magSize) return false           // 满弹匣不需要换弹
  if (state.switchTimer > 0 && !force) return false // 切枪动画期间不接受
  w.reloadTotal = def.reloadTime
  w.reloadRemaining = def.reloadTime
  return true
}

export function cancelReload(state, id) {
  const w = state.weapons[id]
  if (w.reloadRemaining > 0) {
    w.reloadRemaining = 0
    w.reloadTotal = 0
    return true
  }
  return false
}

/** 切枪：取消换弹（保留原有弹量），冷却与弹匣各自独立 */
export function switchWeapon(state, id, { force = false } = {}) {
  if (!WEAPONS[id]) return false
  if (id === state.current && !force) return false
  if (state.switchTimer > 0) return false
  cancelReload(state, state.current)
  state.current = id
  state.switchTimer = WEAPONS[id].switchTime
  return true
}

export function cycleWeapon(state, dir = 1) {
  const idx = WEAPON_ORDER.indexOf(state.current)
  const next = WEAPON_ORDER[(idx + (dir > 0 ? 1 : WEAPON_ORDER.length - 1)) % WEAPON_ORDER.length]
  return switchWeapon(state, next)
}

/**
 * 尝试射击。
 * input: { pressed, held } —— pressed 表示本帧刚按下，held 表示持续按住。
 * 返回 { fired, reason }
 */
export function tryFire(state, input = {}) {
  const id = state.current
  const w = state.weapons[id]
  const def = WEAPONS[id]
  if (state.switchTimer > 0) return { fired: false, reason: 'switching' }
  if (w.reloadRemaining > 0) return { fired: false, reason: 'reloading' }
  if (!def.auto && !input.pressed) return { fired: false, reason: 'semi' }
  if (def.auto && !input.pressed && !input.held) return { fired: false, reason: 'idle' }
  if (w.cooldown > 0) return { fired: false, reason: 'cooldown' }
  if (w.ammo <= 0) {
    state.emptyClick = true
    startReload(state, id, { force: true })
    return { fired: false, reason: 'empty' }
  }
  w.ammo -= 1
  w.cooldown = def.fireInterval
  w.shotsFired += 1
  // 弹匣打空立即自动换弹
  if (w.ammo === 0) startReload(state, id, { force: true })
  return { fired: true, weapon: id, ammo: w.ammo }
}

export function spreadFor(state, { ads = false, moving = false } = {}) {
  const def = WEAPONS[state.current]
  const base = ads ? def.spreadAds : def.spreadHip
  return moving ? base * MOVE_SPREAD_MULTIPLIER : base
}

export function damageFor(id, part) {
  const def = WEAPONS[id]
  if (!def) return 0
  return part === 'head' ? def.headDamage : def.bodyDamage
}

/** 4 倍镜的投影放大：scopeFov = 2 * atan(tan(baseFov / 2) / zoom) */
export function scopeFov(baseFovDeg, zoom) {
  const base = (baseFovDeg * Math.PI) / 180
  return (2 * Math.atan(Math.tan(base / 2) / zoom) * 180) / Math.PI
}

export function adsFov(state, baseFovDeg) {
  const def = WEAPONS[state.current]
  if (def.adsZoom >= 2) return scopeFov(baseFovDeg, def.adsZoom)
  return baseFovDeg * def.adsFovScale
}

/**
 * 开镜灵敏度缩放：monitor-distance 匹配，让准星在屏幕上的移动距离与不开镜时一致。
 * 对走 scopeFov 的武器恒等于 1 / adsZoom（scopeFov 正是本式 tan 反算的）；
 * 对走线性 fov 的武器则贴合它自己的缩放。
 */
export function adsSensitivityScale(state, baseFovDeg) {
  const base = (baseFovDeg * Math.PI) / 180
  const ads = (adsFov(state, baseFovDeg) * Math.PI) / 180
  return Math.tan(ads / 2) / Math.tan(base / 2)
}
