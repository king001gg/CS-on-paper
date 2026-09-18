// 纸上交锋 · PAPER STRIKE —— 手动信令：把 SDP 变成一段能活过聊天软件的字符串
//
// 这个文件全部的价值都在一件事上：**让字符串活着从一台电脑到另一台电脑**。
// 微信 / QQ / 钉钉会折行、加引号、把 -- 变成 —、把全角半角搞混、在前后夹带
// 「收到」「好的」之类的话。首次成功率按经验是 10~20%，所以容错必须做在前面。
//
// 三段设计对应三个具体的破坏方式：
//   1. base64url（不是 base64）—— + / = 会被 URL 处理、会被某些客户端吞掉
//   2. deflate-raw 压缩后再编码 —— SDP 约 700~1100 字符，压完 450~800，一条消息发得下
//   3. 前后缀 PS1- ... -END —— 用户肉眼能看出「我是不是只复制了一半」
//
// 本文件可在 node 里测试（CompressionStream / btoa / atob 在 node 18+ 都有）。
// 只有 copyText 碰 DOM，而且只在被调用时才碰。

export const SIGNAL_PREFIX = 'PS1-'
export const SIGNAL_SUFFIX = '-END'
export const SIGNAL_COLUMNS = 64

// ---------------------------------------------------------------------------
// base64url 与 deflate
// ---------------------------------------------------------------------------

function toBase64Url(bytes) {
  // 逐字节拼字符串，不用 String.fromCharCode(...bytes)：
  // 后者在几万字节时会爆栈，而 SDP 压完虽然只有几百字节，但别在入口留这种地雷
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const rem = b64.length % 4
  // 余 1 是非法 base64，补多少 = 都救不回来 —— 交给 atob 抛，外面接住就好
  const padded = rem === 0 ? b64 : b64 + '='.repeat(4 - rem)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function streamThrough(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const deflate = (bytes) => streamThrough(bytes, new CompressionStream('deflate-raw'))
const inflate = (bytes) => streamThrough(bytes, new DecompressionStream('deflate-raw'))

// ---------------------------------------------------------------------------
// 文本清洗
// ---------------------------------------------------------------------------

/**
 * 把一段「经过聊天软件摧残」的文本还原成纯 base64url。
 *
 * 这里每一条都对应一种真实发生过的破坏，不是想象出来的：
 * 全角字母数字（中文输入法在「全角」状态下会这么打）、
 * 各种长得像减号的字符（-- 被替换成 — 是最常见的一种）、
 * 全角空格与零宽字符（从某些编辑器复制会带上）、以及所有空白（折行）。
 */
export function normalizeSignalText(text) {
  return String(text)
    .replace(/[Ａ-Ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))  // Ａ-Ｚ
    .replace(/[ａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))  // ａ-ｚ
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))  // ０-９
    .replace(/＿/g, '_')                                    // ＿ 全角下划线
    .replace(/[‐-―−﹘﹣－]/g, '-')   // 各种长得像减号的字符
    // 零宽字符写成转义而不是字面量：它们在编辑器里完全看不见，
    // 一个「看起来是空的正则」没法维护，也没法在 code review 里核对
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, '')
}

/** 折行：聊天软件对超长单行的处理各不相同，主动折成固定列宽最稳 */
export function foldSignal(s, columns = SIGNAL_COLUMNS) {
  if (columns <= 0) return s
  const lines = []
  for (let i = 0; i < s.length; i += columns) lines.push(s.slice(i, i + columns))
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 编解码
// ---------------------------------------------------------------------------

/**
 * 把任意可 JSON 化的对象压成一段邀请码 / 应战码。
 * 返回带折行的多行字符串（约 8~13 行，一条微信消息发得下）。
 */
export async function encodeSignal(obj) {
  const json = JSON.stringify(obj)
  const packed = await deflate(new TextEncoder().encode(json))
  return foldSignal(SIGNAL_PREFIX + toBase64Url(packed) + SIGNAL_SUFFIX)
}

/** 从一段被摧残过的文本里抠出纯 base64url。抠不出返回 null */
function extractClean(text) {
  const s = normalizeSignalText(text)
  const at = s.toUpperCase().indexOf(SIGNAL_PREFIX)
  if (at < 0) return null
  // 前缀里有字母，所以大小写不敏感地找；主体是 base64，绝不能改大小写 ——
  // 只对前缀做不敏感匹配，中间的字符原样保留。
  // 只留 base64url 字母表：前面的引号、后面的「收到」、夹在中间的说明文字都会被丢掉
  return s.slice(at + SIGNAL_PREFIX.length).replace(/[^A-Za-z0-9_-]/g, '')
}

async function tryUnpack(body) {
  try {
    const json = new TextDecoder().decode(await inflate(fromBase64Url(body)))
    const o = JSON.parse(json)
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null
    return o
  } catch {
    return null
  }
}

/**
 * 解析邀请码 / 应战码。任何问题都返回 null，绝不抛 ——
 * 用户粘进来的东西什么都有可能，抛出去只会变成一个没人看得懂的报错。
 *
 * ⚠️ **剔字符必须发生在找后缀之前。** 曾经这里是先找 -END、再把剩下的剔干净，
 * 结果只要有任何非 base64url 的字符落在 -END 中间就解不出来。而这偏偏很容易发生：
 * 折行正好把 -END 劈成「-」和「END」两行，聊天软件又在折行处插了个「> 」引用符号，
 * 于是 `-` + `> ` + `END` 永远匹配不上 64 列折行的后缀。
 * 表现为「对方发来的应战码用不了」，而且**同一段码有时能解有时不能**，极难查。
 * 顺序反过来之后，-END 会先被拼回连续再被找到。
 *
 * 后缀里的 E/N/D 也在字母表内，理论上主体尾部可能凑出 -END。
 * 概率约 1/26 万，但不值当赌：去后缀解一次，失败就拿整段再解一次。
 */
export async function decodeSignal(text) {
  if (typeof text !== 'string' || text.length > 200000) return null
  const clean = extractClean(text)
  if (!clean) return null

  const end = clean.toUpperCase().lastIndexOf(SIGNAL_SUFFIX)
  const body = end >= 0 ? clean.slice(0, end) : clean
  const ok = await tryUnpack(body)
  if (ok) return ok
  // 退路：后缀被聊天软件吃掉，或主体尾部恰好凑出了 -END，整段当主体再试一次
  return body === clean ? null : tryUnpack(clean)
}

// ---------------------------------------------------------------------------
// 连接失败的人话解释
// ---------------------------------------------------------------------------

/**
 * 把 iceConnectionState 翻译成用户能据以行动的一句话。
 * 「连接失败」四个字没用 —— 用户需要知道是「不在同一个 wifi」还是「防火墙」。
 * candidates 传 RTCIceCandidate 数组（读 .type 与 .protocol 即可）。
 */
export function describeIceError(iceState, candidates = []) {
  const kinds = new Set()
  for (const c of candidates) if (c && c.type) kinds.add(c.type)
  const onlyHost = kinds.size > 0 && kinds.has('host') && !kinds.has('srflx') && !kinds.has('relay')

  switch (iceState) {
    case 'failed':
      if (kinds.size === 0) {
        return '一条网络候选都没收到。两台电脑多半不在同一个局域网，或者浏览器 / 防火墙拦住了本地网络访问。'
      }
      if (onlyHost) {
        return '只拿到了内网地址（host），对方连不上 —— 请确认两台电脑连的是同一个 wifi 或路由器。'
      }
      return '拿到了公网候选但仍然打不通，通常是防火墙或 NAT 太严格。可以试试把两台电脑接到同一个路由器上。'
    case 'disconnected':
      return '连接中断了。可能是网络切换、对方关了页面，或者电脑休眠了。'
    case 'checking':
      return '还在尝试直连……没有 STUN 服务器时只能靠内网直连，超过 10 秒基本可以判定失败。'
    case 'closed':
      return '连接已关闭。'
    case 'new':
      return '还没开始连接。请先交换邀请码与应战码。'
    default:
      return '连接失败（' + iceState + '）。共拿到 ' + kinds.size + ' 类网络候选。'
  }
}

// ---------------------------------------------------------------------------
// 复制到剪贴板（含局域网 http 下的回退）
// ---------------------------------------------------------------------------

/**
 * ⚠️ `navigator.clipboard` 只在**安全上下文**里存在。
 * `http://127.0.0.1` 算安全上下文，但 **`http://192.168.x.x` 不算** ——
 * 也就是用户选定的「局域网两台电脑」这条路上，navigator.clipboard 直接是 undefined。
 * 不做回退的话，「复制邀请码」按钮在唯一真正需要它的场景里是坏的。
 *
 * 回退走 textarea + document.execCommand('copy')，这条老路在非安全上下文里仍然有效。
 * 再不行就选中文本让用户自己按 Ctrl+C，并如实告诉他。
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return { ok: true, how: 'clipboard' }
    }
  } catch {
    // 掉到下面的回退，不往上抛
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    // 不能 display:none —— 那样选不中，execCommand 会失败
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (ok) return { ok: true, how: 'execCommand' }
  } catch {
    // 继续掉到最后一种
  }
  return { ok: false, how: 'manual', text }
}
