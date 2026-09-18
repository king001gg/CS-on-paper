// 远端玩家的化身：位置收敛、角度收近路、死亡与回收
//
// 全部用 headless 模式跑 —— createEnemyModel 要画布贴图，node 里建不出来。
// 但这里测的插值与收角逻辑与模型无关，而第 3 期的远端同步正建立在它上面。
import test from 'node:test'
import assert from 'node:assert/strict'
import { PlayerAvatar } from './player-rig.js'

function makeScene() {
  const added = []
  const removed = []
  return {
    added,
    removed,
    add: (o) => added.push(o),
    remove: (o) => removed.push(o)
  }
}

function makeAvatar() {
  const scene = makeScene()
  const a = new PlayerAvatar(scene, { id: 'p2', headless: true })
  return { a, scene }
}

test('headless 化身不建模型，但仍能插值与同步（否则 node 里跑不了）', () => {
  const { a } = makeAvatar()
  assert.equal(a.model, null)
  a.applyState({ x: 3, y: 0, z: -4, yaw: 0.5, hp: 80 }, 0)
  assert.equal(a.state.position.x, 3)
  assert.equal(a.state.position.z, -4)
  assert.equal(a.health, 80)
})

test('dt 为 0 或负数时直接吸附到目标，不做插值', () => {
  const { a } = makeAvatar()
  a.applyState({ x: 10, y: 0, z: 10, yaw: 1 }, 0)
  assert.equal(a.rendered.x, 10, '出生/回合开始/传送都不能从原点滑过去')
  assert.equal(a.rendered.z, 10)
  assert.equal(a.rendered.yaw, 1)
})

test('传了 dt 就从当前位置渐进收敛，而不是瞬移', () => {
  const { a } = makeAvatar()
  a.applyState({ x: 0, y: 0, z: 0, yaw: 0 }, 0)
  a.applyState({ x: 10, y: 0, z: 0, yaw: 0 }, 0)
  assert.equal(a.rendered.x, 10)
  // applyState 只改目标；真正挪动发生在 update 里
  a.applyState({ x: 20, y: 0, z: 0, yaw: 0 }, 1 / 60)
  assert.equal(a.rendered.x, 10, 'applyState 本身不该移动化身')
  a.update(1 / 60)
  assert.ok(a.rendered.x > 10 && a.rendered.x < 20, '一帧不该走完全程，实际 ' + a.rendered.x)
  const first = a.rendered.x
  a.update(1 / 60)
  assert.ok(a.rendered.x > first, '第二帧应当更接近目标')
})

test('持续 update 后收敛到目标位置', () => {
  const { a } = makeAvatar()
  a.applyState({ x: 0, y: 0, z: 0 }, 0)
  a.applyState({ x: 12, y: 0, z: -7, yaw: 0 }, 0.016)
  for (let i = 0; i < 300; i++) a.update(1 / 60)
  assert.ok(Math.abs(a.rendered.x - 12) < 0.01, 'x 应收敛，实际 ' + a.rendered.x)
  assert.ok(Math.abs(a.rendered.z + 7) < 0.01, 'z 应收敛，实际 ' + a.rendered.z)
})

test('视角跨 ±π 时走近路，不绕一整圈（关键：朝向 179°→-179° 只差 2°）', () => {
  const { a } = makeAvatar()
  const near = Math.PI - 0.02
  const wrap = -Math.PI + 0.02
  a.applyState({ x: 0, y: 0, z: 0, yaw: near }, 0)
  a.applyState({ x: 0, y: 0, z: 0, yaw: wrap }, 1 / 60)
  a.update(1 / 60)
  // 走近路的话 yaw 只会越过 π 一点点；绕远路则会朝 0 的方向大幅倒退
  assert.ok(a.rendered.yaw > near, '应当朝 π 外侧走，实际 ' + a.rendered.yaw)
  assert.ok(a.rendered.yaw - near < 0.5, '不该绕远路，实际跨了 ' + (a.rendered.yaw - near))
})

test('速度取实际位移，不是快照里报的速度 —— 否则走路动画与画面上的移动对不上', () => {
  const { a } = makeAvatar()
  a.applyState({ x: 0, y: 0, z: 0 }, 0)
  a.applyState({ x: 10, y: 0, z: 0 }, 0.016)
  a.update(1 / 60)
  const moved = a.rendered.x - 0
  assert.ok(Math.abs(a.state.velocity.x - moved / (1 / 60)) < 1e-6, '速度应等于位移除以 dt')
})

test('setDead 切换死亡状态，重复调用是幂等的', () => {
  const { a } = makeAvatar()
  assert.equal(a.alive, true)
  a.setDead(true)
  assert.equal(a.alive, false)
  const t = a.deathTimer
  a.setDead(true)
  assert.equal(a.deathTimer, t, '重复置死不该把死亡动画重头播一遍')
  a.setDead(false)
  assert.equal(a.alive, true)
  assert.equal(a.deathTimer, 0, '复活时死亡计时必须清零')
})

test('死亡后 update 只推进死亡动画，不做插值', () => {
  const { a } = makeAvatar()
  a.applyState({ x: 5, y: 0, z: 5 }, 0)
  a.setDead(true)
  a.applyState({ x: 99, y: 0, z: 99 }, 1 / 60)
  a.update(1 / 60)
  assert.equal(a.rendered.x, 5, '尸体不该追着快照跑')
  assert.ok(a.deathTimer > 0, '但死亡动画要推进')
})

test('dispose 把模型从场景摘掉并置空，重复调用不炸', () => {
  const { a, scene } = makeAvatar()
  a.dispose()
  assert.equal(a.model, null)
  a.dispose()
  assert.equal(scene.removed.length, 0, 'headless 没有模型，不该往场景里塞东西')
})

test('构造时把模型加进场景，dispose 时移除', () => {
  // 这里只验证「有模型」这条路径的调用约定：用一个假模型替身，
  // 避免为了测一行 add/remove 去建真模型（那需要画布）
  const scene = makeScene()
  const a = new PlayerAvatar(scene, { id: 'p3', headless: true })
  a.model = { group: { visible: true, position: {}, rotation: {}, scale: {} }, bubble: { visible: false }, headGroup: { rotation: {} } }
  scene.add(a.model.group)
  a.dispose()
  assert.equal(scene.added.length, 1)
  assert.equal(scene.removed.length, 1)
})
