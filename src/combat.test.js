import test from 'node:test'
import assert from 'node:assert/strict'
import { rayBox, rayCylinder, rayEllipsoid, raycastSolids, raycastEnemies, resolveShot, hasLineOfSight, HEAD_HITBOX, BODY_HITBOX, HITBOX_PROFILES } from './combat.js'
import { buildLevel, ENEMY_SPAWNS, PLAYER_SPAWN } from './world.js'
import { Player } from './player.js'

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

// ---------------------------------------------------------------------------
// 多角色：玩家也要能被打中（双人对战的地基）
// ---------------------------------------------------------------------------
const duelWorld = { solids: level.solids, playerSpawn: PLAYER_SPAWN, nav: null }

function makeRealPlayer(x, z, opts = {}) {
  const p = new Player(duelWorld, opts)
  p.reset({ x, y: 0, z, yaw: 0 })
  return p
}

test('真实的 Player 可以作为射线目标被命中（靠 alive + position + hitProfile）', () => {
  const p = makeRealPlayer(0, 0)
  assert.equal(p.alive, true, 'alive 必须存在，否则 raycastTargets 会跳过它')
  const shot = resolveShot(V(-4, 1.55, 0), V(1, 0, 0), { solids: [], targets: [p] })
  assert.equal(shot.type, 'enemy')
  assert.equal(shot.enemy, p)
  assert.equal(shot.part, 'head')
})

test('targets 与 enemies 两个选项名等价（后者是兼容别名）', () => {
  const p = makeRealPlayer(0, 0)
  const viaTargets = resolveShot(V(-4, 1.55, 0), V(1, 0, 0), { solids: [], targets: [p] })
  const viaEnemies = resolveShot(V(-4, 1.55, 0), V(1, 0, 0), { solids: [], enemies: [p] })
  assert.equal(viaTargets.type, viaEnemies.type)
  assert.equal(viaTargets.enemy, viaEnemies.enemy)
})

test('混合目标列表（敌人 + 玩家）取最近的那个', () => {
  const near = makeEnemy(3, 0)
  const far = makeRealPlayer(6, 0)
  const shot = resolveShot(V(-4, 1.55, 0), V(1, 0, 0), { solids: [], targets: [far, near] })
  assert.equal(shot.enemy, near, '顺序打乱也要取最近的')
})

test('墙后的玩家不会被击中', () => {
  const wall = { kind: 'box', minX: 1, maxX: 1.4, minY: 0, maxY: 3, minZ: -1, maxZ: 1, x: 1.2, z: 0 }
  const p = makeRealPlayer(1.5, 0)   // 站在墙后极近处
  const shot = resolveShot(V(-4, 1.55, 0), V(1, 0, 0), { solids: [wall], targets: [p] })
  assert.equal(shot.type, 'wall')
})

test('hitProfile 真的生效：同一发在两种档案下结果不同', () => {
  // y=2.0 落在 enemy 头部椭球内（1.55±0.49），却在 player 头部椭球之上（1.62+0.26=1.88）
  const asEnemy = makeRealPlayer(0, 0, { hitProfile: 'enemy' })
  const asPlayer = makeRealPlayer(0, 0, { hitProfile: 'player' })
  const origin = V(-4, 2.0, 0)
  const dir = V(1, 0, 0)
  assert.equal(resolveShot(origin, dir, { solids: [], targets: [asEnemy] }).part, 'head')
  assert.equal(resolveShot(origin, dir, { solids: [], targets: [asPlayer] }).type, 'none')
})

test('被打死的玩家立即从可命中列表里消失', () => {
  const p = makeRealPlayer(0, 0)
  assert.equal(p.takeDamage(1000).died, true)
  assert.equal(p.alive, false)
  const shot = resolveShot(V(-4, 1.55, 0), V(1, 0, 0), { solids: [], targets: [p] })
  assert.equal(shot.type, 'none', '死亡目标不该再挡住子弹')
})

test('Player.takeDamage 的返回结构与 Enemy.takeDamage 逐字段一致', () => {
  // Enemy.takeDamage（enemies.js:342/350）返回的就是 { died, damage, part }；
  // 这里对着字面量断言，Match 才能用同一个结算入口处理两种角色。
  const p = makeRealPlayer(0, 0)
  assert.deepEqual(p.takeDamage(30, 'body'), { died: false, damage: 30, part: 'body' })
  assert.deepEqual(p.takeDamage(200, 'head'), { died: true, damage: 70, part: 'head' })
  assert.deepEqual(p.takeDamage(10), { died: false, damage: 0, part: 'body' }, '死后不再掉血')
})

test('applyDamage 旧接口的返回值保持为数字（player.test.js 依赖的语义）', () => {
  const p = makeRealPlayer(0, 0)
  assert.equal(p.applyDamage(30), 30)
  assert.equal(p.applyDamage(200), 70, '超出剩余血量时只返回实际扣掉的部分')
  assert.equal(p.applyDamage(10), 0)
})

test('命中档案：player 档案比 enemy 档案更贴合 1.8 米的玩家体型', () => {
  assert.equal(HEAD_HITBOX, HITBOX_PROFILES.enemy.head, '旧常量必须仍指向 enemy 档案')
  assert.equal(BODY_HITBOX, HITBOX_PROFILES.enemy.body)
  assert.ok(HITBOX_PROFILES.player.head.ry < HITBOX_PROFILES.enemy.head.ry)
  assert.ok(HITBOX_PROFILES.player.body.ry > HITBOX_PROFILES.enemy.body.ry)
})
