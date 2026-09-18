// 对局规则：角色注册、敌对关系、伤害结算与胜负判定
import test from 'node:test'
import assert from 'node:assert/strict'
import { Match, MODE, TEAM, opponentStatus } from './match.js'
import { Player } from './player.js'
import { WEAPONS } from './weapon-state.js'
import { buildLevel, PLAYER_SPAWN, DUEL_SPAWNS } from './world.js'

const level = buildLevel()
const world = { solids: level.solids, playerSpawn: PLAYER_SPAWN, nav: null }

function makePlayer(id, team, spawn, opts = {}) {
  const p = new Player(world, { id, team, ...opts })
  p.reset(spawn)
  return p
}

function makeEnemy(health = 80, alive = true) {
  return { position: { x: 0, y: 0, z: 0 }, alive, health, takeDamage(a) { this.health -= a; return { died: false, damage: a, part: 'body' } } }
}

function duelMatch() {
  const m = new Match({ world, mode: MODE.DUEL })
  const a = m.addPlayer(makePlayer('p1', TEAM.A, DUEL_SPAWNS[0], { isLocal: true }))
  const b = m.addPlayer(makePlayer('p2', TEAM.B, DUEL_SPAWNS[1], { isLocal: false }))
  return { m, a, b }
}

test('SOLO 模式沿用原规则：敌人清零即胜利', () => {
  const m = new Match({ world, mode: MODE.SOLO })
  m.addPlayer(makePlayer('p1', TEAM.A, PLAYER_SPAWN, { isLocal: true }))
  m.setEnemies([makeEnemy(), makeEnemy()])
  assert.equal(m.checkVictory(), null, '还有敌人时不该结束')
  m.enemies[0].alive = false
  assert.equal(m.checkVictory(), null)
  m.enemies[1].alive = false
  assert.deepEqual(m.checkVictory(), { over: true, winner: 'player' })
})

test('DUEL 模式场地为空，开局绝不误判胜利（关键回归）', () => {
  const { m } = duelMatch()
  m.setEnemies([])   // 决斗场地没有 AI 敌人
  assert.equal(m.aliveEnemies, 0)
  assert.equal(m.checkVictory(), null, '活敌人为 0 时决斗模式必须继续，不能被 SOLO 规则误判')
})

test('DUEL 模式：一方全灭即分胜负', () => {
  const { m, a, b } = duelMatch()
  assert.equal(m.checkVictory(), null)
  b.takeDamage(1000)
  assert.deepEqual(m.checkVictory(), { over: true, winner: TEAM.A })
  assert.equal(m.didLocalWin(m.checkVictory()), true, '本地是 A 队，应当算赢')
})

test('DUEL 模式：本地玩家死亡算输', () => {
  const { m, a, b } = duelMatch()
  a.takeDamage(1000)
  const r = m.checkVictory()
  assert.deepEqual(r, { over: true, winner: TEAM.B })
  assert.equal(m.didLocalWin(r), false)
})

test('DUEL 模式：双方同时倒下时不算任何一方赢（避免平局闪烁）', () => {
  const { m, a, b } = duelMatch()
  a.takeDamage(1000)
  b.takeDamage(1000)
  assert.equal(m.checkVictory(), null)
})

test('同队之间不互为命中目标', () => {
  const m = new Match({ world, mode: MODE.DUEL })
  const a1 = m.addPlayer(makePlayer('p1', TEAM.A, DUEL_SPAWNS[0], { isLocal: true }))
  const a2 = m.addPlayer(makePlayer('p2', TEAM.A, DUEL_SPAWNS[1]))
  m.addPlayer(makePlayer('p3', TEAM.B, PLAYER_SPAWN))
  assert.deepEqual(m.hostilesOf(a1).map((p) => p.id), ['p3'])
  assert.equal(m.hitTargets.some((t) => t.id === 'p2'), false, '队友不该进命中列表')
})

test('SOLO 的命中目标包含敌人，DUEL 不包含', () => {
  const solo = new Match({ world, mode: MODE.SOLO })
  solo.addPlayer(makePlayer('p1', TEAM.A, PLAYER_SPAWN, { isLocal: true }))
  const e = makeEnemy()
  solo.setEnemies([e])
  assert.ok(solo.hitTargets.includes(e))

  const { m } = duelMatch()
  m.setEnemies([makeEnemy()])   // 即便塞了敌人，决斗模式也不该把它们当目标
  assert.equal(m.hitTargets.includes(m.enemies[0]), false)
})

test('死亡的角色立即从命中列表移除', () => {
  const { m, b } = duelMatch()
  assert.equal(m.hitTargets.length, 1)
  b.takeDamage(1000)
  assert.equal(m.hitTargets.length, 0)
})

test('damage 是唯一结算入口，两种角色都能吃', () => {
  const { m, b } = duelMatch()
  assert.deepEqual(m.damage(b, 30, 'body'), { died: false, damage: 30, part: 'body' })
  assert.equal(b.health, 70)
  const e = makeEnemy()
  assert.equal(m.damage(e, 20, 'head').damage, 20)
  assert.deepEqual(m.damage(null, 50), { died: false, damage: 0, part: 'body' }, '空目标不应抛异常')
})

test('重复的玩家 id 会被拒绝', () => {
  const m = new Match({ world, mode: MODE.DUEL })
  m.addPlayer(makePlayer('p1', TEAM.A, DUEL_SPAWNS[0]))
  assert.throws(() => m.addPlayer(makePlayer('p1', TEAM.B, DUEL_SPAWNS[1])), /重复的玩家 id/)
})

test('重开会把所有角色送回各自的出生点并回满血', () => {
  const { m, a, b } = duelMatch()
  a.takeDamage(60)
  b.takeDamage(1000)
  m.restart()
  for (const p of [a, b]) {
    assert.equal(p.health, p.maxHealth)
    assert.equal(p.dead, false)
  }
  assert.ok(Math.abs(a.position.x - DUEL_SPAWNS[0].x) < 1e-9)
  assert.ok(Math.abs(b.position.z - DUEL_SPAWNS[1].z) < 1e-9)
  assert.equal(m.checkVictory(), null)
})

test('opponentStatus 给出对手的血量供 HUD 显示', () => {
  const { m, b } = duelMatch()
  b.name = '陪练'
  b.weaponId = 'sniper'
  b.takeDamage(40)
  const s = opponentStatus(m)
  assert.equal(s.id, 'p2')
  assert.equal(s.hp, 60)
  assert.equal(s.maxHp, 100)
  assert.equal(s.alive, true)
  // 人名与人手里的枪是两件事 —— 曾经把武器简称当人名显示过，别再退回去
  assert.equal(s.name, '陪练')
  assert.equal(s.weapon, WEAPONS.sniper.shortName)
})

test('opponentStatus 在对手倒下后仍然返回，只是 alive 为 false', () => {
  const { m, b } = duelMatch()
  b.takeDamage(1000)
  const s = opponentStatus(m)
  assert.equal(s.alive, false, 'HUD 要能显示「已击倒」，整行消失会被误读成对战还没开始')
  assert.equal(s.hp, 0)
  assert.equal(s.id, 'p2')
})

test('没有对手时 opponentStatus 返回 null 而不是抛异常', () => {
  const m = new Match({ world, mode: MODE.SOLO })
  assert.equal(opponentStatus(m), null, '连本地玩家都没有')
  m.addPlayer(makePlayer('p1', TEAM.A, PLAYER_SPAWN, { isLocal: true }))
  assert.equal(opponentStatus(m), null, '只有本地玩家一人')
})
