// 报文格式：往返、版本门槛，以及「对手发来的任何东西都不能让主机抛异常」
import test from 'node:test'
import assert from 'node:assert/strict'
import { PROTOCOL_VERSION, MSG, MAX_MESSAGE_BYTES, msg, encode, decode, readVersion } from './protocol.js'

test('往返：编码后能原样解回来', () => {
  const m = msg(MSG.INPUT, { q: 7, mx: 1, mz: -1, a: true })
  const back = decode(encode(m))
  assert.equal(back.t, MSG.INPUT)
  assert.equal(back.v, PROTOCOL_VERSION)
  assert.equal(back.q, 7)
  assert.equal(back.mx, 1)
  assert.equal(back.a, true)
})

test('msg 不带 payload 时只有版本与类型两个键', () => {
  assert.deepEqual(msg(MSG.PING), { v: PROTOCOL_VERSION, t: MSG.PING })
})

/**
 * 这一组是重点：decode 是唯一接触对手字节的入口，
 * 它只要抛一次，对面一个畸形包就能打断主机的渲染循环。
 */
test('decode 对畸形输入一律返回 null，绝不抛', () => {
  const bad = [
    undefined, null, 0, 1, true, {}, [], Symbol('x'), () => {},
    '', 'null', 'undefined', '[]', '"hello"', '42', '{', '{"v":', 'not json at all'
  ]
  for (const v of bad) {
    assert.doesNotThrow(() => decode(v), '输入 ' + String(v) + ' 不该抛')
    assert.equal(decode(v), null, '输入 ' + String(v) + ' 该返回 null')
  }
})

test('版本不符会被拒，且能用 readVersion 解释原因', () => {
  const future = JSON.stringify({ v: PROTOCOL_VERSION + 1, t: MSG.PING })
  assert.equal(decode(future), null, '未来版本必须拒收')
  assert.equal(readVersion(future), PROTOCOL_VERSION + 1, '但要说得出对方是几版')
  // 老版本同样拒收：第 2 期还没有需要兼容的历史，宁可直接说不兼容
  assert.equal(decode(JSON.stringify({ v: 0, t: MSG.PING })), null)
})

test('类型不在白名单里会被拒', () => {
  assert.equal(decode(JSON.stringify({ v: PROTOCOL_VERSION, t: 'rm -rf' })), null)
  assert.equal(decode(JSON.stringify({ v: PROTOCOL_VERSION })), null, '缺 t')
  assert.equal(decode(JSON.stringify({ v: PROTOCOL_VERSION, t: 7 })), null, 't 不是字符串')
})

test('超长报文在读之前就被拒', () => {
  const huge = JSON.stringify({ v: PROTOCOL_VERSION, t: MSG.PING, pad: 'x'.repeat(MAX_MESSAGE_BYTES) })
  assert.ok(huge.length > MAX_MESSAGE_BYTES)
  assert.equal(decode(huge), null)
  assert.equal(readVersion(huge), null, 'readVersion 同样要有长度门槛，否则它也成了放大器')
})

test('协议版本本身是 1，改动它必须是有意识的', () => {
  assert.equal(PROTOCOL_VERSION, 1)
})
