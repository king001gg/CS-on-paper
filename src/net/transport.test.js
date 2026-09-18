// 传输层：回环收发、丢包与延迟模拟、状态回调，以及「坏包不能打断任何人」
import test from 'node:test'
import assert from 'node:assert/strict'
import { Transport, TRANSPORT_STATE, CHANNEL, createLoopbackPair, createBroadcastTransport } from './transport.js'
import { msg, encode, MSG, PROTOCOL_VERSION } from './protocol.js'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

/** BroadcastChannel 的投递是异步的，等一小会儿；等不到就返回 0 让断言自己报错 */
async function settle(fn, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true
    await tick(10)
  }
  return fn()
}

const room = () => 'ps-test-' + Math.random().toString(36).slice(2)

test('回环：两端可以互相收发', () => {
  const [a, b] = createLoopbackPair()
  const got = []
  b.onMessage((m) => got.push(m))
  assert.equal(a.send(CHANNEL.RELIABLE, msg(MSG.PING, { q: 1 })), true)
  assert.equal(got.length, 1)
  assert.equal(got[0].t, MSG.PING)
  assert.equal(got[0].q, 1)

  const back = []
  a.onMessage((m) => back.push(m))
  b.send(CHANNEL.RELIABLE, msg(MSG.PONG, { q: 1 }))
  assert.equal(back.length, 1)
  assert.equal(back[0].t, MSG.PONG)
})

test('回环：零延迟是同步送达的，测试才好写', () => {
  const [a, b] = createLoopbackPair({ latencyMs: 0 })
  let n = 0
  b.onMessage(() => n++)
  a.send(CHANNEL.RELIABLE, msg(MSG.PING))
  assert.equal(n, 1, '不该需要 await')
})

test('回环：设了延迟就真的会晚到', async () => {
  const [a, b] = createLoopbackPair({ latencyMs: 40 })
  let n = 0
  b.onMessage(() => n++)
  a.send(CHANNEL.RELIABLE, msg(MSG.PING))
  assert.equal(n, 0, '40ms 延迟不该立刻到')
  await tick(90)
  assert.equal(n, 1)
})

test('丢包只作用于不可靠通道 —— 可靠通道丢包是自相矛盾的', async () => {
  const [a, b] = createLoopbackPair({ lossRate: 1 })
  let n = 0
  b.onMessage(() => n++)
  a.send(CHANNEL.UNRELIABLE, msg(MSG.SNAPSHOT))
  assert.equal(n, 0, 'lossRate=1 时不可靠通道必丢')
  assert.equal(a.stats.dropped, 1)
  a.send(CHANNEL.RELIABLE, msg(MSG.HIT))
  assert.equal(n, 1, '可靠通道必须照常送达，否则第 3 期的丢包测试会得出错误结论')
})

test('坏包与版本不符都只计数，不抛异常、不打断别人', () => {
  const [a, b] = createLoopbackPair()
  const got = []
  b.onMessage((m) => got.push(m))

  // 直接越过 send()，模拟对面发来一段垃圾
  b._receive('这不是 JSON')
  b._receive(JSON.stringify({ v: PROTOCOL_VERSION + 9, t: MSG.PING }))
  b._receive('')
  assert.equal(got.length, 0)
  assert.equal(b.stats.badPackets, 3)

  // 坏包之后仍然能正常收
  a.send(CHANNEL.RELIABLE, msg(MSG.PING))
  assert.equal(got.length, 1)
  assert.equal(b.state, TRANSPORT_STATE.OPEN, '坏包不该把状态搞坏')
})

test('版本不符会在状态详情里说清楚，用户才知道要刷新页面', () => {
  const [a, b] = createLoopbackPair()
  const seen = []
  b.onState((s, d) => seen.push(d))
  b._receive(JSON.stringify({ v: PROTOCOL_VERSION + 9, t: MSG.PING }))
  assert.ok(seen.some((d) => d.includes('v' + (PROTOCOL_VERSION + 9))), '详情里要有对方版本号：' + JSON.stringify(seen))
})

test('订阅状态时会立刻回放当前状态，省得调用方再查一遍初值', () => {
  const [a] = createLoopbackPair()
  let immediate = null
  a.onState((s) => { if (immediate === null) immediate = s })
  assert.equal(immediate, TRANSPORT_STATE.OPEN, '订阅回调应当在订阅当时就被调用一次')
})

test('onMessage / onState 返回的退订函数真的能退掉', () => {
  const [a, b] = createLoopbackPair()
  let n = 0
  const off = b.onMessage(() => n++)
  a.send(CHANNEL.RELIABLE, msg(MSG.PING))
  off()
  a.send(CHANNEL.RELIABLE, msg(MSG.PING))
  assert.equal(n, 1)

  // onState 订阅时会立刻回放一次当前状态，所以这里起点就是 1 而不是 0
  let s = 0
  const off2 = b.onState(() => s++)
  assert.equal(s, 1, '订阅当时应当先回放一次')
  off2()
  b._setState(TRANSPORT_STATE.FAILED, 'injected')
  assert.equal(s, 1, '退订之后不该再收到状态变化')
})

test('报文的处理回调抛了异常也不会殃及传输层', () => {
  const [a, b] = createLoopbackPair()
  let after = 0
  b.onMessage(() => { throw new Error('故意炸一个') })
  b.onMessage(() => after++)
  assert.doesNotThrow(() => a.send(CHANNEL.RELIABLE, msg(MSG.PING)))
  assert.equal(after, 1, '一个回调抛了，后面的回调仍要收到')
})

test('未连接时不发车，关闭后也不再收', () => {
  const raw = new Transport()
  assert.equal(raw.state, TRANSPORT_STATE.IDLE)
  assert.equal(raw.send(CHANNEL.RELIABLE, msg(MSG.PING)), false, 'IDLE 状态发不出去')

  const [a, b] = createLoopbackPair()
  let n = 0
  b.onMessage(() => n++)
  b.close('测试收工')
  assert.equal(b.state, TRANSPORT_STATE.CLOSED)
  a.send(CHANNEL.RELIABLE, msg(MSG.PING))
  assert.equal(n, 0, '关闭后不该再收')
  assert.equal(a.send(CHANNEL.RELIABLE, msg(MSG.PING)), true, '对端关闭不影响本端发送，只影响送达')
})

test('诊断信息里要有角色、状态与协议版本 —— 连不上时这是唯一能带出来的线索', () => {
  const [a] = createLoopbackPair()
  const d = a.diagnosis()
  assert.match(d, /房主/)
  assert.match(d, new RegExp('v' + PROTOCOL_VERSION))
  assert.match(d, /open/)
})

// ---------------------------------------------------------------------------
// 广播通道：node 里两个实例也能互投（BroadcastChannel 是 node 18+ 的内置全局）
// ---------------------------------------------------------------------------

test('广播：两端能互相收发', async () => {
  const r = room()
  const a = createBroadcastTransport({ roomId: r, isHost: true })
  const b = createBroadcastTransport({ roomId: r, isHost: false })
  const got = []
  b.onMessage((m) => got.push(m))
  assert.equal(a.state, TRANSPORT_STATE.OPEN, '广播是「一开频道就算连上」')
  a.send(CHANNEL.RELIABLE, msg(MSG.PING, { q: 1 }))
  await settle(() => got.length > 0)
  assert.equal(got.length, 1)
  assert.equal(got[0].q, 1)
  a.close(); b.close()
})

/**
 * 这条是回归测试，钉一个真实踩过的坑：
 * 收端曾经拿 `to` 去比 `selfId`，而 `to` 里装的是角色名（host/guest）。
 * 于是一旦调用方传了自定义 selfId，两端永远对不上，消息被**静默丢弃** ——
 * 状态照样是 open，只是什么都收不到，看起来像「连上了但没反应」。
 * 传自定义 id 是 API 明确支持的用法，所以这个组合必须有测试守着。
 */
test('广播：传了自定义 selfId 也照样收得到（曾经这里静默丢包）', async () => {
  const r = room()
  const a = createBroadcastTransport({ roomId: r, isHost: true, selfId: 'AAA' })
  const b = createBroadcastTransport({ roomId: r, isHost: false, selfId: 'BBB' })
  const got = []
  b.onMessage((m) => got.push(m))

  a.send(CHANNEL.RELIABLE, msg(MSG.PING, { q: 7 }))
  await settle(() => got.length > 0)
  assert.equal(got.length, 1, '自定义 selfId 不该影响投递')

  const back = []
  a.onMessage((m) => back.push(m))
  b.send(CHANNEL.RELIABLE, msg(MSG.PONG, { q: 7 }))
  await settle(() => back.length > 0)
  assert.equal(back.length, 1, '反向也要通')

  a.close(); b.close()
})

test('广播：不同房间互不串味', async () => {
  const a = createBroadcastTransport({ roomId: room(), isHost: true })
  const b = createBroadcastTransport({ roomId: room(), isHost: false })
  const got = []
  b.onMessage((m) => got.push(m))
  a.send(CHANNEL.RELIABLE, msg(MSG.PING))
  await tick(80)
  assert.equal(got.length, 0, '房间号不同就不该收到')
  a.close(); b.close()
})

test('广播：自己发的话不会被自己收到', async () => {
  const r = room()
  const a = createBroadcastTransport({ roomId: r, isHost: true })
  const mine = []
  a.onMessage((m) => mine.push(m))
  a.send(CHANNEL.RELIABLE, msg(MSG.PING))
  await tick(80)
  assert.equal(mine.length, 0, 'BroadcastChannel 本来就不回投发送者，别把这个性质弄丢')
  a.close()
})
