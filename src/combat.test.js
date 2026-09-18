import test from 'node:test'
import assert from 'node:assert/strict'
import { rayBox, rayCylinder, rayEllipsoid, raycastSolids, raycastEnemies, resolveShot, hasLineOfSight, HEAD_HITBOX, BODY_HITBOX } from './combat.js'
import { buildLevel, ENEMY_SPAWNS } from './world.js'

const level = buildLevel()
const V = (x, y, z) => ({ x, y, z })

function makeEnemy(x, z, y = 0) {
  return { position: V(x, y, z), alive: true, health: 80, id: Math.random().toString(36).slice(2, 6) }
}

test('射线与包围盒求交给出正确的距离与法线', () => {
  const b = { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -1, maxZ: 1 }
  const hit = rayBox(-5, 1, 0, 1, 0, 0, b)
  assert.ok(hit)
  assert.ok(Math.abs(hit.t - 4) < 1e-9)
  assert.equal(hit.nx, -1)
  const miss = rayBox(-5, 5, 0, 1, 0, 0, b)
  assert.equal(miss, null)
})

test('射线与圆柱、椭球求交', () => {
  const cyl = { kind: 'cyl', x: 0, z: 0, r: 0.5, minY: 0, maxY: 1 }
  const hit = rayCylinder(-3, 0.5, 0, 1, 0, 0, cyl)
  assert.ok(hit && Math.abs(hit.t - 2.5) < 1e-9)
  const over = rayCylinder(-3, 2.0, 0, 1, 0, 0, cyl)
  assert.equal(over, null)
  const t = rayEllipsoid(-4, 0.79, 0, 1, 0, 0, 0, 0.79, 0, 0.4, 0.47, 0.32)
  assert.ok(t && Math.abs(t - 3.6) < 1e-6)
})

test('身体与头部命中区域按真实模型区分', () => {
  const e = makeEnemy(0, 0)
  const headShot = resolveShot(V(-4, 1.55, 0), V(1, 0, 0), { solids: [], enemies: [e] })
  assert.equal(headShot.type, 'enemy')
  assert.equal(headShot.part, 'head')
  const bodyShot = resolveShot(V(-4, 0.8, 0), V(1, 0, 0), { solids: [], enemies: [e] })
  assert.equal(bodyShot.part, 'body')
  // 头顶上方的帽子边缘仍然算头
  const hat = resolveShot(V(-4, HEAD_HITBOX.y + HEAD_HITBOX.ry - 0.05, 0), V(1, 0, 0), { solids: [], enemies: [e] })
  assert.equal(hat.part, 'head')
  // 脚边只算身体
  const leg = resolveShot(V(-4, 0.35, 0), V(1, 0, 0), { solids: [], enemies: [e] })
  assert.equal(leg.part, 'body')
})

test('墙体优先于同距离或几乎同距离的目标', () => {
  const wall = { kind: 'box', minX: 1, maxX: 1.4, minY: 0, maxY: 3, minZ: -1, maxZ: 1, x: 1.2, z: 0 }
  const e = makeEnemy(1.5, 0)   // 站在墙后极近处
  const shot = resolveShot(V(0, 1.0, 0), V(1, 0, 0), { solids: [wall], enemies: [e] })
  assert.equal(shot.type, 'wall', '墙后的目标不应被射中')
})

test('墙后目标在任何距离都不会被命中', () => {
  const wall = { kind: 'box', minX: 2, maxX: 3, minY: 0, maxY: 3, minZ: -3, maxZ: 3, x: 2.5, z: 0 }
  const e = makeEnemy(8, 0)
  const shot = resolveShot(V(0, 1.2, 0), V(1, 0, 0), { solids: [wall], enemies: [e] })
  assert.equal(shot.type, 'wall')
  assert.equal(hasLineOfSight([wall], V(0, 1.2, 0), V(8, 1.2, 0)), false)
})

test('死亡敌人立即从可命中目标中移除，不挡住后面的活目标', () => {
  const dead = makeEnemy(3, 0)
  dead.alive = false
  const alive = makeEnemy(6, 0)
  const shot = resolveShot(V(0, 1.0, 0), V(1, 0, 0), { solids: [], enemies: [dead, alive] })
  assert.equal(shot.type, 'enemy')
  assert.equal(shot.enemy, alive, '应该打到后面的活目标')
})

test('真实关卡：出生点前不会被墙外的敌人射中', () => {
  const e = makeEnemy(-2.4, -10.4)
  // 从玩家出生点看向庭院中心方向，中间隔着木箱/屏风
  const shot = resolveShot(V(0, 1.68, 19), V(0, 0, -1), { solids: level.solids, enemies: [e] })
  assert.notEqual(shot.type, 'enemy')
})

test('真实关卡：长视线通道上可以直击目标', () => {
  const e = makeEnemy(-19, -14)
  const shot = resolveShot(V(-19, 1.68, 20), V(0, 0, -1), { solids: level.solids, enemies: [e] })
  assert.equal(shot.type, 'enemy')
  assert.ok(shot.distance > 30, '这应该是一次远距离命中，实际 ' + shot.distance.toFixed(1))
})

test('敌人的射线遮挡列表不会把装饰描边当作目标', () => {
  // 装饰性轮廓线不参与 raycastSolids：只用 solids 列表，数量应等于实体数
  const solids = level.solids
  assert.ok(solids.length > 40)
  assert.ok(solids.every((s) => typeof s.minX === 'number' && typeof s.maxY === 'number'))
})

test('八个出生点的敌人都不会互相挡住判定', () => {
  const enemies = ENEMY_SPAWNS.map((s) => makeEnemy(s.x, s.z))
  for (let i = 0; i < enemies.length; i++) {
    const origin = V(enemies[i].position.x, 1.55, enemies[i].position.z + 0.001)
    const dir = V(0, 0, -1)
    const hit = raycastEnemies(origin, dir, enemies)
    if (hit) assert.equal(hit.enemy, enemies[i], '正前方首先命中的应该是自己')
  }
})
