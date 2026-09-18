// 纸上交锋 · PAPER STRIKE —— 可爱的大头小豆人：造型、AI、导航与伤害
import * as THREE from 'three'
import { PALETTE, makeRng } from './sketch.js'
import * as TEX from './textures.js'
import { PHYS, integrateBody, nearestNode, findPath, smoothPath } from './world.js'
import { hasLineOfSight, resolveShot } from './combat.js'

export const ENEMY_CONFIG = {
  maxHealth: 80,
  eyeHeight: 1.5,
  patrolSpeed: 2.4,
  chaseSpeed: 4.0,
  turnSpeed: 3.6,
  attackRange: 24,
  preferredRange: 11,
  detectRange: 26,
  fovDegrees: 62,
  closeRange: 5,
  telegraph: 0.85,
  minTelegraph: 0.6,
  cooldownMin: 2.3,
  cooldownMax: 3.6,
  cooldownFloor: 1.2,
  damage: 10,
  hitChanceNear: 0.53,
  hitChanceFar: 0.23,
  memory: 7,
  noiseRadius: 18,
  deathDuration: 1.15,
  separation: 1.02
}

export const SHIRT_COLORS = [PALETTE.shirtOrange, PALETTE.shirtBlue, PALETTE.shirtYellow]
const HAT_COLOR = PALETTE.hatTeal
const SKIN = PALETTE.skin
const FACE_STYLES = TEX.FACE_STYLES

export function hitChanceAt(distance) {
  const t = Math.max(0, Math.min(1, (distance - ENEMY_CONFIG.closeRange) / (ENEMY_CONFIG.attackRange - ENEMY_CONFIG.closeRange)))
  return ENEMY_CONFIG.hitChanceNear + (ENEMY_CONFIG.hitChanceFar - ENEMY_CONFIG.hitChanceNear) * t
}

// ---------------------------------------------------------------------------
// 造型
// ---------------------------------------------------------------------------
const matCache = new Map()
function toonMat(color, o = {}) {
  const key = color + '|' + JSON.stringify(o)
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshToonMaterial({
      color: new THREE.Color(color),
      gradientMap: TEX.toonGradientMap(),
      transparent: !!o.transparent,
      opacity: o.opacity ?? 1,
      alphaTest: o.alphaTest ?? 0,
      side: o.side ?? THREE.FrontSide
    }))
  }
  return matCache.get(key)
}
let outlineMat = null
function getOutlineMat() {
  if (!outlineMat) outlineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ink), side: THREE.BackSide })
  return outlineMat
}

const SPHERE = new THREE.SphereGeometry(1, 18, 12)
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12)

function ellipsoid(parent, rx, ry, rz, x, y, z, color, o = {}) {
  const mesh = new THREE.Mesh(SPHERE, toonMat(color, o))
  mesh.scale.set(rx, ry, rz)
  mesh.position.set(x, y, z)
  mesh.castShadow = false
  parent.add(mesh)
  if (o.outline !== false) {
    const line = new THREE.Mesh(SPHERE, getOutlineMat())
    const pad = o.pad ?? 0.045
    line.scale.set(rx + pad, ry + pad, rz + pad)
    line.position.set(x, y, z)
    parent.add(line)
  }
  return mesh
}

function capsule(parent, r, h, x, y, z, color, o = {}) {
  const mesh = new THREE.Mesh(CYL, toonMat(color, o))
  mesh.scale.set(r, h, r)
  mesh.position.set(x, y, z)
  parent.add(mesh)
  if (o.outline !== false) {
    const line = new THREE.Mesh(CYL, getOutlineMat())
    line.scale.set(r + 0.04, h + 0.04, r + 0.04)
    line.position.set(x, y, z)
    parent.add(line)
  }
  return mesh
}

/** 与头形一致的曲面贴片：把平面网格投影到头部椭球表面，五官不会悬空 */
function facePatchGeometry(halfW = 0.26, halfH = 0.27, rx = 0.43, ry = 0.45, rz = 0.38, seg = 10) {
  const positions = []
  const uvs = []
  const indices = []
  const top = 0.22
  const bottom = -0.3
  for (let j = 0; j <= seg; j++) {
    const v = j / seg
    const y = bottom + (top - bottom) * v
    for (let i = 0; i <= seg; i++) {
      const u = i / seg
      const x = -halfW + halfW * 2 * u
      const k = 1 - (x / rx) * (x / rx) - (y / ry) * (y / ry)
      const z = -rz * Math.sqrt(Math.max(0.06, k)) * 1.035
      positions.push(x, y, z)
      uvs.push(u, v)
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i
      const b = a + 1
      const c = a + seg + 1
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

let faceGeo = null

export function createEnemyModel(variant = 0, styleIndex = 0) {
  const group = new THREE.Group()
  const shirt = SHIRT_COLORS[variant % SHIRT_COLORS.length]
  const style = FACE_STYLES[styleIndex % FACE_STYLES.length]

  // 腿与圆鞋
  const legs = []
  for (const side of [-1, 1]) {
    const leg = new THREE.Group()
    leg.position.set(side * 0.17, 0.42, 0)
    const limb = capsule(leg, 0.105, 0.34, 0, -0.16, 0, shirt)
    const shoe = ellipsoid(leg, 0.15, 0.1, 0.19, 0, -0.35, -0.03, PALETTE.dark, { outline: false })
    group.add(leg)
    legs.push({ group: leg, limb, shoe })
  }

  // 豆子形躯干
  const torso = ellipsoid(group, 0.36, 0.43, 0.29, 0, 0.79, 0, shirt, { pad: 0.05 })
  torso.castShadow = true
  ellipsoid(group, 0.155, 0.19, 0.06, 0, 0.75, -0.255, PALETTE.warmWhite, { outline: false })
  ellipsoid(group, 0.035, 0.035, 0.03, 0, 0.88, -0.275, PALETTE.dark, { outline: false })
  ellipsoid(group, 0.035, 0.035, 0.03, 0, 0.72, -0.27, PALETTE.dark, { outline: false })

  // 手臂与圆手
  const arms = []
  for (const side of [-1, 1]) {
    const arm = new THREE.Group()
    arm.position.set(side * 0.34, 1.0, 0)
    const sleeve = capsule(arm, 0.1, 0.24, 0, -0.12, 0, shirt)
    const hand = ellipsoid(arm, 0.12, 0.12, 0.12, 0, -0.28, -0.03, SKIN)
    arm.rotation.z = side * 0.18
    group.add(arm)
    arms.push({ group: arm, sleeve, hand, side })
  }

  // 大头
  const headGroup = new THREE.Group()
  headGroup.position.set(0, 1.53, 0)
  group.add(headGroup)
  const head = ellipsoid(headGroup, 0.43, 0.45, 0.38, 0, 0, 0, SKIN, { pad: 0.052 })
  head.castShadow = true
  if (!faceGeo) faceGeo = facePatchGeometry()
  const face = new THREE.Mesh(faceGeo, toonMat('#FFFFFF', { transparent: true, alphaTest: 0.35, side: THREE.DoubleSide }))
  face.material.map = TEX.faceTexture(style)
  face.material.needsUpdate = true
  face.position.set(0, 0.02, 0)
  headGroup.add(face)

  // 带两个圆耳朵的软帽
  const hat = new THREE.Group()
  hat.position.set(0, 0.16, 0)
  headGroup.add(hat)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), toonMat(HAT_COLOR))
  dome.scale.set(0.45, 0.4, 0.42)
  dome.castShadow = true
  hat.add(dome)
  const domeLine = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), getOutlineMat())
  domeLine.scale.set(0.495, 0.44, 0.465)
  hat.add(domeLine)
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), toonMat(HAT_COLOR))
  brim.scale.set(0.46, 0.05, 0.43)
  brim.position.y = -0.02
  hat.add(brim)
  const brimLine = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), getOutlineMat())
  brimLine.scale.set(0.5, 0.085, 0.47)
  brimLine.position.y = -0.02
  hat.add(brimLine)
  for (const side of [-1, 1]) {
    ellipsoid(hat, 0.135, 0.135, 0.12, side * 0.3, 0.3, 0.02, HAT_COLOR, { pad: 0.038 })
  }

  // 小纸板玩具枪
  const gun = new THREE.Group()
  gun.position.set(0.42, 0.72, -0.16)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), toonMat(PALETTE.cream))
  gun.add(body)
  const bodyLine = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.14, 0.38), getOutlineMat())
  gun.add(bodyLine)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), toonMat(HAT_COLOR))
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.02, -0.3)
  gun.add(barrel)
  group.add(gun)
  for (const a of arms) {
    if (a.side > 0) a.group.rotation.x = -0.5
  }

  // 手画气泡
  const bubbleMat = new THREE.SpriteMaterial({ map: TEX.bubbleTexture('!'), transparent: true, depthTest: true, depthWrite: false })
  const bubble = new THREE.Sprite(bubbleMat)
  bubble.position.set(0.45, 2.42, 0)
  bubble.scale.set(0.62, 0.62, 1)
  bubble.visible = false
  group.add(bubble)

  return { group, head, headGroup, hat, torso, legs, arms, gun, face, bubble, style, shirt }
}

// ---------------------------------------------------------------------------
// 动画
// ---------------------------------------------------------------------------
/**
 * 纸片豆子小人的走路动画。原先是 Enemy.animate 的方法体，原样搬出来成为自由函数，
 * Enemy.animate 与 PlayerAvatar 都调它 —— 敌人和远端玩家的动作因此天然一致。
 *
 * state 需要提供 position / velocity / walkPhase / state / stateTime / headTilt，
 * 后两者会被就地修改。Enemy 实例本身就满足这个形状，直接传 this 即可。
 *
 * speed 必须由调用方传入，不能就地用 velocity 的长度代替：这是「想走多快」，
 * 而 velocity 是碰撞之后「实际走了多快」。撞墙时 speed=6.2 但 velocity≈0 ——
 * 原实现里 moving 看 speed、幅度 k 看 velocity，两者不同源是刻意的
 * （撞墙仍在迈步，只是幅度归零）。合并成一个会让撞墙时的摆臂变样。
 *
 * sync 是可选回调，在动画算完后调用，用于把模型摆到世界坐标（Enemy.syncModel）。
 * 它的调用顺序被刻意保留：sync 会把 group.position.y 覆盖回 position.y，
 * 于是上面那行「走路上下颠簸」实际不生效。这是改动前就有的行为，
 * 不要顺手"修好"——那会改变所有敌人和远端玩家的观感。
 */
export function animateBeanRig(model, dt, state, speed, sync = null) {
  if (!model) return
  const m = model
  const moving = speed > 0.05
  const k = Math.min(1, Math.hypot(state.velocity.x, state.velocity.z) / ENEMY_CONFIG.chaseSpeed)
  if (moving) state.walkPhase += dt * (6 + k * 8)
  const swing = Math.sin(state.walkPhase) * (0.25 + k * 0.5)
  m.legs[0].group.rotation.x = swing * 0.8
  m.legs[1].group.rotation.x = -swing * 0.8
  m.group.rotation.z = Math.sin(state.walkPhase * 0.5) * 0.05 * k
  m.group.position.y = state.position.y + Math.abs(Math.sin(state.walkPhase)) * 0.045 * k
  m.arms[0].group.rotation.x = -swing * 0.5
  m.arms[1].group.rotation.x = -0.5 + swing * 0.25
  const searching = state.state === 'search'
  const targetTilt = searching ? 0.24 : 0
  state.headTilt += (targetTilt - state.headTilt) * Math.min(1, dt * 3)
  m.headGroup.rotation.z = state.headTilt + Math.sin(state.walkPhase * 0.5) * 0.03 * k
  m.headGroup.rotation.y = searching ? Math.sin(state.stateTime * 1.3) * 0.28 : 0
  if (m.bubble.visible) {
    m.bubble.position.y = 2.42 + Math.sin(state.stateTime * 6) * 0.05
  }
  if (sync) sync()
}

// ---------------------------------------------------------------------------
// 敌人个体
// ---------------------------------------------------------------------------
export class Enemy {
  constructor(world, index, spawn, opts = {}) {
    this.world = world
    this.index = index
    this.home = { x: spawn.x, z: spawn.z }
    this.variant = index % SHIRT_COLORS.length
    this.styleIndex = index % FACE_STYLES.length
    this.position = new THREE.Vector3(spawn.x, 0, spawn.z)
    this.velocity = new THREE.Vector3()
    this.onGround = true
    this.radius = PHYS.enemyRadius
    this.height = PHYS.enemyHeight
    this.health = ENEMY_CONFIG.maxHealth
    this.alive = true
    this.state = 'patrol'
    this.stateTime = 0
    this.initialYaw = opts.yaw ?? null
    this.yaw = opts.yaw ?? 0
    this.targetYaw = this.yaw
    this.path = []
    this.pathIndex = 0
    this.pathGoal = null
    this.pathTimer = 0
    this.lastSeen = new THREE.Vector3()
    this.memory = 0
    this.fireCooldown = 1.5 + index * 0.3
    this.telegraphTimer = 0
    this.pendingShot = false
    this.deathTimer = 0
    this.walkPhase = index * 0.7
    this.tilt = 0
    this.headTilt = 0
    this.bubbleTimer = 0
    this.bubbleSymbol = '!'
    this.patrolPause = 0
    this.rng = makeRng(1000 + index * 977)
    this.model = opts.headless ? null : createEnemyModel(this.variant, this.styleIndex)
    if (this.model) {
      world.scene.add(this.model.group)
      this.syncModel()
    }
    this.reset(spawn)
  }

  reset(spawn) {
    this.home = { x: (spawn || this.home).x, z: (spawn || this.home).z }
    this.position.set(this.home.x, 0, this.home.z)
    this.velocity.set(0, 0, 0)
    this.onGround = true
    this.health = ENEMY_CONFIG.maxHealth
    this.alive = true
    this.state = 'patrol'
    this.stateTime = 0
    // 默认朝向场地中心，避免出生时全部背对战场
    const toCenterX = -this.home.x
    const toCenterZ = -this.home.z
    const len = Math.hypot(toCenterX, toCenterZ) || 1
    this.yaw = this.initialYaw ?? Math.atan2(-toCenterX / len, -toCenterZ / len)
    this.targetYaw = this.yaw
    this.path = []
    this.pathIndex = 0
    this.pathGoal = null
    this.pathTimer = 0
    this.memory = 0
    this.fireCooldown = 1.5 + this.index * 0.3
    this.telegraphTimer = 0
    this.pendingShot = false
    this.deathTimer = 0
    this.tilt = 0
    this.headTilt = 0
    this.bubbleTimer = 0
    this.patrolPause = 0
    if (this.model) {
      this.model.group.visible = true
      this.model.group.scale.setScalar(1)
      this.model.group.rotation.set(0, 0, 0)
      this.model.bubble.visible = false
      this.model.headGroup.rotation.set(0, 0, 0)
      this.syncModel()
    }
  }

  get eyePosition() {
    return { x: this.position.x, y: this.position.y + ENEMY_CONFIG.eyeHeight, z: this.position.z }
  }

  syncModel() {
    if (!this.model) return
    this.model.group.position.set(this.position.x, this.position.y, this.position.z)
    this.model.group.rotation.y = this.yaw
  }

  takeDamage(amount, part = 'body') {
    if (!this.alive) return { died: false, damage: 0 }
    const dealt = Math.min(this.health, amount)
    this.health -= amount
    if (this.health <= 0) {
      this.health = 0
      this.alive = false
      this.state = 'dead'
      this.deathTimer = 0
      this.path = []
      if (this.model) this.model.bubble.visible = false
      return { died: true, damage: dealt, part }
    }
    // 被打中会立刻警觉
    if (this.state === 'patrol' || this.state === 'search') {
      this.state = 'attack'
      this.stateTime = 0
      this.fireCooldown = Math.max(this.fireCooldown, 0.5)
    }
    return { died: false, damage: dealt, part }
  }

  setPathTo(x, z, opts = {}) {
    const nav = this.world.nav
    if (!nav) return false
    const start = nearestNode(nav, this.position.x, this.position.z, { maxDist: 5 })
    const goal = nearestNode(nav, x, z, { maxDist: opts.maxDist ?? 7 })
    if (start < 0 || goal < 0) return false
    const raw = findPath(nav, start, goal)
    if (!raw) return false
    const sm = smoothPath(this.world.solids, nav, raw)
    this.path = sm.map((id) => ({ x: nav.nodes[id].x, y: nav.nodes[id].y, z: nav.nodes[id].z }))
    this.pathIndex = 0
    this.pathGoal = { x, z }
    this.pathTimer = opts.repath ?? 0.75
    return true
  }

  pickPatrolTarget() {
    const nav = this.world.nav
    if (!nav || !nav.mainComponent) return false
    for (let attempt = 0; attempt < 12; attempt++) {
      const id = nav.mainComponent[Math.floor(this.rng() * nav.mainComponent.length) % nav.mainComponent.length]
      const n = nav.nodes[id]
      const d = Math.hypot(n.x - this.home.x, n.z - this.home.z)
      if (d < 3 || d > 16) continue
      if (this.setPathTo(n.x, n.z)) return true
    }
    return this.setPathTo(this.home.x, this.home.z, { maxDist: 8 })
  }

  /** 视线检查：距离 + 视野角 + 实体遮挡 */
  checkSight(ctx) {
    if (!ctx.canFight) return false
    const player = ctx.player
    const ec = ENEMY_CONFIG
    const dx = player.position.x - this.position.x
    const dz = player.position.z - this.position.z
    const dist = Math.hypot(dx, dz)
    if (dist > ec.detectRange) return false
    const eye = this.eyePosition
    const chest = { x: player.position.x, y: player.position.y + 1.15, z: player.position.z }
    if (!hasLineOfSight(ctx.solids, eye, chest)) return false
    if (dist > ec.closeRange) {
      const fx = -Math.sin(this.yaw)
      const fz = -Math.cos(this.yaw)
      const dot = (dx / dist) * fx + (dz / dist) * fz
      const limit = Math.cos((ec.fovDegrees * Math.PI) / 180)
      if (dot < limit && this.state !== 'attack') return false
    }
    return true
  }

  /** 沿寻路点前进，返回本帧的期望方向 */
  steerAlongPath(dt) {
    if (!this.path.length || this.pathIndex >= this.path.length) return null
    let node = this.path[this.pathIndex]
    let dx = node.x - this.position.x
    let dz = node.z - this.position.z
    let d = Math.hypot(dx, dz)
    while (d < 0.6 && this.pathIndex < this.path.length - 1) {
      this.pathIndex++
      node = this.path[this.pathIndex]
      dx = node.x - this.position.x
      dz = node.z - this.position.z
      d = Math.hypot(dx, dz)
    }
    if (this.pathIndex >= this.path.length - 1 && d < 0.6) return { arrived: true, x: 0, z: 0 }
    return { arrived: false, x: dx / (d || 1), z: dz / (d || 1) }
  }

  turnTowards(x, z, dt, speed = ENEMY_CONFIG.turnSpeed) {
    const target = Math.atan2(-x, -z)
    let diff = target - this.yaw
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    const step = Math.min(Math.abs(diff), speed * dt) * Math.sign(diff)
    this.yaw += step
    return Math.abs(diff) < 0.1
  }

  update(dt, ctx) {
    if (!this.alive) {
      this.updateDeath(dt)
      return
    }
    if (!ctx.canFight) {
      this.stateTime += dt
      this.animate(dt, 0, ctx)
      return
    }
    const ec = ENEMY_CONFIG
    this.stateTime += dt
    const player = ctx.player
    const dx = player.position.x - this.position.x
    const dz = player.position.z - this.position.z
    const dist = Math.hypot(dx, dz)
    const seen = this.checkSight(ctx)
    if (seen) {
      this.lastSeen.set(player.position.x, player.position.y, player.position.z)
      this.memory = ec.memory
      if (this.state === 'patrol' || this.state === 'search') {
        this.state = 'alert'
        this.stateTime = 0
        this.telegraphTimer = ec.telegraph
        this.showBubble('!', ec.telegraph)
      }
    } else if (this.memory > 0) {
      this.memory = Math.max(0, this.memory - dt)
    }

    let wishX = 0
    let wishZ = 0
    let speed = 0

    switch (this.state) {
      case 'patrol': {
        if (this.patrolPause > 0) {
          this.patrolPause -= dt
          break
        }
        this.pathTimer -= dt
        if (!this.path.length || this.pathIndex >= this.path.length - 1) {
          if (this.pathTimer <= 0) {
            if (!this.pickPatrolTarget()) this.patrolPause = 1.4
            this.patrolPause = 0.6 + this.rng() * 1.6
          }
          break
        }
        const steer = this.steerAlongPath(dt)
        if (steer && !steer.arrived) {
          wishX = steer.x
          wishZ = steer.z
          speed = ec.patrolSpeed
        }
        this.turnTowards(wishX, wishZ, dt, 2.6)
        break
      }
      case 'alert': {
        this.turnTowards(dx, dz, dt, 5.0)
        this.telegraphTimer -= dt
        if (this.telegraphTimer <= 0) {
          // 预警结束立刻打出第一发（0.85 秒的可见预警），随后进入冷却
          this.state = 'attack'
          this.stateTime = 0
          this.fire(ctx)
          this.fireCooldown = Math.max(ec.cooldownFloor, ec.cooldownMin + this.rng() * (ec.cooldownMax - ec.cooldownMin))
        }
        break
      }
      case 'attack': {
        const los = seen
        if (!los && this.memory <= 0) {
          this.state = 'search'
          this.stateTime = 0
          this.setPathTo(this.lastSeen.x, this.lastSeen.z)
          this.showBubble('?', 1.2)
          break
        }
        this.turnTowards(dx, dz, dt, 6.0)
        if (dist > ec.preferredRange || !los) {
          this.pathTimer -= dt
          if (this.pathTimer <= 0 || !this.path.length) {
            this.setPathTo(los ? player.position.x : this.lastSeen.x, los ? player.position.z : this.lastSeen.z, { repath: 0.7 })
          }
          const steer = this.steerAlongPath(dt)
          if (steer && !steer.arrived) {
            wishX = steer.x
            wishZ = steer.z
            speed = ec.chaseSpeed
          }
        } else if (dist < ec.preferredRange * 0.55 && los) {
          // 保持交火距离：稍微后撤
          wishX = -dx / (dist || 1)
          wishZ = -dz / (dist || 1)
          speed = ec.patrolSpeed * 0.8
        }
        this.fireCooldown -= dt
        if (this.fireCooldown <= ec.minTelegraph && !this.pendingShot && los) {
          this.pendingShot = true
          this.telegraphTimer = ec.minTelegraph
          this.showBubble('!', ec.minTelegraph)
        }
        if (this.pendingShot) {
          this.telegraphTimer -= dt
          if (this.telegraphTimer <= 0) {
            this.pendingShot = false
            this.fire(ctx)
            this.fireCooldown = Math.max(ec.cooldownFloor, ec.cooldownMin + this.rng() * (ec.cooldownMax - ec.cooldownMin))
          }
        }
        break
      }
      case 'search': {
        this.pathTimer -= dt
        if (this.pathTimer <= 0) {
          if (!this.path.length || this.pathIndex >= this.path.length - 1) {
            this.headTiltTarget = 1
            if (this.stateTime > ec.memory) {
              this.state = 'patrol'
              this.stateTime = 0
              this.pathTimer = 0
              this.showBubble('?', 0.8)
            }
          } else if (!this.path.length) {
            this.setPathTo(this.lastSeen.x, this.lastSeen.z)
          }
        }
        const steer = this.steerAlongPath(dt)
        if (steer && !steer.arrived) {
          wishX = steer.x
          wishZ = steer.z
          speed = ec.chaseSpeed * 0.85
          this.turnTowards(wishX, wishZ, dt, 3.2)
        } else {
          this.yaw += Math.sin(this.stateTime * 1.6) * dt * 1.2
        }
        break
      }
      default:
        break
    }

    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt
      if (this.bubbleTimer <= 0 && this.model) this.model.bubble.visible = false
    }

    this.move(dt, wishX, wishZ, speed, ctx)
    this.animate(dt, speed, ctx)
  }

  move(dt, wishX, wishZ, speed, ctx) {
    const targetX = wishX * speed
    const targetZ = wishZ * speed
    const accel = this.onGround ? 30 : 8
    this.velocity.x += Math.max(-accel * dt, Math.min(accel * dt, targetX - this.velocity.x))
    this.velocity.z += Math.max(-accel * dt, Math.min(accel * dt, targetZ - this.velocity.z))
    if (speed === 0 && this.onGround) {
      this.velocity.x *= Math.max(0, 1 - 8 * dt)
      this.velocity.z *= Math.max(0, 1 - 8 * dt)
    }
    // 同伴之间保持距离，避免叠在一起
    for (const other of ctx.enemies) {
      if (other === this || !other.alive) continue
      const ox = this.position.x - other.position.x
      const oz = this.position.z - other.position.z
      const d2 = ox * ox + oz * oz
      const minD = ENEMY_CONFIG.separation
      if (d2 > 1e-6 && d2 < minD * minD) {
        const d = Math.sqrt(d2)
        this.velocity.x += (ox / d) * (minD - d) * 3.2
        this.velocity.z += (oz / d) * (minD - d) * 3.2
      }
    }
    this.velocity.y = Math.max(-46, this.velocity.y - PHYS.gravity * dt)
    const res = integrateBody(ctx.solids, this.position, this.velocity, dt, {
      radius: this.radius,
      height: this.height,
      stepHeight: PHYS.stepHeight,
      onGround: this.onGround
    })
    this.onGround = res.onGround
  }

  fire(ctx) {
    const ec = ENEMY_CONFIG
    const player = ctx.player
    const from = new THREE.Vector3(this.position.x - Math.sin(this.yaw) * 0.42, this.position.y + 1.32, this.position.z - Math.cos(this.yaw) * 0.42)
    const to = new THREE.Vector3(player.position.x, player.position.y + 1.05, player.position.z)
    const dist = Math.hypot(to.x - from.x, to.z - from.z)
    // 正式开火前再次检查遮挡
    const clear = hasLineOfSight(ctx.solids, from, to)
    const dir = to.clone().sub(from).normalize()
    const roll = ctx.random ? ctx.random() : Math.random()
    const willHit = clear && roll < hitChanceAt(dist)
    if (!willHit) {
      // 打偏：弹道散布
      const spread = 0.05 + 0.02 * Math.min(1, dist / ec.attackRange)
      dir.x += (roll - 0.5) * spread * 2
      dir.y += (ctx.random ? ctx.random() : Math.random() - 0.5) * spread
      dir.z += (roll - 0.5) * spread * 2
      dir.normalize()
    }
    const shot = resolveShot(from, dir, { solids: ctx.solids, enemies: [], maxDist: 120 })
    const end = shot.type === 'wall' ? shot.point : from.clone().addScaledVector(dir, 60)
    if (ctx.effects) {
      ctx.effects.spawnTracer(from, end)
      if (shot.type === 'wall') ctx.effects.impact(shot.point, shot.normal, 0.7)
    }
    if (ctx.audio) ctx.audio.enemyShot(dist)
    if (willHit && ctx.onPlayerHit) ctx.onPlayerHit(ec.damage, this)
    return willHit
  }

  showBubble(symbol, duration = 1) {
    this.bubbleSymbol = symbol
    this.bubbleTimer = duration
    if (!this.model) return
    this.model.bubble.material.map = TEX.bubbleTexture(symbol)
    this.model.bubble.material.needsUpdate = true
    this.model.bubble.visible = true
  }

  updateDeath(dt) {
    this.deathTimer += dt
    const t = this.deathTimer
    const total = ENEMY_CONFIG.deathDuration
    if (!this.model) {
      if (t > total) this.model = null
      return
    }
    const g = this.model.group
    if (t < 0.4) {
      const k = t / 0.4
      g.rotation.z = k * 1.15
      g.rotation.x = -k * 0.25
      g.position.y = this.position.y + Math.sin(k * Math.PI) * 0.12
    } else {
      const k = Math.min(1, (t - 0.4) / (total - 0.4))
      g.rotation.z = 1.15 + k * 0.35
      g.scale.setScalar(Math.max(0.02, 1 - k))
      g.position.y = this.position.y - k * 0.25
      if (k >= 1) g.visible = false
    }
  }

  animate(dt, speed, ctx) {
    // 动画体已抽成自由函数（见上方 animateBeanRig）—— 远端玩家要用同一套动作。
    // 传 this 当状态对象：Enemy 的字段形状正好满足它。
    animateBeanRig(this.model, dt, this, speed, () => this.syncModel())
  }
}

// ---------------------------------------------------------------------------
// 管理器
// ---------------------------------------------------------------------------
export class EnemyManager {
  constructor(world, scene, opts = {}) {
    this.world = world
    this.scene = scene
    world.scene = scene
    this.opts = opts
    this.rng = makeRng(7)
    this.kills = 0
    this.pathBudget = 0
    // spawns 允许外部覆盖：决斗模式要一块空场地，传 [] 即可。
    // 注意传 [] 会让 aliveCount 为 0 —— 调用方的胜负判定必须先按模式分支，
    // 否则会在开局瞬间宣告胜利（见 match.js 的 checkVictory 与 match.test.js 的回归用例）。
    this.enemies = []
    this.setSpawns(opts.spawns || world.enemySpawns)
  }

  /**
   * 换一批出生点，按新列表重建敌人。
   *
   * 单人局与决斗局之间来回切换时要靠它 —— 决斗场地是空的，不能只是把旧的敌人
   * 标记成死亡（那样模型还立在场上，而且 reset() 会把它们复活）。
   *
   * ⚠️ 重建会换掉 this.enemies 这个数组本身。任何按引用缓存过它的地方都必须重新取：
   * 这里是 match.setEnemies() 与 main.js 的 enemyCtx.enemies。
   * （enemyCtx.enemies 其实是冗余的 —— EnemyManager.update 会用 this.enemies 覆盖它 ——
   *   但保持它正确，免得以后有人在别处读它时踩坑。）
   */
  setSpawns(spawns) {
    for (const e of this.enemies) {
      if (e.model && this.scene) this.scene.remove(e.model.group)
    }
    this.enemies = (spawns || []).map((spawn, i) => new Enemy(this.world, i, spawn, this.opts))
    this.kills = 0
    return this
  }

  get aliveCount() {
    return this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0)
  }

  get hitTargets() {
    return this.enemies
  }

  reset() {
    this.kills = 0
    for (const e of this.enemies) e.reset()
  }

  /** 枪声等噪音让附近敌人警觉 */
  alertNoise(position, radius = ENEMY_CONFIG.noiseRadius) {
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = Math.hypot(e.position.x - position.x, e.position.z - position.z)
      if (d > radius) continue
      if (e.state === 'patrol' || e.state === 'search') {
        e.state = 'alert'
        e.stateTime = 0
        e.telegraphTimer = ENEMY_CONFIG.telegraph
        e.lastSeen.set(position.x, position.y ?? 0, position.z)
        e.memory = ENEMY_CONFIG.memory
        e.showBubble('!', ENEMY_CONFIG.telegraph)
      }
    }
  }

  update(dt, ctx) {
    const full = { ...ctx, enemies: this.enemies }
    for (const e of this.enemies) e.update(dt, full)
  }
}
