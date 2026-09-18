// 纸上交锋 · PAPER STRIKE —— 玩家化身：让别人能看见你
//
// 远端玩家直接复用敌人的纸片豆子模型 —— 不另做一套角色，因为命中盒也是按
// 敌人档案算的（见 combat.js 的 HITBOX_PROFILES 注释：命中盒跟渲染走，不跟物理走）。
// 模型与命中盒同源，就不会出现「看着打中了却穿过去」。
import * as THREE from 'three'
import { createEnemyModel, animateBeanRig, ENEMY_CONFIG } from './enemies.js'

/** 远端玩家的可视体。本质上就是 createEnemyModel，单独导出是为了让调用点自解释。 */
export function createPlayerRig(variant = 0, styleIndex = 0) {
  return createEnemyModel(variant, styleIndex)
}

// animateBeanRig 住在 enemies.js 里，与 createEnemyModel 相邻（都是「豆子小人怎么搭、怎么动」）。
// 这里转出去只是为了让调用方只认 player-rig.js 一个入口。
// 之所以不把它定义在本文件：Enemy.animate 要转调它，若它在本文件，
// enemies.js ↔ player-rig.js 就成了循环导入 —— 能跑，但 Rollup 会告警、依赖图也难读。
export { animateBeanRig }

/** 把角度差折到 [-π, π]，避免从 179° 转到 -179° 时绕一整圈 */
function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/**
 * 远端玩家在网络里的化身。
 *
 * applyState 收到的是主机快照里的权威状态，本类只负责「摆到画面上」。
 * 第 1 期没有任何网络代码调用它 —— 先把它写出来并测好，第 3 期只管接数据。
 * M3b 的插值会改成基于快照缓冲的时间插值，届时只需替换 _approach 这一处。
 */
export class PlayerAvatar {
  constructor(scene, { id, variant = 0, styleIndex = 0, name = '', headless = false } = {}) {
    this.id = id
    this.name = name
    this.scene = scene || null
    // headless 供 node 单测用：createEnemyModel 要画布贴图，跑不了无头环境。
    // 插值、收角、死亡这些逻辑与模型无关，值得单独测。
    this.model = headless ? null : createPlayerRig(variant, styleIndex)
    // 动画状态。形状与 Enemy 对齐，好让 animateBeanRig 原样复用
    this.state = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      walkPhase: 0,
      headTilt: 0,
      state: 'patrol',
      stateTime: 0
    }
    // 渲染值（画面上的）与目标值（快照给的），两者之差由 _approach 收敛
    this.rendered = { x: 0, y: 0, z: 0, yaw: 0 }
    this.target = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }
    this.health = 100
    this.maxHealth = 100
    this.alive = true
    this.lastSpeed = 0
    this.lerpRate = 14   // 越大越跟手；M3b 换成快照缓冲插值后此值作废
    if (this.scene && this.model) this.scene.add(this.model.group)
  }

  /** 接收一份权威状态。dt <= 0 时直接吸附（出生、回合开始、传送） */
  applyState(s, dt = 0) {
    this.target.x = s.x
    this.target.y = s.y ?? 0
    this.target.z = s.z
    this.target.yaw = s.yaw ?? 0
    this.target.pitch = s.pitch ?? 0
    if (typeof s.hp === 'number') this.health = s.hp
    if (typeof s.maxHp === 'number') this.maxHealth = s.maxHp
    if (dt <= 0) this.snap()
    return this
  }

  /** 丢弃插值，立刻贴到目标位置 */
  snap() {
    this.rendered.x = this.target.x
    this.rendered.y = this.target.y
    this.rendered.z = this.target.z
    this.rendered.yaw = this.target.yaw
    this.state.position.set(this.rendered.x, this.rendered.y, this.rendered.z)
    this.state.velocity.set(0, 0, 0)
    this.headGroupPitch()
    this.sync()
  }

  _approach(dt) {
    const k = Math.min(1, dt * this.lerpRate)
    const px = this.rendered.x
    const pz = this.rendered.z
    this.rendered.x += (this.target.x - this.rendered.x) * k
    this.rendered.y += (this.target.y - this.rendered.y) * k
    this.rendered.z += (this.target.z - this.rendered.z) * k
    this.rendered.yaw += shortestAngle(this.rendered.yaw, this.target.yaw) * k
    // 速度取实际位移，否则走路动画会按快照里的速度摆，与画面上的移动对不上
    if (dt > 0) {
      this.state.velocity.set(
        (this.rendered.x - px) / dt,
        0,
        (this.rendered.z - pz) / dt
      )
      this.lastSpeed = Math.hypot(this.state.velocity.x, this.state.velocity.z)
    }
    this.state.position.set(this.rendered.x, this.rendered.y, this.rendered.z)
  }

  headGroupPitch() {
    if (!this.model) return
    this.model.headGroup.rotation.x = -Math.max(-1.2, Math.min(1.2, this.target.pitch))
  }

  sync() {
    if (!this.model) return
    this.model.group.position.set(this.state.position.x, this.state.position.y, this.state.position.z)
    this.model.group.rotation.y = this.rendered.yaw
  }

  update(dt) {
    if (!this.alive) {
      this.updateDeath(dt)
      return
    }
    this.state.stateTime += dt
    this._approach(dt)
    animateBeanRig(this.model, dt, this.state, this.lastSpeed, () => this.sync())
    this.headGroupPitch()
  }

  /**
   * 死亡表现照搬敌人那套（enemies.js:655-676）。
   * 这里单独写一遍而不是复用 Enemy.updateDeath，是因为那个方法读写的是 Enemy 的字段，
   * 抽出来要改动 enemies.js 更多地方，而这段逻辑只有 20 行且不会再变。
   */
  updateDeath(dt) {
    // 计时先走，模型后摆：无头模式下没有模型可摆，但死亡进度仍然要推进，
    // 否则「什么时候算死透」这件事就只存在于渲染层里了
    this.deathTimer = (this.deathTimer || 0) + dt
    if (!this.model) return
    const t = this.deathTimer
    const total = ENEMY_CONFIG.deathDuration
    const g = this.model.group
    if (t < 0.4) {
      const k = t / 0.4
      g.rotation.z = k * 1.15
      g.rotation.x = -k * 0.25
      g.position.y = this.state.position.y + Math.sin(k * Math.PI) * 0.12
    } else {
      const k = Math.min(1, (t - 0.4) / (total - 0.4))
      g.rotation.z = 1.15 + k * 0.35
      g.scale.setScalar(Math.max(0.02, 1 - k))
      g.position.y = this.state.position.y - k * 0.25
      if (k >= 1) g.visible = false
    }
  }

  setDead(on) {
    if (this.alive === !on) return this
    this.alive = !on
    if (on) {
      this.deathTimer = 0
      if (this.model) this.model.bubble.visible = false
    } else {
      this.deathTimer = 0
      if (this.model) {
        this.model.group.visible = true
        this.model.group.scale.setScalar(1)
        this.model.group.rotation.set(0, 0, 0)
        this.model.headGroup.rotation.set(0, 0, 0)
      }
      this.snap()
    }
    return this
  }

  /**
   * 从场景移除。
   * 刻意不 dispose 几何体与材质：createEnemyModel 里的 faceGeo 是模块级共享的，
   * 贴图也走 TEX 缓存，dispose 会连累场上其他角色。demo 里重开一局多留几个
   * 小组件无所谓，宁可泄漏也不要把别的角色搞花。
   */
  dispose() {
    if (this.scene && this.model) this.scene.remove(this.model.group)
    this.model = null
  }
}
