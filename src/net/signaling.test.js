// 手动信令：编解码往返，以及「被聊天软件摧残过之后还能不能解回来」
//
// 这一组测试的价值不在覆盖率，在于把「用户会遇到的破坏方式」一条条钉下来。
// 每条容错测试都对应一种真实发生过的破坏，删掉任何一条都要有理由。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SIGNAL_PREFIX, SIGNAL_SUFFIX, SIGNAL_COLUMNS,
  encodeSignal, decodeSignal, normalizeSignalText, foldSignal,
  describeIceError
} from './signaling.js'

const SAMPLE = { t: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n', n: 1 }

/**
 * 一段合成的 SDP，尺寸与真实 DataChannel-only 的 offer 相当（700~1100 字符）。
 * ⚠️ 地址用 192.0.2.x（RFC 5737 的 TEST-NET-1，保留给文档用，不可能是真实主机）。
 * 绝不要拿真实抓包的 SDP 当夹具 —— 那里面带着你自己的局域网 IP，
 * 而 scripts/check-publish.mjs 会扫凭据，提交进去就是把内网地址写进仓库。
 */
function fakeSdp() {
  const lines = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 192.0.2.10',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0 1',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS'
  ]
  for (const [mid, port] of [[0, 9], [1, 9]]) {
    lines.push(
      'm=application ' + port + ' UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 192.0.2.10',
      'a=candidate:842163049 ' + (mid + 1) + ' udp 1677729535 192.0.2.10 ' + (51000 + mid) + ' typ host generation 0',
      'a=candidate:1510613869 ' + (mid + 1) + ' udp 1677729535 192.0.2.10 ' + (51000 + mid) + ' typ srflx raddr 192.0.2.10 rport ' + (51000 + mid) + ' generation 0',
      'a=ice-ufrag:4ZcD',
      'a=ice-pwd:2/1muCWoOi3uLifh0NuRHlMi',
      'a=ice-options:trickle',
      'a=fingerprint:sha-256 3B:1E:2C:9F:5A:77:0D:41:8E:6B:22:C4:19:AA:73:50:1F:8D:64:BB:07:E3:92:1C:5F:48:A0:36:D1:74:89:2E',
      'a=setup:actpass',
      'a=mid:' + mid,
      'a=sctp-port:5000',
      'a=max-message-size:262144'
    )
  }
  return lines.join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------

test('往返：编码后能原样解回来', async () => {
  const code = await encodeSignal(SAMPLE)
  const back = await decodeSignal(code)
  assert.deepEqual(back, SAMPLE)
})

test('邀请码只含 base64url 字母表与换行，且带前后缀', async () => {
  const code = await encodeSignal(SAMPLE)
  assert.ok(code.startsWith(SIGNAL_PREFIX), '要以 PS1- 开头，用户才看得出这是啥')
  assert.ok(code.trimEnd().endsWith(SIGNAL_SUFFIX), '要以 -END 结尾，用户才看得出没复制全')
  const body = code.slice(SIGNAL_PREFIX.length, code.lastIndexOf(SIGNAL_SUFFIX))
  // + / = 会被聊天软件、URL 处理、JSON 转义搞坏，一个都不能出现
  assert.equal(/[^A-Za-z0-9_\-]/.test(body.replace(/\n/g, '')), false, '出现了非 base64url 字符：' + body)
})

test('折行：每行不超过约定列宽，且没有行尾空行', async () => {
  const code = await encodeSignal(SAMPLE)
  const lines = code.split('\n')
  for (const l of lines) assert.ok(l.length <= SIGNAL_COLUMNS, '有超宽行：' + l.length)
  assert.notEqual(code.at(-1), '\n', '结尾不该多一个换行 —— 用户复制时会连带选中')
})

test('foldSignal 按列宽切分，超宽时会产生多行', () => {
  assert.equal(foldSignal('abcdef', 3), 'abc\ndef')
  assert.equal(foldSignal('abc', 3), 'abc', '刚好整除不该多出空行')
  assert.equal(foldSignal('abc', 0), 'abc', '列宽 0 视为不折行')
})

test('容错：折行、空格、全角、零宽字符都不影响解码', async () => {
  const code = await encodeSignal(SAMPLE)
  const oneLine = code.replace(/\n/g, '')
  const variants = {
    '折行还在': code,
    '折行被去掉': oneLine,
    '折行处插了空格': code.replace(/\n/g, ' '),
    '折行处插了全角空格': code.replace(/\n/g, '　'),
    '整段变成全角': oneLine.replace(/[A-Za-z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)),
    '全角下划线': oneLine.replace(/_/g, '＿'),
    '带零宽字符': oneLine.slice(0, 20) + '​' + oneLine.slice(20) + '﻿',
    '被加了引号': '"' + code + '"'
  }
  for (const [name, text] of Object.entries(variants)) {
    const back = await decodeSignal(text)
    assert.deepEqual(back, SAMPLE, '这一种没解回来：' + name)
  }
})

test('容错：-- 被聊天软件替换成 — （这是最常见的一种破坏）', async () => {
  const code = await encodeSignal(SAMPLE)
  // 微信/QQ 的智能标点会把连续的 - 变成 em dash，而 base64url 字母表里只有 -
  const mangled = code.replace(/-/g, '—')
  assert.deepEqual(await decodeSignal(mangled), SAMPLE)
  // 顺带把其它几种长得像减号的字符也验一遍
  for (const dash of ['‐', '‑', '–', '―', '−', '﹣', '－']) {
    assert.deepEqual(await decodeSignal(code.replace(/-/g, dash)), SAMPLE, '这种减号没认出来：' + dash)
  }
})

test('容错：前后夹带了聊天记录里的话', async () => {
  const code = await encodeSignal(SAMPLE)
  const wrapped = [
    '好的我发给你',
    '这是邀请码：',
    code,
    '你那边弄好了告诉我一声',
    '收到'
  ].join('\n')
  assert.deepEqual(await decodeSignal(wrapped), SAMPLE)
})

/**
 * 回归测试，钉一个真实踩过的坑：
 * -END 正好跨在 64 列折行处，而聊天软件又在折行处插了「> 」引用符号，
 * 于是后缀变成「-」+「> 」+「END」，先找后缀后剔字符的实现永远匹配不上。
 * 表现为「对方发来的码用不了」，而且同一段码有时能解有时不能 —— 极难查。
 * 这里的做法是**穷举每一个折行位置**，而不是碰运气试一个，否则漏掉哪一列就白测了。
 */
test('容错：后缀被聊天软件从中间劈开也解得出来', async () => {
  const code = await encodeSignal(SAMPLE)
  const at = code.lastIndexOf(SIGNAL_SUFFIX)
  assert.ok(at > 0)

  // 在结尾后缀的每一个字符间隙里都塞一次「> 」，逐个验证
  for (let i = 1; i < SIGNAL_SUFFIX.length; i++) {
    const cut = code.slice(0, at + i) + '\n> ' + code.slice(at + i)
    assert.deepEqual(await decodeSignal(cut), SAMPLE, '在 -END 的第 ' + i + ' 个字符后插入引用符号就解不出来了')
  }
  // 整体套一层引用（相当于在微信里回复一条消息）也应当能解
  assert.deepEqual(await decodeSignal(code.split('\n').join('\n> ')), SAMPLE, '整段都被引用符号前缀时解不出来')
})

test('容错：后缀被吃掉时仍靠退路解出来', async () => {
  const code = await encodeSignal(SAMPLE)
  // 用户手一抖只复制到一半，或者客户端把 -END 当标点吞了
  const noSuffix = code.replace(SIGNAL_SUFFIX, '')
  assert.deepEqual(await decodeSignal(noSuffix), SAMPLE, '没有 -END 也该能解 —— 这是退路存在的理由')
})

test('截断的邀请码返回 null，不抛 —— 用户复制一半是最常见的事故', async () => {
  const code = await encodeSignal(SAMPLE)
  const oneLine = code.replace(/\n/g, '')
  for (const frac of [0.2, 0.5, 0.8, 0.95]) {
    const cut = oneLine.slice(0, Math.floor(oneLine.length * frac))
    assert.equal(await decodeSignal(cut), null, '截到 ' + frac + ' 应当老实返回 null')
  }
})

test('没有前缀的文本一律返回 null', async () => {
  for (const t of ['', '随便一段话', 'https://example.com', 'PS2-abc-END', 'ps1']) {
    assert.equal(await decodeSignal(t), null, JSON.stringify(t) + ' 不该被当成邀请码')
  }
})

test('decodeSignal 对任何输入都不抛异常', async () => {
  const weird = [
    undefined, null, 0, 1, true, false, {}, [], () => {}, Symbol('x'),
    'PS1-', 'PS1--END', 'PS1-!!!!-END', 'PS1-' + 'A'.repeat(1000) + '-END',
    'PS1-====-END', 'PS1-_-_-END'
  ]
  for (const v of weird) {
    await assert.doesNotReject(decodeSignal(v), '输入 ' + String(v) + ' 抛了异常')
  }
  // 超长输入必须在解压之前就被拒，否则它本身就是个放大器
  assert.equal(await decodeSignal('PS1-' + 'A'.repeat(300000)), null)
})

test('压缩是有效的：真实尺寸的 SDP 编完更短，一条消息发得下', async () => {
  const sdp = fakeSdp()
  assert.ok(sdp.length > 700, '夹具要够大才有参考价值，实际 ' + sdp.length)
  const code = await encodeSignal({ t: 'offer', sdp })
  const lines = code.split('\n')
  assert.ok(code.length < sdp.length, '压完反而更长了：' + code.length + ' vs ' + sdp.length)
  assert.ok(lines.length <= 16, '折行数 ' + lines.length + ' 太多，一条消息发不下')
  assert.deepEqual((await decodeSignal(code)).sdp, sdp, '大载荷也要能原样回来')
})

test('normalizeSignalText 的具体变换', () => {
  assert.equal(normalizeSignalText('PS1-ABC_def-END'), 'PS1-ABC_def-END', '干净的输入不该被改动')
  assert.equal(normalizeSignalText('  PS1-\n ABC \t'), 'PS1-ABC')
  assert.equal(normalizeSignalText('ＰＳ１'), 'PS1')
  assert.equal(normalizeSignalText('１２３'), '123')
  assert.equal(normalizeSignalText('a—b'), 'a-b')
  assert.equal(normalizeSignalText('a​b'), 'ab')
})

// ---------------------------------------------------------------------------

test('describeIceError 按候选类型给出不同的人话建议', () => {
  const none = describeIceError('failed', [])
  const hostOnly = describeIceError('failed', [{ type: 'host' }, { type: 'host' }])
  const withSrflx = describeIceError('failed', [{ type: 'host' }, { type: 'srflx' }])

  // 这三种情况的「下一步该干什么」完全不同，文案必须分得开
  assert.notEqual(none, hostOnly)
  assert.notEqual(hostOnly, withSrflx)
  assert.match(hostOnly, /同一个 wifi|局域网/)
  assert.match(none, /局域网|防火墙/)

  for (const state of ['failed', 'disconnected', 'checking', 'closed', 'new', 'nothing-like-this']) {
    const msg = describeIceError(state, [])
    assert.equal(typeof msg, 'string')
    assert.ok(msg.length > 4, state + ' 的解释太短，等于没说')
  }
})

test('describeIceError 不认识的状态也要报出原始值，别把线索吞了', () => {
  assert.match(describeIceError('weird-state', []), /weird-state/)
})
