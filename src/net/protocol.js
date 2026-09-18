// 纸上交锋 · PAPER STRIKE —— 网络报文格式
//
// 这一层刻意做得极薄：只有「长度 + JSON + 版本号 + 类型白名单」。
// 真正的规矩在下面两条，后面每一层都要照着来：
//
// 1. **decode 永远不抛异常。** 对手发来的一切都当不可信输入 —— 一个畸形包
//    如果抛出去，会打断主机的渲染循环，等于对方一个字节就能让你卡住。
//    失败一律返回 null，让调用方自己决定是丢弃还是断开。
// 2. **版本校验在最外层。** 两端版本不一致时必须能说出人话
//    （「对方版本不同，请双方都刷新页面」），而不是让用户看着连接不上发呆。
//    所以 readVersion 单独导出：decode 返回 null 时还能问出「为什么 null」。

export const PROTOCOL_VERSION = 1

/** 报文类型。INPUT/SNAPSHOT/SHOT/HIT/ROUND 留给第 3 期，现在只有握手与心跳在用 */
export const MSG = {
  HELLO: 'hello',
  PING: 'ping',
  PONG: 'pong',
  INPUT: 'input',
  SNAPSHOT: 'snapshot',
  SHOT: 'shot',
  HIT: 'hit',
  ROUND: 'round',
  BYE: 'bye'
}

const TYPES = new Set(Object.values(MSG))

/**
 * 单条报文的字节上限。
 * DataChannel 默认允许 256 KB，但那种尺寸的包对我们这种 demo 只可能是恶意或故障 ——
 * 与其 JSON.parse 一个几十兆的字符串把页面卡死，不如在门口就拒掉。
 * 第 3 期最大的包是快照（约 180 B），64 KB 有三个数量级的余量。
 */
export const MAX_MESSAGE_BYTES = 64 * 1024

/** 造一条报文。短键是为了省字节 —— 快照 20 Hz 发，一局下来不是小数目 */
export function msg(type, payload = null) {
  const m = { v: PROTOCOL_VERSION, t: type }
  if (payload) Object.assign(m, payload)
  return m
}

export function encode(obj) {
  return JSON.stringify(obj)
}

/** 从原始文本里读出协议版本。读不到或不是数字则返回 null。decode 失败时用它解释原因 */
export function readVersion(text) {
  if (typeof text !== 'string' || text.length > MAX_MESSAGE_BYTES) return null
  try {
    const o = JSON.parse(text)
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null
    return typeof o.v === 'number' && Number.isFinite(o.v) ? o.v : null
  } catch {
    return null
  }
}

/**
 * 解析一条报文。任何问题都返回 null，绝不抛：
 * 不是字符串 / 超长 / 不是 JSON / 不是对象 / 是数组 / 版本不符 / 类型不在白名单。
 *
 * 版本不符和畸形包在这里返回的是同一个 null —— 调用方要区分的话，
 * 先调 readVersion 看是不是版本问题。
 */
export function decode(text) {
  if (typeof text !== 'string') return null
  // 长度判断放在 JSON.parse 之前：先看代价，再看内容
  if (text.length > MAX_MESSAGE_BYTES) return null
  let o
  try {
    o = JSON.parse(text)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  if (o.v !== PROTOCOL_VERSION) return null
  if (typeof o.t !== 'string' || !TYPES.has(o.t)) return null
  return o
}
