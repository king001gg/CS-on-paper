// 纸上交锋 · PAPER STRIKE —— 关卡「日光街区」：数据、碰撞、导航与场景装配
// 纯数据部分（buildLevel / 导航 / 碰撞采样）不依赖 DOM，可在 Node 中单独测试。
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { PALETTE, makeRng, rand } from './sketch.js'
import * as TEX from './textures.js'

export { PALETTE }

/** 场地范围：约 46 × 50 米，Y 轴向上，初始朝向 -Z */
export const ARENA = { minX: -23, maxX: 23, minZ: -25, maxZ: 25, wallHeight: 4.5 }
export const PLAYER_SPAWN = { x: 0, y: 0, z: 19 }
export const ENEMY_SPAWNS = [
  { x: -16.9, z: 6.4 },
  { x: -17.2, z: -11.1 },
  { x: -2.4, z: -10.4 },
  { x: 4.4, z: -1.0 },
  { x: 18.0, z: -16.8 },
  { x: 4.9, z: -20.8 },
  { x: -13.3, z: -16.8 },
  { x: 19.1, z: 5.4 }
]

export const PHYS = {
  stepHeight: 0.35,
  gravity: 18,
  playerRadius: 0.33,
  playerHeight: 1.8,
  playerEye: 1.68,
  enemyRadius: 0.49,
  enemyHeight: 1.9
}

// ---------------------------------------------------------------------------
// 关卡数据
// ---------------------------------------------------------------------------
/**
 * 关卡由若干基础几何体拼装。y 为底面高度。
 * solid=true 的部件参与碰撞、射线遮挡与导航；standable=true 表示顶面可以站立。
 */
export function buildLevel() {
  const parts = []
  const decorations = []

  const box = (x, y, z, w, h, d, mat, o = {}) => {
    parts.push({ kind: 'box', x, y, z, w, h, d, mat, solid: o.solid !== false, standable: o.standable !== false, tile: o.tile ?? 2.6, tag: o.tag || mat, rotY: o.rotY || 0 })
  }
  const cyl = (x, y, z, r, h, mat, o = {}) => {
    parts.push({ kind: 'cyl', x, y, z, r, h, w: r * 2, d: r * 2, mat, solid: o.solid !== false, standable: o.standable !== false, tile: o.tile ?? 1.2, tag: o.tag || mat })
  }

  // ===== 场地围墙：约 46 × 50 米 =====
  box(0, 0, -25.5, 48, ARENA.wallHeight, 1, 'wallSand', { tile: 3.2, tag: 'wall' })
  box(0, 0, 25.5, 48, ARENA.wallHeight, 1, 'wallSand', { tile: 3.2, tag: 'wall' })
  box(-23.5, 0, 0, 1, ARENA.wallHeight, 52, 'wallSand', { tile: 3.2, tag: 'wall' })
  box(23.5, 0, 0, 1, ARENA.wallHeight, 52, 'wallSand', { tile: 3.2, tag: 'wall' })

  // ===== 三栋地标建筑 =====
  // 西侧青绿建筑 (-12, -0.5)
  box(-12, 0, -0.5, 10, 5.5, 8, 'wallTeal', { tile: 3.0, tag: 'building' })
  box(-12, 5.5, -0.5, 11, 0.45, 9, 'concrete', { standable: false, tile: 2.4, tag: 'roof' })
  // 东侧橘红建筑 (12, -11.5)
  box(12, 0, -11.5, 9, 5, 8, 'wallOrange', { tile: 3.0, tag: 'building' })
  box(12, 5, -11.5, 10, 0.45, 9, 'concrete', { standable: false, tile: 2.4, tag: 'roof' })
  // 北侧奶油色建筑 (-4.5, -22)
  box(-4.5, 0, -21.5, 13, 6, 7, 'wallCream', { tile: 3.0, tag: 'building' })
  box(-4.5, 6, -21.5, 14, 0.5, 8, 'concrete', { standable: false, tile: 2.4, tag: 'roof' })
  // 南侧补给棚（贴着西墙，留出狙击通道）
  box(-21.5, 0, 16, 3, 3.4, 6, 'wallCream', { tile: 2.6, tag: 'building' })
  box(-21.5, 3.4, 16, 3.6, 0.4, 6.6, 'concrete', { standable: false, tile: 2.4, tag: 'roof' })

  // ===== 东侧高台 x=10…18, z=-4…1, 高 2.5 =====
  box(14, 0, -1.5, 8, 2.5, 5, 'concrete', { tile: 2.2, tag: 'plateau' })
  box(14, 2.5, 0.7, 8, 0.16, 0.4, 'hazard', { solid: false, tile: 0.8, tag: 'curb' })
  box(10.2, 2.5, -1.5, 0.4, 0.16, 5, 'hazard', { solid: false, tile: 0.8, tag: 'curb' })
  // 高台坡道：x=11…15, z=1…9，从 z=9 的地面升到 z=1 的台面
  const STEPS = 8
  for (let k = 0; k < STEPS; k++) {
    const h = (2.5 * (k + 1)) / STEPS
    box(13, 0, 8.5 - k, 4, h, 1, 'concrete', { tile: 1.6, tag: 'ramp' })
  }

  // ===== 中央庭院掩体 =====
  // 出生点前方的木箱与两侧屏风墙
  box(0, 0, 15.6, 2.6, 1.05, 1.1, 'crate', { tile: null, tag: 'crate' })
  box(-3.4, 0, 17.2, 0.5, 2.3, 4.2, 'wallTeal', { tile: 1.6, tag: 'screen' })
  box(3.4, 0, 17.2, 0.5, 2.3, 4.2, 'wallOrange', { tile: 1.6, tag: 'screen' })

  // 矮墙
  box(0, 0, -3.0, 7, 1.0, 0.6, 'wallSand', { tile: 1.8, tag: 'cover' })
  box(5.5, 0, -12.5, 0.6, 1.1, 5, 'wallSand', { tile: 1.8, tag: 'cover' })
  box(-6.5, 0, -16.5, 5, 1.0, 0.6, 'wallSand', { tile: 1.8, tag: 'cover' })
  box(8.5, 0, 9.5, 0.6, 1.05, 4, 'wallSand', { tile: 1.8, tag: 'cover' })
  box(17, 0, -20.5, 5, 1.1, 0.6, 'wallSand', { tile: 1.8, tag: 'cover' })
  box(-20.6, 0, -2.0, 0.6, 1.0, 5, 'wallSand', { tile: 1.8, tag: 'cover' })

  // 拱门
  box(-5.6, 0, -9.0, 0.9, 3.6, 0.9, 'wallOrange', { tile: 1.6, tag: 'pillar' })
  box(-2.6, 0, -9.0, 0.9, 3.6, 0.9, 'wallOrange', { tile: 1.6, tag: 'pillar' })
  box(-4.1, 3.6, -9.0, 4.0, 0.7, 1.1, 'wallOrange', { standable: false, tile: 1.6, tag: 'arch' })

  // 木箱群
  const crate = (x, y, z, s, o = {}) => box(x, y, z, s[0], s[1], s[2], 'crate', { tile: null, tag: 'crate', ...o })
  crate(3.6, 0, 11.5, [1.5, 1.4, 1.5])
  crate(5.0, 0, 12.4, [1.1, 0.95, 1.1])
  crate(3.9, 1.4, 11.6, [1.2, 0.9, 1.2])
  crate(-5.2, 0, 9.5, [1.6, 1.3, 1.6])
  crate(-6.6, 0, 10.7, [1.2, 1.05, 1.2])
  crate(-2.0, 0, 1.5, [1.4, 1.05, 1.4])
  crate(-2.0, 1.05, 1.45, [1.1, 1.0, 1.1])
  crate(5.2, 0, -6.5, [1.6, 1.35, 1.6])
  crate(6.6, 0, -5.6, [1.15, 1.0, 1.15])
  crate(0.5, 0, -13.0, [1.5, 1.25, 1.5])
  crate(9.2, 0, 6.5, [1.4, 1.1, 1.4])
  crate(-20.8, 0, 4.0, [1.4, 1.2, 1.4])
  crate(-14.0, 0, -21.5, [1.5, 1.2, 1.5])
  crate(20.4, 0, 14.2, [1.5, 1.2, 1.5])

  // 油桶
  for (const [x, z] of [[-6.2, -3.2], [7.0, -9.0], [1.2, 7.6], [-1.6, -17.4], [10.5, 11.0], [-16.0, -14.5], [16.9, 8.6], [19.8, -6.5]]) {
    cyl(x, 0, z, 0.45, 0.95, 'barrel', { tag: 'barrel' })
  }

  // 仙人掌
  for (const [x, z, s] of [[-21.6, 22.5, 1.1], [21.6, 20.5, 0.95], [-21.9, -6.5, 1.0], [21.4, -13.0, 1.05]]) {
    box(x, 0, z, 0.9 * s, 2.3 * s, 0.9 * s, 'cactus', { tag: 'cactus' })
    decorations.push({ type: 'cactus', x, y: 0, z, s })
  }

  // 电线杆
  const poles = [[-3, 8], [6.5, -17.5], [20, 10]]
  for (const [x, z] of poles) {
    box(x, 0, z, 0.3, 5.2, 0.3, 'wood', { tag: 'pole' })
    decorations.push({ type: 'pole', x, z, h: 5.2 })
  }
  decorations.push({ type: 'wire', from: [-3, 5.0, 8], to: [6.5, 5.0, -17.5] })
  decorations.push({ type: 'wire', from: [-3, 5.0, 8], to: [20, 5.0, 10] })
  decorations.push({ type: 'wire', from: [-3, 4.8, 8], to: [-7.2, 5.4, 3.2] })

  // 旗串
  decorations.push({ type: 'flagline', from: [-3.2, 4.4, 8.2], to: [-6.9, 4.9, 3.0], count: 7, colors: [PALETTE.yellow, PALETTE.uiAccent, PALETTE.teal, PALETTE.blue] })
  decorations.push({ type: 'flagline', from: [6.3, 4.4, -17.3], to: [11.5, 4.0, -15.6], count: 6, colors: [PALETTE.uiAccent, PALETTE.yellow, PALETTE.cream] })

  // 窗户 / 门 / 招牌
  const win = (x, y, z, rotY, w = 1.15, h = 1.45, variant = 0) => decorations.push({ type: 'window', x, y, z, rotY, w, h, variant })
  // 青绿建筑东面（面向庭院）与南面
  for (const z of [-2.6, -0.5, 1.6]) { win(-6.94, 1.7, z, Math.PI / 2, 1.15, 1.45, 1); win(-6.94, 3.7, z, Math.PI / 2, 1.15, 1.45, 0) }
  win(-14.5, 2.6, 3.54, 0, 1.3, 1.6, 2)
  win(-10.0, 2.6, 3.54, 0, 1.3, 1.6, 0)
  // 橘红建筑西面与南面
  for (const z of [-13.6, -11.5, -9.4]) { win(7.44, 1.7, z, -Math.PI / 2, 1.15, 1.45, 1); win(7.44, 3.6, z, -Math.PI / 2, 1.15, 1.45, 0) }
  win(10.5, 2.5, -7.44, 0, 1.3, 1.6, 0)
  win(14.0, 2.5, -7.44, 0, 1.3, 1.6, 2)
  // 奶油色建筑南面
  for (const x of [-8.5, -4.5, -0.5]) { win(x, 1.9, -17.94, 0, 1.25, 1.55, 0); win(x, 4.1, -17.94, 0, 1.25, 1.55, 1) }
  // 补给棚东面
  win(-19.94, 1.9, 16, Math.PI / 2, 1.1, 1.4, 2)

  const sign = (text, x, y, z, rotY, o = {}) => decorations.push({ type: 'sign', text, x, y, z, rotY, size: o.size || 1.6, bg: o.bg, color: o.color, rotate: o.rotate || 0 })
  sign('RANGE 01', 6.5, 3.1, 24.94, Math.PI, { size: 2.4, bg: PALETTE.warmWhite, color: PALETTE.ink })
  sign('INKYARD', -6.9, 4.95, -1.0, Math.PI / 2, { size: 1.5, bg: PALETTE.warmWhite, color: PALETTE.teal })
  sign('SUPPLY', -19.9, 2.9, 16, Math.PI / 2, { size: 1.3, bg: PALETTE.yellow, color: PALETTE.ink })
  sign('HIGH GROUND', 9.94, 1.5, -1.5, -Math.PI / 2, { size: 3.4, bg: PALETTE.warmWhite, color: PALETTE.uiAccent })
  sign('A', -22.94, 2.2, 6, Math.PI / 2, { size: 1.1, bg: PALETTE.yellow, color: PALETTE.ink, rotate: -0.08 })
  sign('B', 22.94, 2.2, 6, -Math.PI / 2, { size: 1.1, bg: PALETTE.blue, color: PALETTE.ink, rotate: 0.07 })
  sign('日光街区', -4.5, 5.4, -17.9, 0, { size: 3.0, bg: PALETTE.cream, color: PALETTE.uiAccent })
  sign('RAMP →', 10.6, 1.2, 7.4, -Math.PI / 2, { size: 1.2, bg: PALETTE.warmWhite, color: PALETTE.ink, rotate: -0.05 })
  sign('pew pew!', -3.4, 2.55, 14.9, 0, { size: 1.0 })

  // 涂鸦
  decorations.push({ type: 'graffiti', kind: 'star', x: -6.9, y: 1.1, z: 2.9, rotY: Math.PI / 2, size: 0.8 })
  decorations.push({ type: 'graffiti', kind: 'arrow', x: 14, y: 1.5, z: 1.06, rotY: 0, size: 1.4 })
  decorations.push({ type: 'graffiti', kind: 'star', x: 7.42, y: 4.6, z: -13.6, rotY: -Math.PI / 2, size: 0.7 })

  // 地面标记
  decorations.push({ type: 'groundmark', kind: 'arrow', x: -2.5, y: 0.02, z: 12.5, rotY: 0, size: 1.6 })
  decorations.push({ type: 'groundmark', kind: 'star', x: 14, y: 0.03, z: 6.5, rotY: 0, size: 1.2 })
  decorations.push({ type: 'patch', x: 0, y: 0.015, z: -7, w: 26, d: 26, color: PALETTE.blue, alpha: 0.16 })
  decorations.push({ type: 'patch', x: 13, y: 0.014, z: 12, w: 16, d: 20, color: PALETTE.yellow, alpha: 0.14 })

  // 远景几何建筑（墙外，纯装饰）
  const rng = makeRng(4242)
  for (let i = 0; i < 22; i++) {
    const north = i < 12
    const x = north ? rand(rng, -40, 40) : (rng() < 0.5 ? rand(rng, -46, -30) : rand(rng, 30, 46))
    const z = north ? rand(rng, -62, -30) : rand(rng, -45, 45)
    const w = rand(rng, 6, 14)
    const h = rand(rng, 7, 19)
    const d = rand(rng, 6, 14)
    decorations.push({ type: 'distant', x, z, w, h, d, color: [PALETTE.cream, PALETTE.orange, PALETTE.teal, PALETTE.blue, PALETTE.sand][Math.floor(rng() * 5) % 5] })
  }

  const solids = parts.filter((p) => p.solid).map((p, i) => ({
    id: i,
    kind: p.kind,
    tag: p.tag,
    x: p.x, y: p.y, z: p.z,
    r: p.r || 0,
    minX: p.x - p.w / 2, maxX: p.x + p.w / 2,
    minY: p.y, maxY: p.y + p.h,
    minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2,
    standable: p.standable
  }))

  return { parts, decorations, solids }
}

// ---------------------------------------------------------------------------
// 碰撞采样（纯函数，可在 Node 中测试）
// ---------------------------------------------------------------------------

/** 站立面高度：地面为 0，其余取该点上方最高的可站立顶面 */
export function surfaceHeightAt(solids, x, z) {
  let best = 0
  for (const s of solids) {
    if (!s.standable) continue
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue
    if (s.maxY > best) best = s.maxY
  }
  return best
}

/** 给定脚底高度，返回脚下支撑面高度（含台阶容差） */
export function supportHeightAt(solids, x, z, feetY, stepHeight = PHYS.stepHeight, radius = 0) {
  let best = 0
  for (const s of solids) {
    if (!s.standable) continue
    if (s.maxY > feetY + stepHeight) continue
    if (x + radius < s.minX || x - radius > s.maxX || z + radius < s.minZ || z - radius > s.maxZ) continue
    if (s.maxY > best) best = s.maxY
  }
  return best
}

/** 头顶最低阻挡面高度 */
export function ceilingHeightAt(solids, x, z, feetY, headY, radius = 0) {
  let best = Infinity
  for (const s of solids) {
    if (s.minY < feetY + 0.35) continue
    if (s.minY > headY + 0.6) continue
    if (x + radius < s.minX || x - radius > s.maxX || z + radius < s.minZ || z - radius > s.maxZ) continue
    if (s.minY < best) best = s.minY
  }
  return best
}

/** 角色胶囊（半径 r，自 y 到 y+height）是否与实体重叠；stepAllow 以内的台阶不算阻挡 */
export function capsuleBlocked(solids, x, z, y, r, height, stepAllow = 0) {
  const top = y + height
  for (const s of solids) {
    if (s.maxY <= y + stepAllow) continue
    if (s.minY >= top) continue
    const cx = Math.max(s.minX, Math.min(x, s.maxX))
    const cz = Math.max(s.minZ, Math.min(z, s.maxZ))
    const dx = x - cx
    const dz = z - cz
    if (dx * dx + dz * dz < r * r) return true
  }
  return false
}

/** 采样整条线段是否可通行（计入角色半径与地面高度变化） */
export function segmentClear(solids, ax, az, ay, bx, bz, by, r, height, stepAllow = 0.45) {
  const dist = Math.hypot(bx - ax, bz - az)
  const steps = Math.max(2, Math.ceil(dist / 0.3))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = ax + (bx - ax) * t
    const z = az + (bz - az) * t
    const y = ay + (by - ay) * t
    if (capsuleBlocked(solids, x, z, y, r, height, stepAllow)) return false
  }
  return true
}

/** 单轴水平移动与推出（沿墙滑动的基础） */
export function moveAxis(solids, pos, vel, radius, height, stepHeight, axis, amount) {
  if (amount === 0) return
  pos[axis] += amount
  const feet = pos.y
  const head = feet + height
  for (const s of solids) {
    if (s.maxY <= feet + stepHeight) continue
    if (s.minY >= head - 1e-4) continue
    if (pos.x + radius <= s.minX || pos.x - radius >= s.maxX) continue
    if (pos.z + radius <= s.minZ || pos.z - radius >= s.maxZ) continue
    if (axis === 'x') {
      pos.x = amount > 0 ? s.minX - radius : s.maxX + radius
      vel.x = 0
    } else {
      pos.z = amount > 0 ? s.minZ - radius : s.maxZ + radius
      vel.z = 0
    }
  }
}

/**
 * 角色体（圆柱近似）与地形的统一积分：水平推出 + 重力支撑 + 台阶吸附 + 头顶碰撞。
 * 玩家与敌人共用同一套实现，保证手感与穿墙保护一致。
 */
export function integrateBody(solids, pos, vel, dt, o = {}) {
  const radius = o.radius ?? PHYS.playerRadius
  const height = o.height ?? PHYS.playerHeight
  const stepHeight = o.stepHeight ?? PHYS.stepHeight
  const wasGround = !!o.onGround
  const prevX = pos.x
  const prevZ = pos.z

  moveAxis(solids, pos, vel, radius, height, stepHeight, 'x', vel.x * dt)
  moveAxis(solids, pos, vel, radius, height, stepHeight, 'z', vel.z * dt)
  pos.y += vel.y * dt

  let support = supportHeightAt(solids, pos.x, pos.z, pos.y, stepHeight, 0.12)
  let onGround = false
  if (pos.y <= support) {
    pos.y = support
    if (vel.y < 0) vel.y = 0
    onGround = true
  } else if (wasGround && vel.y <= 0 && pos.y - support <= stepHeight + 0.06) {
    // 下台阶吸附，避免走坡道/楼梯时一跳一跳
    pos.y = support
    vel.y = 0
    onGround = true
  }

  const headY = pos.y + height
  const ceil = ceilingHeightAt(solids, pos.x, pos.z, pos.y, headY, 0.12)
  if (headY > ceil) {
    pos.y = Math.max(support, ceil - height)
    if (vel.y > 0) vel.y = 0
  }

  return { onGround, movedX: pos.x - prevX, movedZ: pos.z - prevZ }
}

// ---------------------------------------------------------------------------
// 导航图
// ---------------------------------------------------------------------------
export function buildNavGraph(solids, o = {}) {
  const cell = o.cell ?? 1.0
  const clearance = o.clearance ?? 0.62
  const bodyHeight = o.bodyHeight ?? 1.85
  const stepAllow = o.stepAllow ?? 0.45
  const minX = (o.minX ?? ARENA.minX) + 1.4
  const maxX = (o.maxX ?? ARENA.maxX) - 1.4
  const minZ = (o.minZ ?? ARENA.minZ) + 1.4
  const maxZ = (o.maxZ ?? ARENA.maxZ) - 1.4

  const nodes = []
  const lookup = new Map()
  const cols = Math.floor((maxX - minX) / cell) + 1
  const rows = Math.floor((maxZ - minZ) / cell) + 1
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const x = minX + ix * cell
      const z = minZ + iz * cell
      const y = surfaceHeightAt(solids, x, z)
      if (capsuleBlocked(solids, x, z, y, clearance, bodyHeight, stepAllow)) continue
      const id = nodes.length
      nodes.push({ id, x, y, z, ix, iz, links: [], cost: [] })
      lookup.set(ix + ',' + iz, id)
    }
  }

  const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]
  for (const n of nodes) {
    for (const [dx, dz, w] of dirs) {
      const other = lookup.get(n.ix + dx + ',' + (n.iz + dz))
      if (other === undefined) continue
      const m = nodes[other]
      if (Math.abs(m.y - n.y) > 0.5) continue
      if (!segmentClear(solids, n.x, n.z, n.y, m.x, m.z, m.y, clearance, bodyHeight, stepAllow)) continue
      n.links.push(m.id)
      n.cost.push(w * cell)
    }
  }

  const graph = { nodes, lookup, cell, clearance, bodyHeight, stepAllow, minX, minZ, cols, rows }
  pruneToLargestComponent(graph)
  return graph
}

/** 只保留最大连通分量，避免敌人被派进孤岛 */
export function pruneToLargestComponent(graph) {
  const seen = new Uint8Array(graph.nodes.length)
  let best = []
  for (const n of graph.nodes) {
    if (seen[n.id]) continue
    const stack = [n.id]
    const comp = []
    seen[n.id] = 1
    while (stack.length) {
      const id = stack.pop()
      comp.push(id)
      for (const nb of graph.nodes[id].links) {
        if (!seen[nb]) { seen[nb] = 1; stack.push(nb) }
      }
    }
    if (comp.length > best.length) best = comp
  }
  const keep = new Uint8Array(graph.nodes.length)
  for (const id of best) keep[id] = 1
  for (const n of graph.nodes) {
    if (!keep[n.id]) { n.links = []; n.cost = []; n.orphan = true }
    else {
      const L = []
      const C = []
      for (let i = 0; i < n.links.length; i++) {
        if (keep[n.links[i]]) { L.push(n.links[i]); C.push(n.cost[i]) }
      }
      n.links = L
      n.cost = C
    }
  }
  graph.mainComponent = best
  return graph
}

export function nearestNode(graph, x, z, opt = {}) {
  let best = -1
  let bestD = Infinity
  const maxD = opt.maxDist ?? 6
  for (const n of graph.nodes) {
    if (n.orphan) continue
    if (opt.preferY !== undefined && Math.abs(n.y - opt.preferY) > (opt.maxDY ?? 0.6)) continue
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z)
    if (d < bestD) { bestD = d; best = n.id }
  }
  if (best < 0 || Math.sqrt(bestD) > maxD) return -1
  return best
}

export function findPath(graph, startId, goalId) {
  if (startId < 0 || goalId < 0) return null
  if (startId === goalId) return [startId]
  const nodes = graph.nodes
  const open = new MinHeap()
  const gScore = new Float64Array(nodes.length).fill(Infinity)
  const came = new Int32Array(nodes.length).fill(-1)
  const closed = new Uint8Array(nodes.length)
  const h = (a, b) => Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z) + Math.abs(nodes[a].y - nodes[b].y) * 1.5
  gScore[startId] = 0
  open.push(startId, h(startId, goalId))
  while (open.size) {
    const current = open.pop()
    if (current === goalId) {
      const path = [current]
      let c = current
      while (came[c] !== -1) { c = came[c]; path.push(c) }
      return path.reverse()
    }
    if (closed[current]) continue
    closed[current] = 1
    const n = nodes[current]
    for (let i = 0; i < n.links.length; i++) {
      const nb = n.links[i]
      if (closed[nb]) continue
      const tentative = gScore[current] + n.cost[i]
      if (tentative < gScore[nb]) {
        gScore[nb] = tentative
        came[nb] = current
        open.push(nb, tentative + h(nb, goalId))
      }
    }
  }
  return null
}

class MinHeap {
  constructor() { this.ids = []; this.keys = [] }
  get size() { return this.ids.length }
  push(id, key) {
    this.ids.push(id)
    this.keys.push(key)
    let i = this.ids.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p] <= this.keys[i]) break
      this.swap(p, i)
      i = p
    }
  }
  pop() {
    const top = this.ids[0]
    const lastId = this.ids.pop()
    const lastKey = this.keys.pop()
    if (this.ids.length) {
      this.ids[0] = lastId
      this.keys[0] = lastKey
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r
        if (m === i) break
        this.swap(m, i)
        i = m
      }
    }
    return top
  }
  swap(a, b) {
    const ti = this.ids[a]; this.ids[a] = this.ids[b]; this.ids[b] = ti
    const tk = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = tk
  }
}

/** 拉直路径：能直达就跳过中间点 */
export function smoothPath(solids, graph, ids) {
  if (!ids || ids.length <= 2) return ids ? ids.slice() : []
  const out = [ids[0]]
  let i = 0
  while (i < ids.length - 1) {
    let j = ids.length - 1
    for (; j > i + 1; j--) {
      const a = graph.nodes[ids[i]]
      const b = graph.nodes[ids[j]]
      if (Math.abs(a.y - b.y) <= 0.55 && segmentClear(solids, a.x, a.z, a.y, b.x, b.z, b.y, graph.clearance, graph.bodyHeight, graph.stepAllow)) break
    }
    out.push(ids[j])
    i = j
  }
  return out
}

// ---------------------------------------------------------------------------
// 场景装配
// ---------------------------------------------------------------------------
function worldUV(geo, w, h, d, tile) {
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const axes = [['z', 'y'], ['z', 'y'], ['x', 'z'], ['x', 'z'], ['x', 'y'], ['x', 'y']]
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i
      const p = { x: pos.getX(idx), y: pos.getY(idx), z: pos.getZ(idx) }
      uv.setXY(idx, p[axes[f][0]] / tile, p[axes[f][1]] / tile)
    }
  }
  uv.needsUpdate = true
  return geo
}

class Builder {
  constructor(materials, rng) {
    this.materials = materials
    this.buckets = new Map()
    this.outlineGeoms = []
    this.rng = rng || makeRng(31337)
    this.sketch = []
    this.echo = []
  }

  /**
   * 手绘草稿线：沿盒体棱边画带抖动的描边，向外偏移一点并随机断笔。
   * 使用固定种子，所以每次运行的抖动完全一致（不会逐帧闪动）。
   */
  addSketchBox(w, h, d, matrix) {
    const rng = this.rng
    const hx = w / 2
    const hy = h / 2
    const hz = d / 2
    const c = [
      [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz],
      [-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]
    ]
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    const p = new THREE.Vector3()
    for (const [ia, ib] of edges) {
      const a = c[ia]
      const b = c[ib]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      if (len < 0.16) continue
      const segments = Math.max(2, Math.min(5, Math.round(len / 1.6) + 1))
      const target = rng() < 0.4 ? this.echo : this.sketch
      const jitter = target === this.echo ? 0.046 : 0.028
      const push = target === this.echo ? 0.045 : 0.022
      let prev = null
      for (let i = 0; i <= segments; i++) {
        const t = i / segments
        const lx = a[0] + (b[0] - a[0]) * t + (i === 0 || i === segments ? 0 : (rng() - 0.5) * jitter * 2)
        const ly = a[1] + (b[1] - a[1]) * t + (i === 0 || i === segments ? 0 : (rng() - 0.5) * jitter * 2)
        const lz = a[2] + (b[2] - a[2]) * t + (i === 0 || i === segments ? 0 : (rng() - 0.5) * jitter * 2)
        const n = Math.hypot(lx, ly * 0.5, lz) || 1
        p.set(
          lx + (lx / n) * push,
          ly + ((ly * 0.5) / n) * push,
          lz + (lz / n) * push
        ).applyMatrix4(matrix)
        if (prev && !(i > 0 && rng() < 0.09)) {
          target.push(prev.x, prev.y, prev.z, p.x, p.y, p.z)
        }
        prev = { x: p.x, y: p.y, z: p.z }
      }
    }
  }
  push(matKey, geo) {
    if (!this.buckets.has(matKey)) this.buckets.set(matKey, [])
    this.buckets.get(matKey).push(geo)
  }
  addBox(w, h, d, matrix, matKey, o = {}) {
    const tile = o.tile
    let geo = new THREE.BoxGeometry(w, h, d)
    if (tile) worldUV(geo, w, h, d, tile)
    geo.applyMatrix4(matrix)
    this.push(matKey, geo)
    if (o.outline !== false) {
      const pad = o.pad ?? Math.min(0.036, Math.max(0.012, Math.min(w, h, d) * 0.04))
      const og = new THREE.BoxGeometry(w + pad * 2, h + pad * 2, d + pad * 2)
      og.applyMatrix4(matrix)
      this.outlineGeoms.push(og)
    }
    if (o.sketch !== false) this.addSketchBox(w, h, d, matrix)
  }
  addCyl(r, h, seg, matrix, matKey, o = {}) {
    const geo = new THREE.CylinderGeometry(r, r * (o.taper ?? 1), h, seg, 1)
    geo.applyMatrix4(matrix)
    this.push(matKey, geo)
    if (o.outline !== false) {
      const pad = o.pad ?? 0.035
      const og = new THREE.CylinderGeometry(r + pad, (r + pad) * (o.taper ?? 1), h + pad * 2, seg, 1)
      og.applyMatrix4(matrix)
      this.outlineGeoms.push(og)
    }
  }
  addGeo(geo, matrix, matKey) {
    geo.applyMatrix4(matrix)
    this.push(matKey, geo)
  }
  build(parent) {
    const made = []
    for (const [matKey, geos] of this.buckets) {
      if (!geos.length) continue
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, this.materials[matKey])
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.name = 'merged-' + matKey
      parent.add(mesh)
      made.push(mesh)
    }
    if (this.outlineGeoms.length) {
      const merged = this.outlineGeoms.length === 1 ? this.outlineGeoms[0] : mergeGeometries(this.outlineGeoms, false)
      if (merged) {
        const mesh = new THREE.Mesh(merged, this.materials.outline)
        mesh.name = 'outlines'
        mesh.renderOrder = 1
        parent.add(mesh)
        made.push(mesh)
      }
    }
    if (this.sketch.length) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(this.sketch, 3))
      const line = new THREE.LineSegments(geo, this.materials.sketchLine)
      line.name = 'sketch-strokes'
      parent.add(line)
      made.push(line)
    }
    if (this.echo.length) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(this.echo, 3))
      const line = new THREE.LineSegments(geo, this.materials.sketchEcho)
      line.name = 'sketch-echo'
      parent.add(line)
      made.push(line)
    }
    this.buckets.clear()
    this.outlineGeoms.length = 0
    this.sketch.length = 0
    this.echo.length = 0
    return made
  }
}

export function createWorld(scene) {
  const level = buildLevel()
  const rng = makeRng(20240607)
  const maxAniso = 4

  const toon = (map, o = {}) => {
    const t = map.clone()
    t.needsUpdate = true
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = maxAniso
    return new THREE.MeshToonMaterial({ map: t, gradientMap: TEX.toonGradientMap(), color: o.color ?? 0xffffff, transparent: !!o.transparent, opacity: o.opacity ?? 1, alphaTest: o.alphaTest ?? 0, side: o.side ?? THREE.FrontSide, depthWrite: o.depthWrite !== false, fog: o.fog !== false })
  }

  const materials = {
    wallSand: toon(TEX.wallTexture('cream'), { color: 0xe4d3ac }),
    wallCream: toon(TEX.wallTexture('cream')),
    wallTeal: toon(TEX.wallTexture('teal')),
    wallOrange: toon(TEX.wallTexture('orange')),
    crate: toon(TEX.crateTexture()),
    barrel: toon(TEX.barrelTexture()),
    concrete: toon(TEX.concreteTexture(), { color: 0xdfe9ea }),
    hazard: toon(TEX.hazardTexture()),
    cactus: toon(TEX.wallTexture('teal'), { color: 0x6f9e6a }),
    wood: toon(TEX.cardboardTexture(), { color: 0xc9a877 }),
    outline: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ink), side: THREE.BackSide }),
    sketchLine: new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.ink), transparent: true, opacity: 0.6 }),
    sketchEcho: new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.ink), transparent: true, opacity: 0.3 })
  }

  const group = new THREE.Group()
  group.name = 'level'
  scene.add(group)
  const builder = new Builder(materials, makeRng(24680))

  const M = (x, y, z, rotY = 0) => new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y + 0, z)
  const boxM = (b, cx, cy, cz) => new THREE.Matrix4().identity().setPosition(cx, cy, cz)

  for (const p of level.parts) {
    const cy = p.y + p.h / 2
    const matrix = new THREE.Matrix4().makeRotationY(p.rotY || 0).setPosition(p.x, cy, p.z)
    if (p.kind === 'cyl') builder.addCyl(p.r, p.h, 14, matrix, p.mat, { pad: 0.03 })
    else builder.addBox(p.w, p.h, p.d, matrix, p.mat, { tile: p.tile })
  }

  // ---- 地面 ----
  const groundGeo = new THREE.PlaneGeometry(ARENA.maxX - ARENA.minX + 40, ARENA.maxZ - ARENA.minZ + 40)
  const groundTex = TEX.groundTexture().clone()
  groundTex.needsUpdate = true
  groundTex.colorSpace = THREE.SRGBColorSpace
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping
  groundTex.repeat.set((ARENA.maxX - ARENA.minX + 40) / 8, (ARENA.maxZ - ARENA.minZ + 40) / 8)
  groundTex.anisotropy = maxAniso
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshToonMaterial({ map: groundTex, gradientMap: TEX.toonGradientMap() }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  ground.name = 'ground'
  group.add(ground)

  // ---- 装饰 ----
  const decor = new THREE.Group()
  decor.name = 'decor'
  group.add(decor)
  const dmat = (tex, o = {}) => new THREE.MeshBasicMaterial({ map: tex, transparent: o.transparent !== false, alphaTest: o.alphaTest ?? 0.35, side: o.side ?? THREE.FrontSide, depthWrite: o.depthWrite ?? true, color: o.color ?? 0xffffff, opacity: o.opacity ?? 1, fog: o.fog !== false })
  const decals = []

  const addDecal = (texture, x, y, z, rotY, w, h, o = {}) => {
    const g = new THREE.PlaneGeometry(w, h)
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z)
    g.applyMatrix4(m)
    const mesh = new THREE.Mesh(g, dmat(texture, o))
    decor.add(mesh)
    decals.push(mesh)
    return mesh
  }

  for (const d of level.decorations) {
    if (d.type === 'window') {
      addDecal(TEX.windowTexture(d.variant), d.x, d.y, d.z, d.rotY, d.w, d.h)
    } else if (d.type === 'sign') {
      const tex = TEX.signTexture(d.text, { bg: d.bg, color: d.color, rotate: d.rotate, fontSize: 48 })
      const aspect = tex.userData.aspect || 4
      addDecal(tex, d.x, d.y, d.z, d.rotY, d.size * aspect * 0.32, d.size * 0.32)
    } else if (d.type === 'graffiti') {
      addDecal(TEX.graffitiTexture(d.kind), d.x, d.y, d.z, d.rotY, d.size, d.size, { color: d.kind === 'arrow' ? 0xffffff : 0xffffff })
    } else if (d.type === 'groundmark') {
      const g = new THREE.PlaneGeometry(d.size, d.size)
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(d.x, d.y, d.z))
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: TEX.graffitiTexture(d.kind), transparent: true, depthWrite: false, opacity: 0.75, color: 0xffffff, fog: true }))
      mesh.rotation.z = d.rotY
      decor.add(mesh)
    } else if (d.type === 'patch') {
      const g = new THREE.PlaneGeometry(d.w, d.d)
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(d.x, d.y, d.z))
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(d.color), transparent: true, opacity: d.alpha, depthWrite: false }))
      decor.add(mesh)
    } else if (d.type === 'cactus') {
      const arm = new THREE.Group()
      const m1 = new THREE.Matrix4().setPosition(d.x, d.y + 1.15 * d.s, d.z)
      builder.addCyl(0.32 * d.s, 2.3 * d.s, 10, m1, 'cactus', { pad: 0.03 })
      builder.addCyl(0.16 * d.s, 0.62 * d.s, 8, new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(d.x + 0.38 * d.s, d.y + 1.5 * d.s, d.z), 'cactus', { pad: 0.03 })
      builder.addCyl(0.16 * d.s, 0.5 * d.s, 8, new THREE.Matrix4().setPosition(d.x + 0.62 * d.s, d.y + 1.75 * d.s, d.z), 'cactus', { pad: 0.03 })
      builder.addCyl(0.15 * d.s, 0.55 * d.s, 8, new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(d.x - 0.34 * d.s, d.y + 1.05 * d.s, d.z), 'cactus', { pad: 0.03 })
      builder.addCyl(0.15 * d.s, 0.45 * d.s, 8, new THREE.Matrix4().setPosition(d.x - 0.56 * d.s, d.y + 1.28 * d.s, d.z), 'cactus', { pad: 0.03 })
      decor.add(arm)
    } else if (d.type === 'wire') {
      const from = new THREE.Vector3(...d.from)
      const to = new THREE.Vector3(...d.to)
      const pts = []
      const seg = 12
      for (let i = 0; i <= seg; i++) {
        const t = i / seg
        const p = from.clone().lerp(to, t)
        p.y -= Math.sin(t * Math.PI) * 0.9
        pts.push(p)
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.ink), transparent: true, opacity: 0.75 }))
      decor.add(line)
    } else if (d.type === 'flagline') {
      const from = new THREE.Vector3(...d.from)
      const to = new THREE.Vector3(...d.to)
      const pts = []
      for (let i = 0; i <= 12; i++) {
        const t = i / 12
        const p = from.clone().lerp(to, t)
        p.y -= Math.sin(t * Math.PI) * 0.55
        pts.push(p)
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.ink) }))
      decor.add(line)
      const flagGeos = []
      const palette = d.colors || [PALETTE.yellow]
      for (let i = 1; i < d.count; i++) {
        const t = i / d.count
        const p = from.clone().lerp(to, t)
        p.y -= Math.sin(t * Math.PI) * 0.55
        const tri = new THREE.BufferGeometry()
        tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.16, 0, 0, 0.16, 0, 0, 0, -0.42, 0]), 3))
        const col = new THREE.Color(palette[i % palette.length])
        const colors = new Float32Array(9)
        for (let v = 0; v < 3; v++) {
          colors[v * 3] = col.r
          colors[v * 3 + 1] = col.g
          colors[v * 3 + 2] = col.b
        }
        tri.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        tri.applyMatrix4(new THREE.Matrix4().setPosition(p.x, p.y, p.z))
        flagGeos.push(tri)
      }
      if (flagGeos.length) {
        const merged = mergeGeometries(flagGeos, false)
        if (merged) {
          const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))
          decor.add(mesh)
        }
      }
    } else if (d.type === 'distant') {
      const g = new THREE.BoxGeometry(d.w, d.h, d.d)
      g.applyMatrix4(new THREE.Matrix4().setPosition(d.x, d.h / 2, d.z))
      const mesh = new THREE.Mesh(g, new THREE.MeshToonMaterial({ color: new THREE.Color(d.color), gradientMap: TEX.toonGradientMap() }))
      decor.add(mesh)
    }
  }

  // ---- 天空 ----
  const skyGeo = new THREE.SphereGeometry(360, 32, 20)
  const skyMat = new THREE.MeshBasicMaterial({ map: TEX.skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false })
  const sky = new THREE.Mesh(skyGeo, skyMat)
  sky.name = 'sky'
  scene.add(sky)

  // 装饰自身的轮廓线（草稿感）：给装饰盒也补一层描边
  const decorOutlines = builder.build(decor)

  const nav = buildNavGraph(level.solids, {
    cell: 1.0,
    clearance: 0.62,
    bodyHeight: 1.85,
    stepAllow: 0.45
  })

  const world = {
    level,
    solids: level.solids,
    nav,
    group,
    decor,
    sky,
    playerSpawn: PLAYER_SPAWN,
    enemySpawns: ENEMY_SPAWNS,
    surfaceHeightAt: (x, z) => surfaceHeightAt(level.solids, x, z),
    supportHeightAt: (x, z, feetY, radius = 0) => supportHeightAt(level.solids, x, z, feetY, PHYS.stepHeight, radius),
    ceilingHeightAt: (x, z, feetY, headY, radius = 0) => ceilingHeightAt(level.solids, x, z, feetY, headY, radius),
    update() {},
    dispose() {}
  }
  return world
}
