// 关卡与导航的自动检查
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARENA, PLAYER_SPAWN, ENEMY_SPAWNS, DUEL_SPAWNS, PHYS,
  buildLevel, buildNavGraph, surfaceHeightAt, supportHeightAt, capsuleBlocked, segmentClear,
  nearestNode, findPath, smoothPath
} from './world.js'
import { hasLineOfSight } from './combat.js'

const level = buildLevel()
const nav = buildNavGraph(level.solids)

test('场地约为 46 × 50 米且四面封闭', () => {
  assert.equal(ARENA.maxX - ARENA.minX, 46)
  assert.equal(ARENA.maxZ - ARENA.minZ, 50)
  const walls = level.solids.filter((s) => s.tag === 'wall')
  assert.equal(walls.length, 4)
})

test('导航图存在且主体连通', () => {
  assert.ok(nav.nodes.length > 500, '节点数量应当足够覆盖场地')
  assert.ok(nav.mainComponent.length > nav.nodes.length * 0.7)
})

test('地面支撑高度与台阶容差正确', () => {
  const crateTop = supportHeightAt(level.solids, 0, 15.6, 1.4)
  assert.ok(Math.abs(crateTop - 1.05) < 1e-6, '木箱顶面可以站立')
  // 站在地面时，2.5 米高的高台侧面不算支撑面
  assert.equal(supportHeightAt(level.solids, 14, -1.5, 0), 0)
  // 从高台上方落下时，高台顶面是支撑面
  assert.ok(Math.abs(supportHeightAt(level.solids, 14, -1.5, 3.0) - 2.5) < 1e-6)
  assert.equal(surfaceHeightAt(level.solids, 14, -1.5), 2.5)
})

test('玩家出生点周围没有实体阻挡', () => {
  assert.equal(capsuleBlocked(level.solids, PLAYER_SPAWN.x, PLAYER_SPAWN.z, 0, PHYS.playerRadius, PHYS.playerHeight), false)
})

test('八个敌人出生点都合法且不与掩体重叠', () => {
  assert.equal(ENEMY_SPAWNS.length, 8)
  for (const s of ENEMY_SPAWNS) {
    assert.ok(s.x > ARENA.minX && s.x < ARENA.maxX && s.z > ARENA.minZ && s.z < ARENA.maxZ, '出生点在场地内')
    assert.equal(
      capsuleBlocked(level.solids, s.x, s.z, 0, PHYS.enemyRadius, PHYS.enemyHeight, 0.45),
      false,
      '出生点 ' + s.x + ',' + s.z + ' 不应卡在掩体里'
    )
  }
})

// ---------------------------------------------------------------------------
// 双人对战的出生点
// ---------------------------------------------------------------------------
test('两个决斗出生点都在场地内、站在平地上、没有卡进掩体', () => {
  assert.equal(DUEL_SPAWNS.length, 2)
  for (const s of DUEL_SPAWNS) {
    assert.ok(s.x > ARENA.minX && s.x < ARENA.maxX && s.z > ARENA.minZ && s.z < ARENA.maxZ, '出生点在场地内')
    const ground = supportHeightAt(level.solids, s.x, s.z, 6, PHYS.stepHeight, PHYS.playerRadius)
    assert.ok(Math.abs(ground) < 1e-6, '出生点 ' + s.x + ',' + s.z + ' 应当站在地面高度 0，实际 ' + ground)
    assert.equal(
      capsuleBlocked(level.solids, s.x, s.z, ground, PHYS.playerRadius, PHYS.playerHeight, PHYS.stepHeight),
      false,
      '出生点 ' + s.x + ',' + s.z + ' 不应卡在实体里'
    )
  }
})

test('两个决斗出生点关于场地中心点对称，保证双方公平', () => {
  const [a, b] = DUEL_SPAWNS
  assert.ok(Math.abs(a.x + b.x) < 1e-9, 'x 应互为相反数')
  assert.ok(Math.abs(a.z + b.z) < 1e-9, 'z 应互为相反数')
  const dist = Math.hypot(b.x - a.x, b.z - a.z)
  assert.ok(dist > 25 && dist < 45, '间距应在可交战范围内，实际 ' + dist.toFixed(1) + ' 米')
})

test('开局两人互相看不见 —— 否则一出生就是互狙', () => {
  const [a, b] = DUEL_SPAWNS
  const eyeA = { x: a.x, y: a.y + PHYS.playerEye, z: a.z }
  const eyeB = { x: b.x, y: b.y + PHYS.playerEye, z: b.z }
  assert.equal(hasLineOfSight(level.solids, eyeA, eyeB), false, '两个出生点之间不应有直线视线')
})

test('两个决斗出生点能互相走到', () => {
  const [a, b] = DUEL_SPAWNS
  const na = nearestNode(nav, a.x, a.z, { maxDist: 5 })
  const nb = nearestNode(nav, b.x, b.z, { maxDist: 5 })
  assert.ok(na >= 0 && nb >= 0, '两个出生点附近都要有导航节点')
  assert.ok(nav.mainComponent.includes(na) && nav.mainComponent.includes(nb), '都要在导航主体内')
  assert.ok(findPath(nav, na, nb), '应当存在一条通路')
})

test('两个决斗出生点的朝向都正对彼此', () => {
  const [a, b] = DUEL_SPAWNS
  // 游戏约定 forward = (-sin(yaw), -cos(yaw))，见 player.js forwardVector
  for (const [from, to] of [[a, b], [b, a]]) {
    const fx = -Math.sin(from.yaw)
    const fz = -Math.cos(from.yaw)
    const dx = to.x - from.x
    const dz = to.z - from.z
    const len = Math.hypot(dx, dz)
    const dot = (fx * dx + fz * dz) / len
    assert.ok(dot > 0.9999, '朝向应几乎正对对面，实际 cos=' + dot)
  }
})

test('八个出生点都能到达玩家入口', () => {
  const goal = nearestNode(nav, PLAYER_SPAWN.x, PLAYER_SPAWN.z, { maxDist: 4 })
  assert.ok(goal >= 0, '玩家入口应落在导航图上')
  for (const s of ENEMY_SPAWNS) {
    const start = nearestNode(nav, s.x, s.z, { maxDist: 4 })
    assert.ok(start >= 0, '出生点 ' + s.x + ',' + s.z + ' 附近应有导航节点')
    const path = findPath(nav, start, goal)
    assert.ok(path && path.length > 1, '出生点 ' + s.x + ',' + s.z + ' 应能走到玩家入口')
  }
})

test('八个出生点都能经坡道到达东侧高台', () => {
  const plateau = nav.nodes.find((n) => n.x > 11 && n.x < 17 && n.z > -3.5 && n.z < 0.5 && Math.abs(n.y - 2.5) < 0.01)
  assert.ok(plateau, '高台顶面应有导航节点')
  const ramp = nav.nodes.find((n) => Math.abs(n.x - 13) < 0.6 && n.z > 6 && n.z < 8 && n.y > 0.2)
  assert.ok(ramp, '坡道中段应有节点')
  assert.ok(findPath(nav, ramp.id, plateau.id), '坡道应连到高台')
  for (const s of ENEMY_SPAWNS) {
    const start = nearestNode(nav, s.x, s.z, { maxDist: 4 })
    assert.ok(findPath(nav, start, plateau.id), '出生点应能走到高台')
  }
})

test('高台侧面无法直接走上，坡道是唯一通路', () => {
  // 高台西侧地面点，无法一步踏上 2.5 米
  assert.equal(supportHeightAt(level.solids, 9.4, -1.5, 0), 0)
  // 坡道下方相邻台阶高度差不超过台阶容差
  const a = supportHeightAt(level.solids, 13, 8.5, 0.4)
  const b = supportHeightAt(level.solids, 13, 7.5, 0.7)
  assert.ok(b - a > 0 && b - a <= PHYS.stepHeight)
})

test('掩体与围墙封闭：不能从场内直接穿出', () => {
  assert.equal(capsuleBlocked(level.solids, -23.4, 0, 0, 0.33, 1.8), true)
  assert.equal(capsuleBlocked(level.solids, 0, -25.4, 0, 0.33, 1.8), true)
})

test('至少存在一条长距离狙击视线通道', () => {
  const lanes = [
    { name: '西侧通路', x: -19.0, z0: 23, z1: -23 },
    { name: '东侧通路', x: 20.5, z0: 20, z1: -22 }
  ]
  let okCount = 0
  for (const lane of lanes) {
    let blocked = false
    const steps = 200
    for (let i = 0; i <= steps; i++) {
      const z = lane.z0 + ((lane.z1 - lane.z0) * i) / steps
      if (capsuleBlocked(level.solids, lane.x, z, 0.6, 0.06, 1.6)) { blocked = true; break }
    }
    if (!blocked) okCount++
    else assert.ok(true, lane.name + ' 被遮挡（允许单侧遮挡，但至少一条要通）')
  }
  assert.ok(okCount >= 1, '至少一条长视线通道应保持畅通')
})

test('路径平滑仍然保持可通行', () => {
  const start = nearestNode(nav, -16.9, 6.4, { maxDist: 4 })
  const goal = nearestNode(nav, PLAYER_SPAWN.x, PLAYER_SPAWN.z, { maxDist: 4 })
  const raw = findPath(nav, start, goal)
  const sm = smoothPath(level.solids, nav, raw)
  assert.ok(sm.length <= raw.length)
  for (let i = 0; i < sm.length - 1; i++) {
    const a = nav.nodes[sm[i]]
    const b = nav.nodes[sm[i + 1]]
    assert.ok(segmentClear(level.solids, a.x, a.z, a.y, b.x, b.z, b.y, nav.clearance, nav.bodyHeight, nav.stepAllow), '拉直后的每一段都应可通行')
  }
})

test('坡道之外的连通性：两侧通路可以绕行回庭院', () => {
  const west = nearestNode(nav, -19.5, -14, { maxDist: 4 })
  const east = nearestNode(nav, 20.5, -14, { maxDist: 4 })
  const center = nearestNode(nav, 0, 6, { maxDist: 4 })
  assert.ok(west >= 0 && east >= 0 && center >= 0)
  assert.ok(findPath(nav, west, center), '西路可以回到庭院')
  assert.ok(findPath(nav, east, center), '东路可以回到庭院')
  assert.ok(findPath(nav, west, east), '两条侧路之间可以绕行')
})
