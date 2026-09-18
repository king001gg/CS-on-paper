// 纸上交锋 · PAPER STRIKE —— 命中判定与战斗特效
// 射线部分为纯数学实现（不依赖 DOM），墙体与角色的遮挡关系可以独立验证。
import * as THREE from 'three'
import { PALETTE, makeRng } from './sketch.js'
import * as TEX from './textures.js'

/**
 * 命中盒按「这个角色在别人眼里长什么样」来选，不按它的物理身高。
 * 敌人模型高 1.9，玩家物理身高 1.8，但双人对战时远端玩家是用 createEnemyModel()
 * 渲染的纸片小豆人 —— 所以网络玩家该用 enemy 档案，用 player 档案反而会错位。
 * player 档案留给将来可能出现的、用独立模型渲染的本地角色。
 */
export const HITBOX_PROFILES = {
  enemy: {
    head: { y: 1.55, rx: 0.46, ry: 0.49, rz: 0.42 },
    body: { y: 0.79, rx: 0.4, ry: 0.47, rz: 0.32 }
  },
  player: {
    head: { y: 1.62, rx: 0.3, ry: 0.26, rz: 0.3 },
    body: { y: 0.95, rx: 0.34, ry: 0.62, rz: 0.3 }
  }
}

const DEFAULT_PROFILE = HITBOX_PROFILES.enemy

// 旧导出保留：combat.test.js 直接引用这两个常量
export const HEAD_HITBOX = HITBOX_PROFILES.enemy.head
export const BODY_HITBOX = HITBOX_PROFILES.enemy.body

/** 射线与轴对齐包围盒求交（slab 法），返回最近正交点 */
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT = Infinity) {
  let tmin = 0
  let tmax = maxT
  let axis = -1
  let sign = 1
  const o = [ox, oy, oz]
  const d = [dx, dy, dz]
  const lo = [b.minX, b.minY, b.minZ]
  const hi = [b.maxX, b.maxY, b.maxZ]
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null
      continue
    }
    const inv = 1 / d[i]
    let t1 = (lo[i] - o[i]) * inv
    let t2 = (hi[i] - o[i]) * inv
    let s = -1
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1 }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s }
    if (t2 < tmax) tmax = t2
    if (tmin > tmax) return null
  }
  if (axis < 0) return null
  const n = [0, 0, 0]
  n[axis] = sign
  return { t: tmin, nx: n[0], ny: n[1], nz: n[2] }
}

/** 射线与有限圆柱（Y 轴）求交 */
export function rayCylinder(ox, oy, oz, dx, dy, dz, solid, maxT = Infinity) {
  const cx = solid.x
  const cz = solid.z
  const r = solid.r
  const a = dx * dx + dz * dz
  if (a < 1e-9) return null
  const px = ox - cx
  const pz = oz - cz
  const bq = 2 * (px * dx + pz * dz)
  const cq = px * px + pz * pz - r * r
  const disc = bq * bq - 4 * a * cq
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  const ts = [(-bq - sq) / (2 * a), (-bq + sq) / (2 * a)]
  for (const t of ts) {
    if (t < 0 || t > maxT) continue
    const y = oy + dy * t
    if (y < solid.minY || y > solid.maxY) continue
    const nx = (ox + dx * t - cx) / r
    const nz = (oz + dz * t - cz) / r
    return { t, nx, ny: 0, nz }
  }
  return null
}

/** 射线与椭球求交 */
export function rayEllipsoid(ox, oy, oz, dx, dy, dz, cx, cy, cz, rx, ry, rz, maxT = Infinity) {
  const px = (ox - cx) / rx
  const py = (oy - cy) / ry
  const pz = (oz - cz) / rz
  const vx = dx / rx
  const vy = dy / ry
  const vz = dz / rz
  const a = vx * vx + vy * vy + vz * vz
  if (a < 1e-12) return null
  const b = 2 * (px * vx + py * vy + pz * vz)
  const c = px * px + py * py + pz * pz - 1
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  const t1 = (-b - sq) / (2 * a)
  const t2 = (-b + sq) / (2 * a)
  const t = t1 >= 0 ? t1 : t2
  if (t < 0 || t > maxT) return null
  return t
}

export function raycastSolids(origin, dir, solids, maxDist = 200) {
  let best = null
  for (const s of solids) {
    const hit = s.kind === 'cyl'
      ? rayCylinder(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, s, maxDist)
      : rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, s, maxDist)
    if (hit && (!best || hit.t < best.t)) best = { ...hit, solid: s }
  }
  if (!best) return null
  best.point = new THREE.Vector3(origin.x + dir.x * best.t, origin.y + dir.y * best.t, origin.z + dir.z * best.t)
  best.normal = new THREE.Vector3(best.nx, best.ny, best.nz)
  return best
}

/**
 * 射线与一组可命中角色的求交。只要求目标有 position(Vector3) 与 alive，
 * 所以 Player 只要补一个 get alive() 就能直接进这个列表，不必另写一套射线。
 * 每个目标用自己的 hitProfile 取命中盒（见 HITBOX_PROFILES 的注释）。
 */
export function raycastTargets(origin, dir, targets, maxDist = 200) {
  let best = null
  for (const e of targets) {
    if (!e.alive) continue
    const p = e.position
    const hb = HITBOX_PROFILES[e.hitProfile] || DEFAULT_PROFILE
    const head = hb.head
    const body = hb.body
    const headT = rayEllipsoid(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, p.x, p.y + head.y, p.z, head.rx, head.ry, head.rz, maxDist)
    const bodyT = rayEllipsoid(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, p.x, p.y + body.y, p.z, body.rx, body.ry, body.rz, maxDist)
    let part = null
    let t = Infinity
    if (headT !== null && headT <= (bodyT ?? Infinity)) { part = 'head'; t = headT }
    else if (bodyT !== null) { part = 'body'; t = bodyT }
    if (part && (!best || t < best.t)) best = { t, part, enemy: e }
  }
  if (!best) return null
  best.point = new THREE.Vector3(origin.x + dir.x * best.t, origin.y + dir.y * best.t, origin.z + dir.z * best.t)
  best.normal = new THREE.Vector3(-dir.x, -dir.y, -dir.z)
  return best
}

// 旧名字保留为别名：combat.test.js 与 enemies.js 都在用
export const raycastEnemies = raycastTargets

/**
 * 一次射击的完整命中解算：取最近的实体遮挡与角色交点。
 * 墙体优先于同距离或几乎同距离的目标。
 *
 * targets 是通用的可命中角色列表（敌人、玩家、远端化身都可以混在一起）；
 * enemies 保留为兼容别名。返回值的形状**刻意不改**——combat.test.js 有多处
 * 断言 type === 'enemy' 与 shot.enemy，改名要单独做一次只动测试的提交。
 */
export function resolveShot(origin, dir, { solids, targets, enemies, maxDist = 200, wallBias = 0.03 }) {
  const list = targets || enemies || []
  const wall = raycastSolids(origin, dir, solids, maxDist)
  const target = raycastTargets(origin, dir, list, maxDist)
  if (wall && (!target || wall.t <= target.t + wallBias)) {
    return { type: 'wall', hit: wall, point: wall.point, normal: wall.normal, distance: wall.t }
  }
  if (target) return { type: 'enemy', hit: target, enemy: target.enemy, part: target.part, point: target.point, normal: target.normal, distance: target.t }
  return { type: 'none', distance: maxDist }
}

/** 视线检查：两点之间是否被实体挡住（用于敌人感知与命中） */
export function hasLineOfSight(solids, from, to, ignoreBoxes = false) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const dist = Math.hypot(dx, dy, dz)
  if (dist < 1e-4) return true
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist }
  const hit = raycastSolids(from, dir, solids, dist - 0.05)
  return !hit
}

// ---------------------------------------------------------------------------
// 特效：预分配对象池，最多同时约 70 个，不随重开累积
// ---------------------------------------------------------------------------
const MAX_ACTIVE_EFFECTS = 70
const HOLE_POOL = 26
const PUFF_POOL = 12
const DEBRIS_POOL = 40
const TRACER_POOL = 10
const WORD_POOL = 6

export class Effects {
  constructor(scene, opts = {}) {
    this.scene = scene
    this.active = []
    this.time = 0
    this.group = new THREE.Group()
    this.group.name = 'effects'
    scene.add(this.group)
    const rng = makeRng(97531)
    this.rng = rng

    const holeTex = TEX.holeTexture()
    const puffTex = TEX.puffTexture()
    const sparkTex = TEX.sparkTexture()
    this.holeMat = new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, opacity: 0.95 })

    this.holes = []
    for (let i = 0; i < HOLE_POOL; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), this.holeMat)
      m.visible = false
      m.renderOrder = 3
      this.group.add(m)
      this.holes.push({ mesh: m, life: 0 })
    }
    this.holeIndex = 0

    this.puffs = []
    for (let i = 0; i < PUFF_POOL; i++) {
      const mat = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0.9, color: 0xffffff })
      const s = new THREE.Sprite(mat)
      s.visible = false
      this.group.add(s)
      this.puffs.push({ obj: s, life: 0, max: 0.35, vel: new THREE.Vector3() })
    }
    this.puffIndex = 0

    this.sparks = []
    for (let i = 0; i < PUFF_POOL; i++) {
      const mat = new THREE.SpriteMaterial({ map: sparkTex, transparent: true, depthWrite: false, opacity: 1 })
      const s = new THREE.Sprite(mat)
      s.visible = false
      this.group.add(s)
      this.sparks.push({ obj: s, life: 0, max: 0.25, vel: new THREE.Vector3() })
    }
    this.sparkIndex = 0

    this.debris = []
    const debrisGeo = new THREE.BoxGeometry(0.09, 0.07, 0.08)
    const debrisMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.cream) })
    const debrisMat2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.teal) })
    for (let i = 0; i < DEBRIS_POOL; i++) {
      const m = new THREE.Mesh(debrisGeo, i % 3 === 0 ? debrisMat2 : debrisMat)
      m.visible = false
      this.group.add(m)
      this.debris.push({ mesh: m, life: 0, max: 0.8, vel: new THREE.Vector3(), spin: new THREE.Vector3(), grounded: false })
    }
    this.debrisIndex = 0

    this.tracers = []
    const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.yellow), transparent: true, opacity: 0.9 })
    for (let i = 0; i < TRACER_POOL; i++) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
      const line = new THREE.Line(geo, tracerMat.clone())
      line.visible = false
      line.frustumCulled = false
      this.group.add(line)
      this.tracers.push({ line, life: 0, max: 0.07 })
    }
    this.tracerIndex = 0

    this.words = []
    this.wordTextures = new Map()
    for (const w of ['POW!', 'BONK!', 'NICE!', 'ZAP!', 'BOOP!', 'WHAM!']) {
      this.wordTextures.set(w, TEX.comicWordTexture(w, w === 'NICE!' ? PALETTE.teal : PALETTE.uiAccent))
    }
    this.wordKeys = [...this.wordTextures.keys()]
    for (let i = 0; i < WORD_POOL; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.wordTextures.get('POW!'), transparent: true, depthWrite: false, depthTest: false })
      const s = new THREE.Sprite(mat)
      s.visible = false
      s.renderOrder = 6
      this.group.add(s)
      this.words.push({ obj: s, life: 0, max: 0.9, vel: new THREE.Vector3() })
    }
    this.wordIndex = 0
    this.decalOffset = opts.decalOffset ?? 0.012
  }

  get activeCount() {
    return this.active.length + this.holes.filter((h) => h.life > 0).length + this.tracers.filter((t) => t.life > 0).length
  }

  spawnHole(point, normal) {
    const slot = this.holes[this.holeIndex]
    this.holeIndex = (this.holeIndex + 1) % this.holes.length
    slot.mesh.visible = true
    slot.mesh.position.copy(point).addScaledVector(normal, this.decalOffset)
    const up = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), normal.clone().negate(), up)
    slot.mesh.quaternion.setFromRotationMatrix(m)
    slot.mesh.rotateZ(this.rng() * Math.PI * 2)
    const scale = 0.7 + this.rng() * 0.7
    slot.mesh.scale.setScalar(scale)
    slot.life = 6
    if (!this.active.includes(slot)) this.active.push(slot)
  }

  spawnPuff(point, normal, scale = 1) {
    const slot = this.puffs[this.puffIndex]
    this.puffIndex = (this.puffIndex + 1) % this.puffs.length
    slot.obj.visible = true
    slot.obj.position.copy(point).addScaledVector(normal, 0.06)
    slot.obj.scale.setScalar(0.32 * scale)
    slot.obj.material.opacity = 0.95
    slot.vel.set(normal.x * 0.9, normal.y * 0.6 + 0.5, normal.z * 0.9)
    slot.life = slot.max
    if (!this.active.includes(slot)) this.active.push(slot)
  }

  spawnSpark(point, normal) {
    const slot = this.sparks[this.sparkIndex]
    this.sparkIndex = (this.sparkIndex + 1) % this.sparks.length
    slot.obj.visible = true
    slot.obj.position.copy(point).addScaledVector(normal, 0.05)
    slot.obj.scale.setScalar(0.22)
    slot.obj.material.opacity = 1
    slot.vel.set(normal.x * 1.6, 0.9, normal.z * 1.6)
    slot.life = slot.max
    if (!this.active.includes(slot)) this.active.push(slot)
  }

  spawnDebris(point, normal, count = 6) {
    for (let i = 0; i < count; i++) {
      const slot = this.debris[this.debrisIndex]
      this.debrisIndex = (this.debrisIndex + 1) % this.debris.length
      slot.mesh.visible = true
      slot.mesh.position.copy(point)
      slot.mesh.scale.setScalar(0.6 + this.rng() * 0.8)
      slot.vel.set(normal.x * 1.4 + (this.rng() - 0.5) * 2.2, 1.6 + this.rng() * 1.8, normal.z * 1.4 + (this.rng() - 0.5) * 2.2)
      slot.spin.set((this.rng() - 0.5) * 12, (this.rng() - 0.5) * 12, (this.rng() - 0.5) * 12)
      slot.life = slot.max
      slot.grounded = false
      if (!this.active.includes(slot)) this.active.push(slot)
    }
  }

  spawnTracer(from, to) {
    const slot = this.tracers[this.tracerIndex]
    this.tracerIndex = (this.tracerIndex + 1) % this.tracers.length
    const pos = slot.line.geometry.attributes.position
    pos.setXYZ(0, from.x, from.y, from.z)
    pos.setXYZ(1, to.x, to.y, to.z)
    pos.needsUpdate = true
    slot.line.visible = true
    slot.line.material.opacity = 0.85
    slot.life = slot.max
    slot.from = from
    if (!this.active.includes(slot)) this.active.push(slot)
  }

  spawnWord(point, word = null) {
    const slot = this.words[this.wordIndex]
    this.wordIndex = (this.wordIndex + 1) % this.words.length
    const key = word || this.wordKeys[Math.floor(this.rng() * this.wordKeys.length) % this.wordKeys.length]
    slot.obj.material.map = this.wordTextures.get(key) || this.wordTextures.get('POW!')
    slot.obj.material.needsUpdate = true
    slot.obj.visible = true
    slot.obj.position.copy(point)
    slot.obj.scale.set(1.1, 0.55, 1)
    slot.obj.material.opacity = 1
    slot.vel.set((this.rng() - 0.5) * 0.3, 1.5, (this.rng() - 0.5) * 0.3)
    slot.life = slot.max
    if (!this.active.includes(slot)) this.active.push(slot)
  }

  /** 命中墙面：弹孔 + 碎屑 + 尘土 */
  impact(point, normal, scale = 1) {
    if (this.activeCount > MAX_ACTIVE_EFFECTS) return
    this.spawnHole(point, normal)
    this.spawnPuff(point, normal, scale)
    this.spawnSpark(point, normal)
    this.spawnDebris(point, normal, 4)
  }

  /** 命中角色：软软的纸片飞散，不做血腥表现 */
  hitCharacter(point, normal) {
    if (this.activeCount > MAX_ACTIVE_EFFECTS) return
    this.spawnPuff(point, normal, 0.8)
    this.spawnDebris(point, normal, 5)
  }

  update(dt) {
    this.time += dt
    for (const h of this.holes) {
      if (h.life > 0) {
        h.life -= dt
        if (h.life <= 0) h.mesh.visible = false
      }
    }
    for (const p of this.puffs) {
      if (p.life > 0) {
        p.life -= dt
        const k = Math.max(0, p.life / p.max)
        p.obj.position.addScaledVector(p.vel, dt)
        p.obj.scale.setScalar(0.32 + (1 - k) * 0.5)
        p.obj.material.opacity = k * 0.95
        if (p.life <= 0) p.obj.visible = false
      }
    }
    for (const s of this.sparks) {
      if (s.life > 0) {
        s.life -= dt
        const k = Math.max(0, s.life / s.max)
        s.obj.position.addScaledVector(s.vel, dt)
        s.vel.y -= 6 * dt
        s.obj.material.opacity = k
        s.obj.scale.setScalar(0.22 * (0.6 + k))
        if (s.life <= 0) s.obj.visible = false
      }
    }
    for (const d of this.debris) {
      if (d.life > 0) {
        d.life -= dt
        if (!d.grounded) {
          d.mesh.position.addScaledVector(d.vel, dt)
          d.vel.y -= 16 * dt
          d.mesh.rotation.x += d.spin.x * dt
          d.mesh.rotation.y += d.spin.y * dt
          d.mesh.rotation.z += d.spin.z * dt
          if (d.mesh.position.y < 0.04) {
            d.mesh.position.y = 0.04
            d.grounded = true
          }
        }
        if (d.life < 0.25) d.mesh.scale.multiplyScalar(1 - dt * 2.4)
        if (d.life <= 0) d.mesh.visible = false
      }
    }
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt
        t.line.material.opacity = Math.max(0, (t.life / t.max) * 0.85)
        if (t.life <= 0) t.line.visible = false
      }
    }
    for (const w of this.words) {
      if (w.life > 0) {
        w.life -= dt
        const k = Math.max(0, w.life / w.max)
        w.obj.position.addScaledVector(w.vel, dt)
        w.obj.material.opacity = Math.min(1, k * 2)
        const s = 0.85 + (1 - k) * 0.35
        w.obj.scale.set(1.1 * s, 0.55 * s, 1)
        if (w.life <= 0) w.obj.visible = false
      }
    }
    this.active.length = 0
  }

  /** 重开时清空所有临时特效 */
  clear() {
    for (const h of this.holes) { h.life = 0; h.mesh.visible = false }
    for (const p of this.puffs) { p.life = 0; p.obj.visible = false }
    for (const s of this.sparks) { s.life = 0; s.obj.visible = false }
    for (const d of this.debris) { d.life = 0; d.mesh.visible = false }
    for (const t of this.tracers) { t.life = 0; t.line.visible = false }
    for (const w of this.words) { w.life = 0; w.obj.visible = false }
    this.active.length = 0
  }
}
