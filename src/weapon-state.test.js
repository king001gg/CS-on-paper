import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WEAPONS, createWeaponState, updateWeaponState, tryFire, startReload, switchWeapon,
  spreadFor, damageFor, scopeFov, adsFov, reloadProgress, isReloading, resetWeaponState
} from './weapon-state.js'

const hold = { pressed: false, held: true }
const press = { pressed: true, held: true }
const none = { pressed: false, held: false }

test('冲锋枪可以按住连射，射速约每 0.1 秒一发', () => {
  const s = createWeaponState()
  let shots = 0
  const dt = 1 / 60
  for (let i = 0; i < 60; i++) {
    updateWeaponState(s, dt)
    if (tryFire(s, hold).fired) shots++
  }
  assert.ok(shots >= 9 && shots <= 11, '一秒内约 10 发，实际 ' + shots)
  assert.equal(s.weapons.smg.ammo, 30 - shots)
})

test('狙击枪逐次按下，且有 1.2 秒间隔', () => {
  const s = createWeaponState('sniper')
  assert.equal(tryFire(s, hold).fired, false, '按住不应该连发')
  assert.equal(tryFire(s, press).fired, true)
  assert.equal(tryFire(s, none).fired, false)
  // 间隔内再次按下无效
  for (let i = 0; i < 30; i++) { updateWeaponState(s, 1 / 60); if (tryFire(s, press).fired) assert.fail('间隔内不应射出') }
  for (let i = 0; i < 60; i++) updateWeaponState(s, 1 / 60)
  assert.equal(tryFire(s, press).fired, true, '超过 1.2 秒后可以再次射击')
})

test('弹匣有限、备弹无限，打空自动换弹', () => {
  const s = createWeaponState()
  for (let i = 0; i < 30; i++) {
    updateWeaponState(s, 0.11)
    assert.equal(tryFire(s, hold).fired, true)
  }
  assert.equal(s.weapons.smg.ammo, 0)
  assert.equal(isReloading(s, 'smg'), true, '打空后应自动换弹')
  assert.equal(tryFire(s, hold).fired, false, '换弹期间不能射击')
  for (let i = 0; i < 100; i++) updateWeaponState(s, 1 / 60)
  assert.equal(s.weapons.smg.ammo, WEAPONS.smg.magSize, '换弹完成后补满且备弹无限')
})

test('手动换弹：满弹匣无效、重复按 R 不重置进度也不重复补弹', () => {
  const s = createWeaponState()
  assert.equal(startReload(s, 'smg'), false, '满弹匣不需要换弹')
  tryFire(s, press)
  assert.equal(startReload(s, 'smg'), true)
  const before = s.weapons.smg.reloadRemaining
  updateWeaponState(s, 0.5)
  const mid = s.weapons.smg.reloadRemaining
  assert.ok(mid < before)
  assert.equal(startReload(s, 'smg'), false, '重复按 R 不重置进度')
  assert.equal(s.weapons.smg.reloadRemaining, mid)
  assert.ok(reloadProgress(s, 'smg') > 0.3 && reloadProgress(s, 'smg') < 0.4)
  for (let i = 0; i < 90; i++) updateWeaponState(s, 1 / 60)
  assert.equal(s.weapons.smg.ammo, WEAPONS.smg.magSize)
})

test('换弹期间不能射击，且不会出现负弹药', () => {
  const s = createWeaponState()
  for (let i = 0; i < 8; i++) { updateWeaponState(s, 0.2); tryFire(s, hold) }
  startReload(s, 'smg')
  for (let i = 0; i < 10; i++) { updateWeaponState(s, 0.02); assert.equal(tryFire(s, hold).fired, false) }
  assert.ok(s.weapons.smg.ammo >= 0)
})

test('切枪取消换弹并保留原弹量，两把枪弹药与冷却独立', () => {
  const s = createWeaponState()
  tryFire(s, press)
  updateWeaponState(s, 0.2)
  tryFire(s, press)
  assert.equal(s.weapons.smg.ammo, 28)
  startReload(s, 'smg')
  updateWeaponState(s, 0.4)
  assert.equal(switchWeapon(s, 'sniper'), true)
  assert.equal(isReloading(s, 'smg'), false, '切枪应取消换弹')
  assert.equal(s.weapons.smg.ammo, 28, '取消换弹不补弹')
  assert.equal(s.weapons.sniper.ammo, 5)
  for (let i = 0; i < 40; i++) updateWeaponState(s, 1 / 60)
  assert.equal(tryFire(s, press).fired, true)
  assert.equal(s.weapons.sniper.ammo, 4)
  assert.equal(s.weapons.smg.ammo, 28, '另一把枪的弹量不受影响')
})

test('切枪不能绕过狙击枪射击间隔', () => {
  const s = createWeaponState('sniper')
  assert.equal(tryFire(s, press).fired, true)
  for (let i = 0; i < 30; i++) updateWeaponState(s, 1 / 60)
  switchWeapon(s, 'smg')
  for (let i = 0; i < 30; i++) { updateWeaponState(s, 1 / 60); tryFire(s, hold) }
  switchWeapon(s, 'sniper')
  assert.equal(s.switchTimer > 0, true, '切枪动画期间不能射击')
  assert.equal(tryFire(s, press).fired, false)
  for (let i = 0; i < 20; i++) updateWeaponState(s, 1 / 60)
  assert.equal(tryFire(s, press).fired, false, '间隔未过，仍然射不出')
  for (let i = 0; i < 90; i++) updateWeaponState(s, 1 / 60)
  assert.equal(tryFire(s, press).fired, true)
})

test('暂停不推进冷却与换弹（调用方在暂停时不 update）', () => {
  const s = createWeaponState()
  tryFire(s, press)
  startReload(s, 'smg')
  const snapshot = JSON.stringify(s)
  assert.equal(JSON.stringify(s), snapshot, '不调用 update 时状态完全不变')
})

test('散布与伤害数值符合规格', () => {
  const s = createWeaponState()
  assert.equal(spreadFor(s, { ads: false, moving: false }), 0.022)
  assert.ok(Math.abs(spreadFor(s, { ads: false, moving: true }) - 0.022 * 1.35) < 1e-9)
  assert.equal(spreadFor(s, { ads: true, moving: false }), 0.006)
  const sniper = createWeaponState('sniper')
  assert.equal(spreadFor(sniper, { ads: true, moving: false }), 0.00035)
  assert.equal(damageFor('smg', 'body'), 20)
  assert.equal(damageFor('smg', 'head'), 40)
  assert.equal(damageFor('sniper', 'body'), 100)
  assert.equal(damageFor('sniper', 'head'), 200)
})

test('4 倍镜按投影放大公式计算', () => {
  const fov = scopeFov(75, 4)
  assert.ok(fov > 20 && fov < 23, '实际 ' + fov)
  const expected = (2 * Math.atan(Math.tan((75 * Math.PI) / 180 / 2) / 4) * 180) / Math.PI
  assert.ok(Math.abs(fov - expected) < 1e-9)
  assert.ok(adsFov(createWeaponState('sniper'), 75) < 23)
  assert.ok(adsFov(createWeaponState('smg'), 75) > 60, '冲锋枪只是轻微放大')
})

test('重开恢复两个满弹匣', () => {
  const s = createWeaponState()
  tryFire(s, press)
  startReload(s, 'smg')
  resetWeaponState(s, 'smg')
  assert.equal(s.weapons.smg.ammo, 30)
  assert.equal(s.weapons.sniper.ammo, 5)
  assert.equal(isReloading(s, 'smg'), false)
  assert.equal(s.current, 'smg')
})
