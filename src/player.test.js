import test from 'node:test'
import assert from 'node:assert/strict'
import { Player } from './player.js'
import { buildLevel, buildNavGraph, PLAYER_SPAWN } from './world.js'

const level = buildLevel()
const world = { solids: level.solids, playerSpawn: PLAYER_SPAWN, nav: null }
const idle = { forward: 0, right: 0, jump: false, ads: false }

function makePlayer(x, z, y = 0, yaw = 0) {
  const p = new Player(world)
  p.reset({ x, y, z, yaw })
  return p
}

function simulate(p, seconds, input, dt = 1 / 60) {
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) p.update(dt, input)
}

test('从空中落下会稳稳站在地面上', () => {
  const p = makePlayer(0, 19, 3)
  simulate(p, 2, idle)
  assert.ok(Math.abs(p.position.y) < 1e-6, '落地高度 ' + p.position.y)
  assert.equal(p.onGround, true)
})

test('撞墙停住并且可以沿墙滑动', () => {
  const p = makePlayer(-21, 10)
  simulate(p, 3, { ...idle, right: -1 })
  assert.ok(p.position.x > -22.7, '不应该穿过西墙，实际 x=' + p.position.x)
  const xBefore = p.position.x
  simulate(p, 1, { ...idle, right: -1, forward: 1 })
  assert.ok(p.position.z < 10 - 3, '沿墙滑动应该有位移，z=' + p.position.z)
  assert.ok(Math.abs(p.position.x - xBefore) < 0.6)
})

test('移动速度接近 5.5 m/s，斜向不会额外加速', () => {
  // 西侧通路是长直线，用来测量干净速度
  const straight = makePlayer(-19, 20)
  simulate(straight, 1.5, { ...idle, forward: 1 })
  const dStraight = 20 - straight.position.z
  const diag = makePlayer(-19, 20)
  simulate(diag, 1.5, { ...idle, forward: 1, right: 1 })
  const dDiag = Math.hypot(diag.position.x + 19, 20 - diag.position.z)
  assert.ok(dStraight > 7.5 && dStraight < 8.6, '1.5 秒应走约 8.25 米，实际 ' + dStraight.toFixed(2))
  assert.ok(dDiag <= dStraight + 0.3, '斜向 ' + dDiag.toFixed(2) + ' 直线 ' + dStraight.toFixed(2))
})

test('瞄准时移动速度降低到约 3.25 m/s', () => {
  const p = makePlayer(-19, 20)
  simulate(p, 1.5, { ...idle, forward: 1, ads: true })
  const d = 20 - p.position.z
  assert.ok(d > 4.2 && d < 5.2, '实际 ' + d.toFixed(2))
})

test('跳跃高度合理，并且能跳上 1.05 米的木箱', () => {
  let apex = 0
  const air = makePlayer(0, 19)
  for (let i = 0; i < 60; i++) {
    air.update(1 / 60, { ...idle, jump: i < 3 })
    apex = Math.max(apex, air.position.y)
  }
  assert.ok(apex > 0.9 && apex < 1.4, '跳跃顶点 ' + apex.toFixed(2))
  // 起跳越过箱沿，然后停在箱顶
  const p = makePlayer(0, 17.6)
  for (let i = 0; i < 22; i++) p.update(1 / 60, { ...idle, forward: 1, jump: i < 3 })
  simulate(p, 1.5, idle)
  assert.ok(Math.abs(p.position.y - 1.05) < 0.02, '应站在木箱顶，实际 y=' + p.position.y.toFixed(3))
  assert.ok(Math.abs(p.position.z - 15.6) < 1.2, '应停在木箱上，z=' + p.position.z.toFixed(2))
})

test('可以沿坡道走上东侧高台，且不能从侧面直接上去', () => {
  const p = makePlayer(13, 8.4, 0, 0)
  simulate(p, 1.6, { ...idle, forward: 1 })
  assert.ok(Math.abs(p.position.y - 2.5) < 0.05, '应站上 2.5 米高台，实际 ' + p.position.y.toFixed(2))
  const side = makePlayer(9.0, -1.5, 0, -Math.PI / 2)
  simulate(side, 3, { ...idle, forward: 1 })
  assert.ok(side.position.y < 0.01, '侧面不应该被抬上高台，实际 ' + side.position.y.toFixed(2))
  assert.ok(side.position.x < 10, '应被高台侧面挡住')
})

test('高速移动不会穿墙', () => {
  const p = makePlayer(0, 19)
  p.velocity.set(-320, 0, 0)
  p.update(1 / 30, idle)
  assert.ok(p.position.x > -22.7, '不能穿出西墙，实际 ' + p.position.x.toFixed(2))
  const q = makePlayer(-5.6, -6.5, 0, Math.PI)
  q.velocity.set(0, 0, -320)
  q.update(1 / 30, idle)
  assert.ok(q.position.z > -8.6, '不能穿过拱门立柱/建筑，实际 ' + q.position.z.toFixed(2))
})

test('高处落下会停在箱顶而不是穿过去', () => {
  const p = makePlayer(0, 15.6, 8)
  simulate(p, 3, idle)
  assert.ok(Math.abs(p.position.y - 1.05) < 0.02, '应落在木箱顶，实际 ' + p.position.y.toFixed(3))
})

test('头顶碰撞：拱门下跳起会被顶住', () => {
  const p = makePlayer(-4.1, -9.0)
  let maxY = 0
  for (let i = 0; i < 90; i++) {
    p.update(1 / 60, { ...idle, jump: true })
    maxY = Math.max(maxY, p.position.y)
  }
  assert.ok(maxY <= 3.6 - 1.8 + 0.05, '头顶应被拱门横梁挡住，maxY=' + maxY.toFixed(2))
})

test('俯仰有限制，视角不会翻转', () => {
  const p = makePlayer(0, 19)
  for (let i = 0; i < 200; i++) p.look(0, -40, 0.002)
  assert.ok(p.pitch <= Math.PI / 2)
  assert.ok(Math.abs(p.pitch - (85 * Math.PI) / 180) < 1e-6)
  for (let i = 0; i < 400; i++) p.look(0, 40, 0.002)
  assert.ok(Math.abs(p.pitch + (85 * Math.PI) / 180) < 1e-6)
})

test('受伤与生命值下限', () => {
  const p = makePlayer(0, 19)
  assert.equal(p.health, 100)
  p.applyDamage(30)
  assert.equal(p.health, 70)
  p.applyDamage(200)
  assert.equal(p.health, 0)
  assert.equal(p.dead, true)
  p.applyDamage(10)
  assert.equal(p.health, 0, '不会出现负生命值')
})

test('重开恢复到出生点与满血', () => {
  const p = makePlayer(3, 4)
  p.applyDamage(70)
  p.reset(PLAYER_SPAWN)
  assert.equal(p.health, 100)
  assert.equal(p.dead, false)
  assert.ok(Math.abs(p.position.z - 19) < 1e-6)
  assert.equal(p.velocity.length(), 0)
})
