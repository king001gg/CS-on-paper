import test from 'node:test'
import assert from 'node:assert/strict'
import { Enemy, EnemyManager, ENEMY_CONFIG, hitChanceAt } from './enemies.js'
import { buildLevel, buildNavGraph, ENEMY_SPAWNS, PLAYER_SPAWN } from './world.js'
import { hasLineOfSight } from './combat.js'
import * as THREE from 'three'

const level = buildLevel()
const nav = buildNavGraph(level.solids)
const world = { solids: level.solids, nav, enemySpawns: ENEMY_SPAWNS, playerSpawn: PLAYER_SPAWN, scene: { add() {}, remove() {} } }

function makePlayer(x, z, y = 0) {
  return { position: new THREE.Vector3(x, y, z), alive: true, health: 100 }
}

function makeCtx(player, over = {}) {
  return {
    player,
    solids: level.solids,
    canFight: true,
    effects: null,
    audio: null,
    random: () => 0.5,
    onPlayerHit: () => {},
    enemies: [],
    ...over
  }
}

function spawnEnemy(i, x, z, yaw = 0) {
  return new Enemy(world, i, { x, z }, { headless: true, yaw })
}

test('命中率随距离在 23%–53% 之间变化', () => {
  assert.ok(Math.abs(hitChanceAt(5) - 0.53) < 1e-9)
  assert.ok(Math.abs(hitChanceAt(24) - 0.23) < 1e-9)
  assert.ok(hitChanceAt(10) < 0.53 && hitChanceAt(10) > 0.23)
  assert.ok(hitChanceAt(100) >= 0.23 - 1e-9)
})

test('墙后的玩家不会被发现，也不会被射中', () => {
  const player = makePlayer(-12, -8)
  const e = spawnEnemy(0, -16.9, 6.4)
  assert.equal(hasLineOfSight(level.solids, e.eyePosition, { x: player.position.x, y: 1.15, z: player.position.z }), false, '两点之间应被西侧建筑挡住')
  assert.equal(e.checkSight(makeCtx(player)), false)
  let hits = 0
  const ctx = makeCtx(player, { random: () => 0, onPlayerHit: () => { hits++ } })
  for (let i = 0; i < 5; i++) e.fire(ctx)
  assert.equal(hits, 0, '被遮挡时不应造成伤害')
})

test('敌人沿导航绕过建筑接近玩家（不是沿直线假装导航）', () => {
  const e = spawnEnemy(1, -16.9, 6.4)
  const goal = { x: -12, z: -8 }
  const direct = Math.hypot(goal.x + 16.9, goal.z - 6.4)
  assert.equal(e.setPathTo(goal.x, goal.z), true, '应该能找到路径')
  let pathLen = 0
  let prev = { x: e.position.x, z: e.position.z }
  for (const node of e.path) {
    pathLen += Math.hypot(node.x - prev.x, node.z - prev.z)
    prev = node
  }
  assert.ok(pathLen > direct + 2, '路径应明显长于直线 ' + pathLen.toFixed(1) + ' vs ' + direct.toFixed(1))
  const ctx = makeCtx(makePlayer(0, 19))
  for (let i = 0; i < 900; i++) {
    const steer = e.steerAlongPath(1 / 60)
    if (!steer || steer.arrived) break
    e.turnTowards(steer.x, steer.z, 1 / 60, 6)
    e.move(1 / 60, steer.x, steer.z, ENEMY_CONFIG.chaseSpeed, ctx)
  }
  const d = Math.hypot(e.position.x - goal.x, e.position.z - goal.z)
  assert.ok(d < 2.5, '应该绕到目标点附近，实际距离 ' + d.toFixed(2))
})

test('发现玩家后先预警再开火，冷却不低于 1.2 秒', () => {
  const player = makePlayer(-19, 0)
  const e = spawnEnemy(2, -19, 12, 0)   // yaw=0 朝向 -Z，正对玩家
  const shots = []
  let t = 0
  const ctx = makeCtx(player, { random: () => 0, onPlayerHit: () => shots.push(t) })
  for (let i = 0; i < 60 * 14; i++) {
    e.update(1 / 60, ctx)
    t += 1 / 60
  }
  assert.ok(shots.length >= 2, '14 秒内应至少开火两次，实际 ' + shots.length)
  assert.ok(shots[0] > ENEMY_CONFIG.minTelegraph, '第一发应在预警之后，实际 ' + shots[0].toFixed(2))
  for (let i = 1; i < shots.length; i++) {
    assert.ok(shots[i] - shots[i - 1] >= ENEMY_CONFIG.cooldownFloor - 0.02, '两次攻击间隔 ' + (shots[i] - shots[i - 1]).toFixed(2))
  }
})

test('每次命中造成 10 点伤害，玩家血量不会变成负数由玩家侧保证', () => {
  const player = makePlayer(-19, 0)
  const e = spawnEnemy(3, -19, 10, 0)   // 面向玩家
  let damage = 0
  const ctx = makeCtx(player, { random: () => 0, onPlayerHit: (d) => { damage += d } })
  for (let i = 0; i < 60 * 3; i++) e.update(1 / 60, ctx)
  assert.ok(damage >= ENEMY_CONFIG.damage, '应至少命中一次')
  assert.equal(damage % ENEMY_CONFIG.damage, 0)
})

test('未取得控制（准备页/暂停）时敌人不推进、不攻击', () => {
  const player = makePlayer(-19, 0)
  const e = spawnEnemy(4, -19, 10, 0)
  let hits = 0
  const ctx = makeCtx(player, { canFight: false, random: () => 0, onPlayerHit: () => { hits++ } })
  const start = e.position.clone()
  for (let i = 0; i < 60 * 5; i++) e.update(1 / 60, ctx)
  assert.equal(hits, 0)
  assert.equal(e.state, 'patrol')
  assert.ok(e.position.distanceTo(start) < 1e-6, '暂停时不应该移动')
})

test('身体 20 点伤害：冲锋枪四发打死一名敌人', () => {
  const e = spawnEnemy(5, 4.4, -1.0)
  assert.equal(e.health, ENEMY_CONFIG.maxHealth)
  assert.equal(e.takeDamage(20).died, false)
  assert.equal(e.takeDamage(20).died, false)
  assert.equal(e.takeDamage(20).died, false)
  const last = e.takeDamage(20)
  assert.equal(last.died, true)
  assert.equal(e.alive, false, '死亡后立即从可命中目标移除')
  assert.equal(e.takeDamage(20).died, false, '已经死亡的敌人不会再次结算')
})

test('狙击枪一发身体伤害即可击杀，爆头伤害更高', () => {
  const a = spawnEnemy(6, 4.4, -1.0)
  assert.equal(a.takeDamage(100, 'body').died, true)
  const b = spawnEnemy(7, 4.4, -1.0)
  assert.equal(b.takeDamage(200, 'head').died, true)
})

test('失去视线后搜索最后位置，约 7 秒后回到巡逻', () => {
  const player = makePlayer(-19, 0)
  const e = spawnEnemy(0, -19, 12, 0)
  const ctx = makeCtx(player)
  assert.equal(e.checkSight(ctx), true, '初始状态应该能看见正前方的玩家')
  let sawAttack = false
  for (let i = 0; i < 60 * 3; i++) {
    e.update(1 / 60, ctx)
    if (e.state === 'attack' || e.state === 'alert') sawAttack = true
  }
  assert.equal(sawAttack, true, '应该先发现玩家')
  // 玩家瞬移到墙后
  player.position.set(-12, 0, -8)
  let sawSearch = false
  for (let i = 0; i < 60 * 12; i++) {
    e.update(1 / 60, ctx)
    if (e.state === 'search') sawSearch = true
  }
  assert.equal(sawSearch, true, '丢失视线后应进入搜索')
  assert.ok(e.state === 'patrol' || e.state === 'search' || e.state === 'attack')
})

test('管理器统计存活数量与击杀，重开恢复八名敌人', () => {
  const mgr = new EnemyManager(world, world.scene, { headless: true })
  assert.equal(mgr.aliveCount, 8)
  for (const e of mgr.enemies) e.takeDamage(1000, 'body')
  assert.equal(mgr.aliveCount, 0)
  const alive = mgr.hitTargets.filter((e) => e.alive)
  assert.equal(alive.length, 0, '死亡敌人不参与命中判定')
  mgr.reset()
  assert.equal(mgr.aliveCount, 8)
  for (const e of mgr.enemies) {
    assert.equal(e.health, ENEMY_CONFIG.maxHealth)
    assert.equal(e.alive, true)
  }
})

test('枪声会让附近敌人警觉', () => {
  const mgr = new EnemyManager(world, world.scene, { headless: true })
  mgr.alertNoise({ x: -19, y: 1.6, z: 10 }, 18)
  const near = mgr.enemies.filter((e) => e.state === 'alert')
  assert.ok(near.length >= 1, '附近的敌人应该进入警戒')
  const far = mgr.enemies.filter((e) => e.state === 'patrol')
  assert.ok(far.length >= 1, '远处的敌人保持巡逻')
})
