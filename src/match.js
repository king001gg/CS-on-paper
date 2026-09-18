// 纸上交锋 · PAPER STRIKE —— 对局：角色注册、胜负规则与伤害结算
// 本文件刻意不碰 DOM / Three.js —— 第 3 期的双端收敛测试要在 Node 里同时跑两个 Match。
import { WEAPONS } from './weapon-state.js'

export const MODE = { SOLO: 'solo', DUEL: 'duel' }
export const TEAM = { A: 'a', B: 'b' }

/**
 * 一局对战。持有全部参战角色，并回答「谁打谁」「谁赢了」。
 *
 * 敌人列表由外部注入（setEnemies），因为 EnemyManager 需要 scene 而 Match 不需要。
 * SOLO 模式沿用原来的规则：敌人清零即胜利。
 * DUEL 模式按队伍判：一方全灭即分胜负 —— 注意此时敌人列表通常是空的，
 * 若还按「敌人清零」判就会开局瞬间宣告胜利。
 */
export class Match {
  constructor({ world, mode = MODE.SOLO } = {}) {
    this.world = world || null
    this.mode = mode
    this.players = []
    this.enemies = []
    this.winner = null
  }

  get local() {
    return this.players.find((p) => p.isLocal) || null
  }

  get remotes() {
    return this.players.filter((p) => !p.isLocal)
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id) || null
  }

  get aliveEnemies() {
    return this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0)
  }

  addPlayer(player) {
    if (this.getPlayer(player.id)) throw new Error('重复的玩家 id：' + player.id)
    this.players.push(player)
    return player
  }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id)
    if (i >= 0) this.players.splice(i, 1)
  }

  setEnemies(list) {
    this.enemies = list || []
  }

  /** 与 shooter 敌对、且可以被射线打中的目标 */
  hostilesOf(shooter) {
    return this.players.filter((p) => p !== shooter && p.team !== shooter.team && p.alive)
  }

  /**
   * 本地玩家这一发射线要检测的全部目标。
   * SOLO：敌人 + 敌对玩家；DUEL：只有敌对玩家（场地是空的）。
   */
  get hitTargets() {
    const me = this.local
    const foes = me ? this.hostilesOf(me) : []
    return this.mode === MODE.SOLO ? [...this.enemies, ...foes] : [...foes]
  }

  /**
   * 唯一的伤害结算入口。两种角色都提供同形的 takeDamage，
   * 所以这里不需要按类型分支 —— 这正是第 1 期统一伤害接口的目的。
   */
  damage(target, amount, part = 'body') {
    if (!target || typeof target.takeDamage !== 'function') return { died: false, damage: 0, part }
    return target.takeDamage(amount, part)
  }

  /**
   * 判定本局是否结束。返回 null 表示继续。
   * 注意 DUEL 分支必须在 SOLO 之前，因为决斗场地没有敌人，
   * aliveEnemies === 0 会让 SOLO 规则立刻误判为胜利。
   */
  checkVictory() {
    if (this.mode === MODE.DUEL) {
      const aAlive = this.players.some((p) => p.team === TEAM.A && !p.dead)
      const bAlive = this.players.some((p) => p.team === TEAM.B && !p.dead)
      // 双方都还有人（或双方都没人）→ 继续
      if (aAlive === bAlive) return null
      return { over: true, winner: aAlive ? TEAM.A : TEAM.B }
    }
    if (this.aliveEnemies > 0) return null
    return { over: true, winner: 'player' }
  }

  /** 本地玩家是否赢了这一局 */
  didLocalWin(result) {
    const me = this.local
    if (!result || !result.over || !me) return false
    if (this.mode === MODE.DUEL) return result.winner === me.team
    return result.winner === 'player'
  }

  restart() {
    this.winner = null
    for (const p of this.players) p.reset(p.spawn)
  }
}

/**
 * 决斗模式的对手状态，供 HUD 显示。
 * 对手已倒下时也照样返回（alive: false），HUD 才能显示「已击倒」
 * 而不是让整行消失 —— 那会让人以为对战还没开始。
 */
export function opponentStatus(match) {
  const me = match.local
  const foe = me ? match.hostilesOf(me)[0] || null : null
  const other = match.players.find((p) => p !== me) || null
  const target = foe || other
  if (!target) return null
  return {
    id: target.id,
    name: target.name || '对手',
    weapon: WEAPONS[target.weaponId] ? WEAPONS[target.weaponId].shortName : '',
    hp: target.health,
    maxHp: target.maxHealth,
    alive: target.alive
  }
}
