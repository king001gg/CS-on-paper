// 纸上交锋 · PAPER STRIKE
// 手绘草图风格的 Canvas 2D 基础工具：固定随机种子 + 粗糙线条 / 涂色 / 排线。
// 所有抖动都来自固定种子，保证同一张贴图每次运行都完全一致（不会逐帧闪动）。

export const PALETTE = {
  ink: '#293331',
  cream: '#F3E5C4',
  sand: '#DBCAA6',
  orange: '#CF7352',
  teal: '#659A99',
  blue: '#91B6BC',
  yellow: '#F4BD55',
  dark: '#394B4B',
  warmWhite: '#FFF4D8',
  sky: '#B9D6DD',
  fog: '#C4DADD',
  uiAccent: '#E66B43',
  uiText: '#263D39',
  paper: '#F5F1E8',
  skin: '#F6D6A5',
  shirtOrange: '#D56A45',
  shirtBlue: '#659DAE',
  shirtYellow: '#F0BF55',
  hatTeal: '#73A29A',
  blush: '#E9A08A'
}

/** 固定种子随机数（mulberry32） */
export function makeRng(seed = 1) {
  let a = seed >>> 0
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function rand(rng, min, max) {
  return min + (max - min) * rng()
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length]
}

/** 带手抖的折线：把一条直线拆成若干段，每段端点做固定偏移 */
export function roughLine(ctx, x1, y1, x2, y2, o = {}) {
  const rng = o.rng || makeRng(7)
  const width = o.width ?? 2
  const color = o.color || PALETTE.ink
  const passes = o.passes ?? 2
  const jitter = o.jitter ?? 1.6
  const segments = o.segments ?? Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 22))
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  for (let p = 0; p < passes; p++) {
    ctx.lineWidth = width * (p === 0 ? 1 : rand(rng, 0.5, 0.8))
    ctx.globalAlpha = p === 0 ? 1 : rand(rng, 0.35, 0.7)
    ctx.beginPath()
    // 断笔：随机跳过一小段
    const gapAt = rng() < 0.35 ? Math.floor(rng() * segments) : -1
    for (let i = 0; i <= segments; i++) {
      if (i === gapAt) continue
      const t = i / segments
      const jx = i === 0 || i === segments ? 0 : rand(rng, -jitter, jitter)
      const jy = i === 0 || i === segments ? 0 : rand(rng, -jitter, jitter)
      const x = x1 + (x2 - x1) * t + jx
      const y = y1 + (y2 - y1) * t + jy
      if (i === 0 || i === gapAt + 1 || (gapAt === 0 && i === 1)) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

/** 封闭的歪斜多边形路径 */
export function roughPolyPath(ctx, pts, rng, jitter = 1.5) {
  ctx.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i]
    const jx = rand(rng, -jitter, jitter)
    const jy = rand(rng, -jitter, jitter)
    if (i === 0) ctx.moveTo(x + jx, y + jy)
    else ctx.lineTo(x + jx, y + jy)
  }
  ctx.closePath()
}

/** 手绘矩形：先歪斜填色，再描两遍边框 */
export function roughRect(ctx, x, y, w, h, o = {}) {
  const rng = o.rng || makeRng(11)
  const jitter = o.jitter ?? 1.6
  const inset = o.inset ?? 0
  const fill = o.fill
  const stroke = o.stroke === null ? null : o.stroke || PALETTE.ink
  const radius = o.radius ?? 0

  const pts = radius > 0
    ? roundRectPoints(x + inset, y + inset, w - inset * 2, h - inset * 2, radius, 3)
    : [
        [x + inset, y + inset],
        [x + w - inset, y + inset],
        [x + w - inset, y + h - inset],
        [x + inset, y + h - inset]
      ]

  ctx.save()
  if (fill) {
    ctx.fillStyle = fill
    roughPolyPath(ctx, pts, rng, jitter)
    ctx.fill()
    // 涂色不匀：补一笔更饱和的色块
    if (o.patchy !== false) {
      ctx.globalAlpha = rand(rng, 0.18, 0.34)
      ctx.beginPath()
      const cx = x + w * rand(rng, 0.25, 0.5)
      const cy = y + h * rand(rng, 0.25, 0.5)
      ctx.ellipse(cx, cy, w * rand(rng, 0.18, 0.34), h * rand(rng, 0.16, 0.3), rand(rng, -0.3, 0.3), 0, Math.PI * 2)
      ctx.fillStyle = o.patchColor || 'rgba(255,255,255,0.75)'
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineCap = 'round'
    for (let p = 0; p < (o.passes ?? 2); p++) {
      ctx.lineWidth = (o.width ?? 3) * (p === 0 ? 1 : rand(rng, 0.45, 0.7))
      ctx.globalAlpha = p === 0 ? 1 : rand(rng, 0.4, 0.75)
      roughPolyPath(ctx, pts, rng, jitter)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

function roundRectPoints(x, y, w, h, r, perCorner) {
  const pts = []
  const corners = [
    [x + r, y + r, Math.PI, Math.PI * 1.5],
    [x + w - r, y + r, Math.PI * 1.5, Math.PI * 2],
    [x + w - r, y + h - r, 0, Math.PI * 0.5],
    [x + r, y + h - r, Math.PI * 0.5, Math.PI]
  ]
  for (const [cx, cy, a0, a1] of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + ((a1 - a0) * i) / perCorner
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
  }
  return pts
}

/** 排线阴影：在指定矩形里画斜线，可用 clipPath 限制形状 */
export function hatch(ctx, x, y, w, h, o = {}) {
  const rng = o.rng || makeRng(23)
  const spacing = o.spacing ?? 7
  const angle = o.angle ?? -0.6
  const color = o.color || 'rgba(41,51,49,0.55)'
  ctx.save()
  if (o.clip) {
    ctx.beginPath()
    o.clip(ctx)
    ctx.clip()
  }
  ctx.strokeStyle = color
  ctx.lineWidth = o.width ?? 1.4
  ctx.lineCap = 'round'
  const diag = Math.hypot(w, h)
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const nx = -dy
  const ny = dx
  const steps = Math.ceil((diag * 1.2) / spacing)
  for (let i = -steps; i <= steps * 2; i++) {
    if (o.gaps !== false && rng() < 0.12) continue
    const ox = x + w / 2 + nx * i * spacing
    const oy = y + h / 2 + ny * i * spacing
    const len = diag * (o.len ?? 0.9) * rand(rng, 0.7, 1.05)
    ctx.globalAlpha = rand(rng, 0.5, 1)
    ctx.beginPath()
    ctx.moveTo(ox - dx * len * 0.5, oy - dy * len * 0.5)
    ctx.lineTo(ox + dx * len * 0.5, oy + dy * len * 0.5)
    ctx.stroke()
  }
  ctx.restore()
}

/** 纸张颗粒 / 铅笔杂点 */
export function paperGrain(ctx, w, h, o = {}) {
  const rng = o.rng || makeRng(31)
  const count = o.count ?? Math.round((w * h) / 420)
  ctx.save()
  for (let i = 0; i < count; i++) {
    const x = rng() * w
    const y = rng() * h
    const r = rand(rng, 0.5, o.max ?? 1.6)
    ctx.globalAlpha = rand(rng, 0.03, 0.13)
    ctx.fillStyle = rng() < 0.6 ? PALETTE.ink : '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // 少量纸纤维
  for (let i = 0; i < count / 22; i++) {
    const x = rng() * w
    const y = rng() * h
    ctx.globalAlpha = rand(rng, 0.04, 0.1)
    ctx.strokeStyle = PALETTE.ink
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + rand(rng, -16, 16), y + rand(rng, -5, 5))
    ctx.stroke()
  }
  ctx.restore()
}

/** 手写感文字（不外链字体，使用本机字体回退） */
export function handText(ctx, text, x, y, o = {}) {
  const rng = o.rng || makeRng(41)
  ctx.save()
  ctx.font = o.font || 'bold 34px "Comic Sans MS", "Microsoft YaHei", KaiTi, sans-serif'
  ctx.textAlign = o.align || 'center'
  ctx.textBaseline = o.baseline || 'middle'
  if (o.rotate) {
    ctx.translate(x, y)
    ctx.rotate(o.rotate)
    ctx.translate(-x, -y)
  }
  if (o.outline !== false) {
    ctx.lineWidth = o.outlineWidth ?? 6
    ctx.strokeStyle = o.outlineColor || PALETTE.ink
    ctx.lineJoin = 'round'
    ctx.strokeText(text, x + rand(rng, -0.7, 0.7), y + rand(rng, -0.7, 0.7))
  }
  ctx.fillStyle = o.color || PALETTE.warmWhite
  ctx.fillText(text, x, y)
  ctx.restore()
}

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}
