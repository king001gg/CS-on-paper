// 输入帧：边沿消费、状态清零，以及三种输入源共用同一个 sample() 接口
import test from 'node:test'
import assert from 'node:assert/strict'
import { createInputFrame, HumanInput, RemoteInput, ScriptedInput } from './input.js'

test('createInputFrame 每次返回独立对象，不会串状态', () => {
  const a = createInputFrame()
  const b = createInputFrame()
  a.seq = 9
  assert.equal(b.seq, 0)
  assert.notEqual(a, b)
})

test('移动轴方向正确：W 是 +1 前后，D 是 +1 左右', () => {
  const i = new HumanInput()
  i.setKey('KeyW', true)
  i.setKey('KeyD', true)
  const f = i.sample()
  assert.equal(f.forward, 1)
  assert.equal(f.right, 1)

  i.setKey('KeyW', false)
  i.setKey('KeyS', true)
  i.setKey('KeyD', false)
  i.setKey('KeyA', true)
  const g = i.sample()
  assert.equal(g.forward, -1)
  assert.equal(g.right, -1)
})

test('没按键时移动轴为零，而不是 NaN', () => {
  const f = new HumanInput().sample()
  assert.equal(f.forward, 0)
  assert.equal(f.right, 0)
  assert.equal(f.jump, false)
})

test('开火边沿只消费一次，但按住状态保持（连射靠 fireHeld）', () => {
  const i = new HumanInput()
  i.pressFire()
  const first = i.sample()
  assert.equal(first.firePressed, true, '刚按下这一帧要有边沿')
  assert.equal(first.fireHeld, true)

  const second = i.sample()
  assert.equal(second.firePressed, false, '边沿消费后不该重复触发单发武器')
  assert.equal(second.fireHeld, true, '仍按住，连射应继续')

  i.releaseFire()
  assert.equal(i.sample().fireHeld, false)
})

test('瞬间点按也能被捕获 —— 按下与抬起落在同一帧之间', () => {
  const i = new HumanInput()
  i.pressFire()
  i.releaseFire()   // 中间没有 sample
  const f = i.sample()
  assert.equal(f.firePressed, true, '点按的边沿必须活到下一次 sample')
  assert.equal(f.fireHeld, false, '但那一刻已经松开了')
})

test('瞄准：右键按住与兼容模式 T 切换是或的关系', () => {
  const i = new HumanInput()
  assert.equal(i.ads, false)
  i.setAds(true)
  assert.equal(i.sample().ads, true)
  i.setAds(false)
  assert.equal(i.sample().ads, false)
  i.toggleCompatAds()
  assert.equal(i.sample().ads, true, '兼容模式切换后应保持瞄准')
  i.toggleCompatAds()
  assert.equal(i.sample().ads, false)
})

test('clear 之后不再有任何按住状态（状态转换时必须彻底）', () => {
  const i = new HumanInput()
  i.setKey('KeyW', true)
  i.pressFire()
  i.setAds(true)
  i.toggleCompatAds()
  i.addLook(120, -40)
  i.clear()
  const f = i.sample()
  assert.equal(f.forward, 0)
  assert.equal(f.fireHeld, false)
  assert.equal(f.firePressed, false, 'clear 后残留的开火边沿会在解除暂停瞬间白打一枪')
  assert.equal(f.ads, false)
  assert.equal(f.lookDx, 0)
  assert.equal(f.lookDy, 0)
})

test('sample 序号递增，便于网络侧对账', () => {
  const i = new HumanInput()
  assert.equal(i.sample().seq, 1)
  assert.equal(i.sample().seq, 2)
})

test('观察增量累积后在 sample 时结算并清零', () => {
  const i = new HumanInput()
  i.addLook(10, -4)
  i.addLook(6, 2)
  const f = i.sample()
  assert.equal(f.lookDx, 16)
  assert.equal(f.lookDy, -2)
  assert.equal(i.sample().lookDx, 0, '增量不该跨帧累积成漂移')
})

test('yaw/pitch 是绝对字段：丢包只让状态偏旧，不会永久漂移', () => {
  const f = createInputFrame()
  assert.equal(f.yaw, 0)
  assert.equal(f.pitch, 0)
  f.yaw = 1.25
  f.pitch = -0.4
  const g = new RemoteInput()
  g.push(f)
  assert.equal(g.sample().yaw, 1.25)
  assert.equal(g.sample().pitch, -0.4, '没有新包时也要保持绝对朝向')
})

test('RemoteInput 没有新包时重复上一帧，而不是清零', () => {
  const r = new RemoteInput()
  const f = createInputFrame()
  f.forward = 1
  f.fireHeld = true
  r.push(f)
  for (let i = 0; i < 5; i++) {
    const s = r.sample()
    assert.equal(s.forward, 1, '丢包时清空会让远端角色一顿一顿地停住')
    assert.equal(s.fireHeld, true)
  }
  assert.equal(r.received, 1)
})

test('RemoteInput 的开火边沿只放行一次', () => {
  const r = new RemoteInput()
  const f = createInputFrame()
  f.firePressed = true
  f.fireHeld = true
  r.push(f)
  assert.equal(r.sample().firePressed, true)
  assert.equal(r.sample().firePressed, false, '否则一个包会被主机结算成连发')
  assert.equal(r.sample().fireHeld, true)
})

test('RemoteInput 产出的是副本，改它不会污染收到的原始帧', () => {
  const r = new RemoteInput()
  const f = createInputFrame()
  f.firePressed = true
  r.push(f)
  const s = r.sample()
  s.firePressed = false
  assert.equal(f.firePressed, true, '原始帧必须保持原样，便于回放与诊断')
})

test('ScriptedInput 按队列出帧，耗尽后保持最后一帧', () => {
  const a = createInputFrame()
  a.forward = 1
  const b = createInputFrame()
  b.forward = -1
  const s = new ScriptedInput([a, b])
  assert.equal(s.sample().forward, 1)
  assert.equal(s.sample().forward, -1)
  assert.equal(s.sample().forward, -1, '脚本放完后应停住而不是回到零')
})
