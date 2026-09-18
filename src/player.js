// 纸上交锋 · PAPER STRIKE —— 玩家视角、移动、跳跃与碰撞
import * as THREE from 'three'
import { PHYS, integrateBody } from './world.js'

const MAX_PITCH = (85 * Math.PI) / 180
const MAX_SUBSTEP = 1 / 120
const MAX_STEP_DISTANCE = 0.1

function approach(current, target, maxDelta) {
  const d = target - current
  if (Math.abs(d) <= maxDelta) return target
  return current + Math.sign(d) * maxDelta
}

export class Player {
  constructor(world) {
    this.world = world
    this.position = new THREE.Vector3(0, 0, 19)
    this.velocity = new THREE.Vector3()
    this.yaw = 0
    this.pitch = 0
    this.onGround = true
    this.radius = PHYS.playerRadius
    this.height = PHYS.playerHeight
    this.eyeHeight = PHYS.playerEye
    this.maxHealth = 100
    this.health = 100
    this.dead = false
    this.ads = false
    this.speedWalk = 5.5
    this.speedAds = 3.25
    this.jumpSpeed = 6.4
    this.gravity = PHYS.gravity
    this.moving = false
    this.distanceWalked = 0
    this.stepPhase = 0
    this.bob = 0
    this.reset(world.playerSpawn)
  }

  reset(spawn) {
    this.position.set(spawn.x, spawn.y ?? 0, spawn.z)
    this.velocity.set(0, 0, 0)
    this.yaw = spawn.yaw ?? 0
    this.pitch = 0
    this.onGround = true
    this.health = this.maxHealth
    this.dead = false
    this.ads = false
    this.moving = false
    this.distanceWalked = 0
    this.stepPhase = 0
    this.bob = 0
  }

  get eyeY() {
    return this.position.y + this.eyeHeight
  }

  eyePosition(out = new THREE.Vector3()) {
    return out.set(this.position.x, this.eyeY, this.position.z)
  }

  look(dx, dy, sensitivity) {
    this.yaw -= dx * sensitivity
    this.pitch -= dy * sensitivity
    if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH
    if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2
  }

  forwardVector(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
  }

  aimVector(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch)
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp)
  }

  applyDamage(amount) {
    if (this.dead || amount <= 0) return 0
    const before = this.health
    this.health = Math.max(0, this.health - amount)
    if (this.health === 0) this.dead = true
    return before - this.health
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount)
    if (this.health > 0) this.dead = false
  }

  update(dt, input = {}) {
    if (dt <= 0) return
    // 子步长同时受时间与位移限制：低帧率或异常高速时也不会穿过薄墙
    const distance = this.velocity.length() * dt
    const steps = Math.min(240, Math.max(1, Math.ceil(Math.max(dt / MAX_SUBSTEP, distance / MAX_STEP_DISTANCE))))
    const h = dt / steps
    for (let i = 0; i < steps; i++) this.step(h, input)
  }

  step(h, input) {
    this.ads = !!input.ads
    const fwd = input.forward || 0
    const side = input.right || 0
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    // 前向 (-sin, -cos)，右向 (cos, -sin)
    let wishX = -sin * fwd + cos * side
    let wishZ = -cos * fwd - sin * side
    const len = Math.hypot(wishX, wishZ)
    if (len > 1e-4) {
      wishX /= len
      wishZ /= len
    } else {
      wishX = 0
      wishZ = 0
    }
    this.moving = len > 1e-4
    const speed = this.ads ? this.speedAds : this.speedWalk
    const targetX = wishX * speed
    const targetZ = wishZ * speed
    const accel = this.onGround ? 46 : 13
    const friction = this.onGround ? 42 : 4
    if (this.moving) {
      this.velocity.x = approach(this.velocity.x, targetX, accel * h)
      this.velocity.z = approach(this.velocity.z, targetZ, accel * h)
    } else {
      this.velocity.x = approach(this.velocity.x, 0, friction * h)
      this.velocity.z = approach(this.velocity.z, 0, friction * h)
    }

    if (input.jump && this.onGround && !this.dead) {
      this.velocity.y = this.jumpSpeed
      this.onGround = false
    }
    this.velocity.y = Math.max(-46, this.velocity.y - this.gravity * h)

    const res = integrateBody(this.world.solids, this.position, this.velocity, h, {
      radius: this.radius,
      height: this.height,
      stepHeight: PHYS.stepHeight,
      onGround: this.onGround
    })
    this.onGround = res.onGround

    const moved = Math.hypot(res.movedX, res.movedZ)
    if (this.onGround) {
      this.distanceWalked += moved
      this.stepPhase += moved * 2.4
    }
    // 走路时的轻微镜头晃动
    const speedNow = Math.hypot(this.velocity.x, this.velocity.z)
    const targetBob = this.onGround ? Math.min(1, speedNow / this.speedWalk) : 0
    this.bob += (targetBob - this.bob) * Math.min(1, h * 8)
    if (this.position.y > 40) this.position.y = 40
  }
}
