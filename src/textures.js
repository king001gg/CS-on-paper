// 纸上交锋 · PAPER STRIKE —— Canvas 2D 手绘贴图库
// 全部贴图由代码绘制，不下载、不外链任何图片资源。
import * as THREE from 'three'
import { PALETTE, makeRng, rand, roughLine, roughRect, hatch, paperGrain, handText, makeCanvas } from './sketch.js'

const cache = new Map()

function canvasTexture(canvas, o = {}) {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  if (o.nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false }
  t.needsUpdate = true
  return t
}

function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build())
  return cache.get(key)
}

export function disposeTextureCache() {
  for (const t of cache.values()) if (t && t.dispose) t.dispose()
  cache.clear()
}

/** 2 阶色调分层用的渐变贴图（卡通明暗带：[115,178,230,255]） */
export function toonGradientMap() {
  return cached('toon', () => {
    const data = new Uint8Array([115, 178, 230, 255])
    const t = new THREE.DataTexture(data, 4, 1, THREE.RedFormat)
    t.minFilter = THREE.NearestFilter
    t.magFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.needsUpdate = true
    return t
  })
}

// ---------------------------------------------------------------------------
// 天空：手画太阳与云
// ---------------------------------------------------------------------------
export function skyTexture() {
  return cached('sky', () => {
    const w = 1024
    const h = 512
    const c = makeCanvas(w, h)
    const ctx = c.getContext('2d')
    const rng = makeRng(101)
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#9CC9D6')
    g.addColorStop(0.42, PALETTE.sky)
    g.addColorStop(0.62, '#CFE4E8')
    g.addColorStop(1, PALETTE.fog)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    // 太阳
    const sx = w * 0.74
    const sy = h * 0.22
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#FFE9A8'
    ctx.beginPath()
    ctx.arc(sx, sy, 92, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = PALETTE.yellow
    ctx.beginPath()
    ctx.arc(sx, sy, 58, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = PALETTE.ink
    ctx.lineWidth = 4
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.2
      const r0 = 66
      const r1 = 82 + rand(rng, -6, 10)
      ctx.beginPath()
      ctx.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0)
      ctx.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1)
      ctx.stroke()
    }
    roughLine(ctx, sx - 58, sy, sx + 58, sy, { rng, width: 3, color: PALETTE.ink, segments: 3, jitter: 2, passes: 1 })
    ctx.beginPath()
    ctx.arc(sx, sy, 58, 0, Math.PI * 2)
    ctx.lineWidth = 4
    ctx.strokeStyle = PALETTE.ink
    ctx.stroke()
    // 太阳表情（可爱）
    ctx.fillStyle = PALETTE.ink
    ctx.beginPath(); ctx.arc(sx - 18, sy - 8, 5, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(sx + 18, sy - 8, 5, 0, Math.PI * 2); ctx.fill()
    ctx.lineWidth = 3.5
    ctx.beginPath(); ctx.arc(sx, sy + 6, 16, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke()

    // 云
    const clouds = [[0.1, 0.3, 1.0], [0.35, 0.15, 0.75], [0.55, 0.36, 0.9], [0.88, 0.44, 0.8], [0.22, 0.52, 0.6]]
    for (const [cx, cy, s] of clouds) {
      const x = cx * w
      const y = cy * h
      const r = 46 * s
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.beginPath()
      for (let i = 0; i < 5; i++) {
        ctx.arc(x + (i - 2) * r * 0.72, y + Math.sin(i * 1.7) * r * 0.22, r * (0.5 + 0.22 * Math.cos(i * 2.1)), 0, Math.PI * 2)
      }
      ctx.fill()
      ctx.strokeStyle = 'rgba(41,51,49,0.55)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x - r * 1.75, y + r * 0.42)
      for (let i = 0; i <= 8; i++) {
        const t = i / 8
        ctx.lineTo(x - r * 1.75 + t * r * 3.5, y + r * 0.42 + Math.sin(t * Math.PI) * r * 0.5 * rand(rng, 0.85, 1.1))
      }
      ctx.stroke()
    }
    paperGrain(ctx, w, h, { rng, count: 1600, max: 1.3 })
    return canvasTexture(c)
  })
}

// ---------------------------------------------------------------------------
// 地面：沙色 + 手画石板缝 + 笔触
// ---------------------------------------------------------------------------
export function groundTexture() {
  return cached('ground', () => {
    const s = 512
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(202)
    ctx.fillStyle = PALETTE.sand
    ctx.fillRect(0, 0, s, s)
    // 不均匀的色块
    for (let i = 0; i < 26; i++) {
      ctx.globalAlpha = rand(rng, 0.05, 0.16)
      ctx.fillStyle = rng() < 0.5 ? '#EFE0BE' : '#C6B48F'
      ctx.beginPath()
      ctx.ellipse(rng() * s, rng() * s, rand(rng, 30, 110), rand(rng, 24, 80), rand(rng, 0, 3), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    // 石板缝：每 64px 一条（贴图重复后约每米一条）
    const grid = 64
    for (let i = 0; i <= s / grid; i++) {
      roughLine(ctx, i * grid, 0, i * grid, s, { rng, width: 2, color: 'rgba(41,51,49,0.30)', segments: 8, jitter: 2.2, passes: 1 })
      roughLine(ctx, 0, i * grid, s, i * grid, { rng, width: 2, color: 'rgba(41,51,49,0.30)', segments: 8, jitter: 2.2, passes: 1 })
    }
    // 裂纹与碎石
    for (let i = 0; i < 16; i++) {
      let x = rng() * s
      let y = rng() * s
      ctx.strokeStyle = 'rgba(41,51,49,0.28)'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let k = 0; k < 5; k++) {
        x += rand(rng, -26, 26)
        y += rand(rng, -26, 26)
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    for (let i = 0; i < 120; i++) {
      ctx.globalAlpha = rand(rng, 0.12, 0.35)
      ctx.fillStyle = rng() < 0.6 ? '#BFAE8B' : '#F1E4C6'
      ctx.beginPath()
      ctx.ellipse(rng() * s, rng() * s, rand(rng, 1.5, 5), rand(rng, 1.2, 4), rand(rng, 0, 3), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    paperGrain(ctx, s, s, { rng, count: 900, max: 1.5 })
    return canvasTexture(c)
  })
}

/** 建筑外墙贴图（奶油 / 橘红 / 青绿） */
export function wallTexture(kind = 'cream') {
  return cached('wall-' + kind, () => {
    const s = 256
    const base = kind === 'orange' ? PALETTE.orange : kind === 'teal' ? PALETTE.teal : PALETTE.cream
    const light = kind === 'orange' ? '#E08A66' : kind === 'teal' ? '#7FB0AE' : '#FBF0D6'
    const dark = kind === 'orange' ? '#B85F41' : kind === 'teal' ? '#4F7F7E' : '#DFCDA6'
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(kind === 'orange' ? 303 : kind === 'teal' ? 404 : 505)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 20; i++) {
      ctx.globalAlpha = rand(rng, 0.07, 0.2)
      ctx.fillStyle = rng() < 0.5 ? light : dark
      ctx.beginPath()
      ctx.ellipse(rng() * s, rng() * s, rand(rng, 18, 62), rand(rng, 14, 46), rand(rng, 0, 3), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    // 抹灰接缝
    for (let i = 0; i < 3; i++) {
      const y = ((i + 1) / 4) * s + rand(rng, -8, 8)
      roughLine(ctx, 0, y, s, y + rand(rng, -3, 3), { rng, width: 1.6, color: 'rgba(41,51,49,0.25)', segments: 6, jitter: 1.6, passes: 1 })
    }
    // 边缘排线（贴图重复时形成每块板四周的草稿阴影）
    hatch(ctx, 0, s - 26, s, 26, { rng, spacing: 9, angle: -0.75, color: 'rgba(41,51,49,0.20)', len: 0.32 })
    hatch(ctx, 0, 0, 22, s, { rng, spacing: 11, angle: -0.2, color: 'rgba(41,51,49,0.14)', len: 0.22 })
    paperGrain(ctx, s, s, { rng, count: 420, max: 1.3 })
    return canvasTexture(c)
  })
}

/** 木箱：奶油木板 + 黄色胶带 + 叉线 + 手写标记 */
export function crateTexture() {
  return cached('crate', () => {
    const s = 256
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(606)
    ctx.fillStyle = PALETTE.cream
    ctx.fillRect(0, 0, s, s)
    // 木板
    for (let i = 0; i < 4; i++) {
      const y = (i * s) / 4
      ctx.globalAlpha = rand(rng, 0.1, 0.22)
      ctx.fillStyle = i % 2 ? '#E7D4AC' : '#FBF1D9'
      ctx.fillRect(0, y, s, s / 4)
      ctx.globalAlpha = 1
      roughLine(ctx, 0, y, s, y + rand(rng, -2, 2), { rng, width: 2, color: 'rgba(41,51,49,0.45)', segments: 5, jitter: 1.4, passes: 1 })
    }
    // 木纹
    for (let i = 0; i < 22; i++) {
      const y = rng() * s
      ctx.strokeStyle = 'rgba(120,96,58,0.25)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(0, y)
      for (let x = 0; x <= s; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 2.2)
      ctx.stroke()
    }
    // 叉线加固
    ctx.strokeStyle = 'rgba(41,51,49,0.42)'
    ctx.lineWidth = 3.4
    roughLine(ctx, 14, 14, s - 14, s - 14, { rng, width: 3.2, color: 'rgba(41,51,49,0.38)', segments: 4, jitter: 1.6, passes: 1 })
    roughLine(ctx, s - 14, 14, 14, s - 14, { rng, width: 3.2, color: 'rgba(41,51,49,0.38)', segments: 4, jitter: 1.6, passes: 1 })
    // 黄色胶带
    ctx.save()
    ctx.globalAlpha = 0.92
    ctx.fillStyle = PALETTE.yellow
    ctx.fillRect(0, s * 0.42, s, s * 0.16)
    ctx.restore()
    roughLine(ctx, 0, s * 0.42, s, s * 0.42 + 1, { rng, width: 2.5, segments: 6, jitter: 1.2, passes: 1 })
    roughLine(ctx, 0, s * 0.58, s, s * 0.58 - 1, { rng, width: 2.5, segments: 6, jitter: 1.2, passes: 1 })
    handText(ctx, 'SUPPLY', s * 0.5, s * 0.5, { rng, font: 'bold 26px "Comic Sans MS", sans-serif', outlineWidth: 0, color: PALETTE.ink })
    // 外框
    roughRect(ctx, 6, 6, s - 12, s - 12, { rng, fill: null, width: 2.6, jitter: 2.4, passes: 2 })
    paperGrain(ctx, s, s, { rng, count: 260, max: 1.2 })
    return canvasTexture(c)
  })
}

/** 油桶：青绿桶身 + 深色箍 + 涂鸦 */
export function barrelTexture() {
  return cached('barrel', () => {
    const w = 256
    const h = 128
    const c = makeCanvas(w, h)
    const ctx = c.getContext('2d')
    const rng = makeRng(707)
    ctx.fillStyle = PALETTE.teal
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 14; i++) {
      ctx.globalAlpha = rand(rng, 0.08, 0.2)
      ctx.fillStyle = rng() < 0.5 ? '#83B4B2' : '#4E7C7B'
      ctx.beginPath()
      ctx.ellipse(rng() * w, rng() * h, rand(rng, 12, 40), rand(rng, 8, 22), 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    for (const y of [h * 0.24, h * 0.72]) {
      ctx.fillStyle = PALETTE.dark
      ctx.globalAlpha = 0.85
      ctx.fillRect(0, y, w, h * 0.075)
      ctx.globalAlpha = 1
      roughLine(ctx, 0, y, w, y + rand(rng, -1, 1), { rng, width: 2, segments: 6, jitter: 1, passes: 1 })
      roughLine(ctx, 0, y + h * 0.075, w, y + h * 0.075, { rng, width: 2, segments: 6, jitter: 1, passes: 1 })
    }
    // 铆钉
    ctx.fillStyle = 'rgba(41,51,49,0.7)'
    for (let i = 0; i < 10; i++) {
      ctx.beginPath()
      ctx.arc((i / 10) * w + 8, h * 0.5, 2.6, 0, Math.PI * 2)
      ctx.fill()
    }
    handText(ctx, 'FUEL', w * 0.5, h * 0.5, { rng, font: 'bold 22px "Comic Sans MS", sans-serif', color: PALETTE.warmWhite, outlineWidth: 5 })
    return canvasTexture(c)
  })
}

/** 高台 / 台阶：水泥板 + 裂纹 */
export function concreteTexture() {
  return cached('concrete', () => {
    const s = 256
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(808)
    ctx.fillStyle = PALETTE.blue
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 22; i++) {
      ctx.globalAlpha = rand(rng, 0.08, 0.22)
      ctx.fillStyle = rng() < 0.5 ? '#A8C7CB' : '#7BA3A9'
      ctx.beginPath()
      ctx.ellipse(rng() * s, rng() * s, rand(rng, 16, 54), rand(rng, 12, 40), rand(rng, 0, 3), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    for (let i = 0; i < 10; i++) {
      let x = rng() * s
      let y = rng() * s
      ctx.strokeStyle = 'rgba(41,51,49,0.32)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let k = 0; k < 4; k++) {
        x += rand(rng, -30, 30)
        y += rand(rng, -30, 30)
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    roughRect(ctx, 5, 5, s - 10, s - 10, { rng, fill: null, width: 2.5, jitter: 2, passes: 1, stroke: 'rgba(41,51,49,0.35)' })
    paperGrain(ctx, s, s, { rng, count: 380, max: 1.3 })
    return canvasTexture(c)
  })
}

/** 黄黑警示条纹（高台边缘 / 台阶) */
export function hazardTexture() {
  return cached('hazard', () => {
    const s = 128
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(909)
    ctx.fillStyle = PALETTE.yellow
    ctx.fillRect(0, 0, s, s)
    ctx.save()
    ctx.fillStyle = PALETTE.dark
    for (let i = -2; i < 8; i++) {
      ctx.save()
      ctx.translate(i * 32, 0)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(14, 0)
      ctx.lineTo(14 - s, s)
      ctx.lineTo(-s, s)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()
    paperGrain(ctx, s, s, { rng, count: 120, max: 1.2 })
    return canvasTexture(c)
  })
}

// ---------------------------------------------------------------------------
// 装饰贴片：窗户、门、招牌、涂鸦
// ---------------------------------------------------------------------------
export function windowTexture(variant = 0) {
  return cached('window-' + variant, () => {
    const w = 128
    const h = 160
    const c = makeCanvas(w, h)
    const ctx = c.getContext('2d')
    const rng = makeRng(1000 + variant * 37)
    const frame = variant === 1 ? PALETTE.orange : PALETTE.teal
    // 玻璃
    roughRect(ctx, 12, 12, w - 24, h - 24, { rng, fill: '#7FA9B4', width: 4, jitter: 2.6, passes: 2 })
    ctx.save()
    ctx.globalAlpha = 0.55
    ctx.fillStyle = '#CFE6EA'
    ctx.beginPath()
    ctx.moveTo(20, h - 30)
    ctx.lineTo(66, 20)
    ctx.lineTo(92, 20)
    ctx.lineTo(30, h - 30)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    // 窗框
    ctx.save()
    ctx.strokeStyle = frame
    ctx.lineWidth = 8
    ctx.lineCap = 'round'
    roughLine(ctx, w / 2, 14, w / 2 + rand(rng, -3, 3), h - 14, { rng, width: 8, color: frame, segments: 3, jitter: 2, passes: 1 })
    roughLine(ctx, 14, h * 0.45, w - 14, h * 0.45, { rng, width: 8, color: frame, segments: 3, jitter: 2, passes: 1 })
    ctx.restore()
    roughRect(ctx, 12, 12, w - 24, h - 24, { rng, fill: null, width: 5, jitter: 2.4, passes: 2 })
    // 窗台
    roughRect(ctx, 4, h - 20, w - 8, 16, { rng, fill: PALETTE.cream, width: 3.5, jitter: 2, passes: 1 })
    // 遮阳棚
    if (variant !== 2) {
      ctx.save()
      ctx.fillStyle = variant === 1 ? PALETTE.yellow : PALETTE.orange
      ctx.beginPath()
      ctx.moveTo(0, 8)
      ctx.lineTo(w, 0)
      ctx.lineTo(w - 6, 26)
      ctx.lineTo(6, 34)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      roughLine(ctx, 0, 8, w, 0, { rng, width: 3, segments: 4, jitter: 1.6, passes: 1 })
    }
    return canvasTexture(c)
  })
}

/** 招牌 / 字牌：自动按文字宽度出图 */
export function signTexture(text, o = {}) {
  const key = 'sign-' + text + '-' + JSON.stringify(o)
  return cached(key, () => {
    const fontSize = o.fontSize || 44
    const pad = o.pad ?? 26
    const measure = makeCanvas(8, 8).getContext('2d')
    measure.font = 'bold ' + fontSize + 'px "Comic Sans MS", "Microsoft YaHei", KaiTi, sans-serif'
    const tw = Math.ceil(measure.measureText(text).width)
    const w = Math.min(2048, tw + pad * 2)
    const h = fontSize + pad * 2
    const c = makeCanvas(w, h)
    const ctx = c.getContext('2d')
    const rng = makeRng(1200 + text.length * 13 + fontSize)
    const bg = o.bg || PALETTE.warmWhite
    if (o.plate !== false) {
      roughRect(ctx, 6, 6, w - 12, h - 12, { rng, fill: bg, width: 5, jitter: 3, passes: 2, radius: 10 })
      if (o.stripe) {
        ctx.save()
        ctx.globalAlpha = 0.85
        ctx.fillStyle = o.stripe
        ctx.fillRect(6, h - 18, w - 12, 10)
        ctx.restore()
      }
    }
    handText(ctx, text, w / 2, h / 2 + 2, {
      rng,
      font: 'bold ' + fontSize + 'px "Comic Sans MS", "Microsoft YaHei", KaiTi, sans-serif',
      color: o.color || PALETTE.ink,
      outlineColor: o.outlineColor || PALETTE.warmWhite,
      outlineWidth: o.outlineWidth ?? (o.plate === false ? 7 : 0),
      rotate: o.rotate || 0
    })
    const t = canvasTexture(c)
    t.userData = { aspect: w / h }
    return t
  })
}

/** 涂鸦印记：手画星星 / 箭头 / 记号线 */
export function graffitiTexture(kind = 'star') {
  return cached('graffiti-' + kind, () => {
    const s = 128
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(1300 + kind.length * 17)
    if (kind === 'star') {
      ctx.save()
      ctx.translate(s / 2, s / 2)
      ctx.fillStyle = PALETTE.yellow
      ctx.beginPath()
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5
        const a2 = a + Math.PI / 5
        ctx.lineTo(Math.cos(a) * 46, Math.sin(a) * 46)
        ctx.lineTo(Math.cos(a2) * 20, Math.sin(a2) * 20)
      }
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      roughLine(ctx, s / 2 - 40, s / 2, s / 2 + 40, s / 2, { rng, width: 3, segments: 3, jitter: 2, passes: 1 })
    } else if (kind === 'arrow') {
      ctx.save()
      ctx.strokeStyle = PALETTE.warmWhite
      ctx.lineWidth = 16
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(20, s / 2)
      ctx.lineTo(s - 26, s / 2)
      ctx.moveTo(s - 50, s / 2 - 24)
      ctx.lineTo(s - 22, s / 2)
      ctx.lineTo(s - 50, s / 2 + 24)
      ctx.stroke()
      ctx.restore()
    }
    return canvasTexture(c)
  })
}

// ---------------------------------------------------------------------------
// 角色面部贴片（三种表情）
// ---------------------------------------------------------------------------
export const FACE_STYLES = ['smile', 'squint', 'dazed']

export function faceTexture(style = 'smile') {
  return cached('face-' + style, () => {
    const s = 256
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(1400 + style.length * 29)
    const ink = PALETTE.ink
    const eye = (x, y, r, op = 1) => {
      ctx.globalAlpha = op
      ctx.fillStyle = ink
      ctx.beginPath()
      ctx.ellipse(x, y, r, r * (style === 'dazed' ? 1.25 : 1.05), 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    const blush = (x, y) => {
      ctx.save()
      ctx.globalAlpha = 0.5
      ctx.fillStyle = PALETTE.blush
      ctx.beginPath()
      ctx.ellipse(x, y, 26, 17, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 0.35
      ctx.beginPath()
      ctx.ellipse(x, y + 1, 18, 10, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    blush(48, 152)
    blush(208, 152)

    if (style === 'smile') {
      eye(88, 112, 12)
      eye(168, 112, 12)
      ctx.strokeStyle = ink
      ctx.lineWidth = 6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(128, 138, 30, 0.18 * Math.PI, 0.82 * Math.PI)
      ctx.stroke()
      // 小鼻子
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.arc(128, 128, 7, 0.1 * Math.PI, 0.9 * Math.PI)
      ctx.stroke()
    } else if (style === 'squint') {
      ctx.strokeStyle = ink
      ctx.lineWidth = 7
      ctx.lineCap = 'round'
      for (const x of [88, 168]) {
        ctx.beginPath()
        ctx.arc(x, 120, 17, 1.15 * Math.PI, 1.85 * Math.PI)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(128, 132, 34, 0.12 * Math.PI, 0.88 * Math.PI)
      ctx.stroke()
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.arc(128, 128, 7, 0.1 * Math.PI, 0.9 * Math.PI)
      ctx.stroke()
    } else {
      eye(88, 110, 15)
      eye(168, 110, 15)
      ctx.save()
      ctx.globalAlpha = 0.85
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.arc(92, 105, 4.5, 0, Math.PI * 2)
      ctx.arc(172, 105, 4.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      ctx.strokeStyle = ink
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.ellipse(128, 142, 14, 17, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#C9716A'
      ctx.beginPath()
      ctx.ellipse(128, 148, 9, 10, 0, 0, Math.PI * 2)
      ctx.fill()
      // 眉
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(72, 82)
      ctx.lineTo(104, 76)
      ctx.moveTo(184, 82)
      ctx.lineTo(152, 76)
      ctx.stroke()
    }
    // 手绘描边：整脸外圈淡淡一圈排线
    hatch(ctx, 20, 200, s - 40, 40, { rng, spacing: 12, angle: -0.4, color: 'rgba(41,51,49,0.18)', len: 0.2 })
    return canvasTexture(c)
  })
}

/** 手画气泡：! 或 ? */
export function bubbleTexture(symbol = '!') {
  return cached('bubble-' + symbol, () => {
    const s = 128
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(1500 + symbol.charCodeAt(0))
    ctx.save()
    ctx.translate(64, 54)
    ctx.beginPath()
    ctx.ellipse(0, 0, 50, 38, 0, 0, Math.PI * 2)
    ctx.restore()
    ctx.fillStyle = PALETTE.warmWhite
    ctx.fill()
    ctx.strokeStyle = PALETTE.ink
    ctx.lineWidth = 5
    ctx.stroke()
    // 尾巴
    ctx.beginPath()
    ctx.moveTo(52, 84)
    ctx.lineTo(46, 110)
    ctx.lineTo(74, 86)
    ctx.closePath()
    ctx.fillStyle = PALETTE.warmWhite
    ctx.fill()
    ctx.stroke()
    handText(ctx, symbol, 64, 52, { rng, font: 'bold 52px "Comic Sans MS", sans-serif', color: PALETTE.ink, outline: false })
    return canvasTexture(c)
  })
}

/** 漫画词 */
export function comicWordTexture(word, color = PALETTE.uiAccent) {
  return cached('word-' + word, () => {
    const fontSize = 64
    const measure = makeCanvas(8, 8).getContext('2d')
    measure.font = 'bold ' + fontSize + 'px "Comic Sans MS", sans-serif'
    const tw = measure.measureText(word).width
    const w = Math.ceil(tw + 48)
    const h = fontSize + 40
    const c = makeCanvas(w, h)
    const ctx = c.getContext('2d')
    const rng = makeRng(1600 + word.length * 7)
    handText(ctx, word, w / 2, h / 2, { rng, font: 'bold ' + fontSize + 'px "Comic Sans MS", sans-serif', color, outlineColor: PALETTE.warmWhite, outlineWidth: 12 })
    const t = canvasTexture(c)
    t.userData = { aspect: w / h }
    return t
  })
}

// ---------------------------------------------------------------------------
// 战斗特效贴图
// ---------------------------------------------------------------------------
export function flashTexture() {
  return cached('flash', () => {
    const s = 128
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(1700)
    const cx = 64
    const cy = 64
    ctx.fillStyle = PALETTE.yellow
    ctx.beginPath()
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const r = i % 2 === 0 ? 58 : 20
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    }
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#FFF7DC'
    ctx.beginPath()
    ctx.arc(cx, cy, 22, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(41,51,49,0.75)'
    ctx.lineWidth = 3
    ctx.beginPath()
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const r = i % 2 === 0 ? 58 : 20
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    }
    ctx.closePath()
    ctx.stroke()
    return canvasTexture(c)
  })
}

export function puffTexture() {
  return cached('puff', () => {
    const s = 128
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(1800)
    ctx.fillStyle = PALETTE.warmWhite
    ctx.beginPath()
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4
      ctx.arc(64 + Math.cos(a) * 22, 64 + Math.sin(a) * 20, rand(rng, 16, 30), 0, Math.PI * 2)
    }
    ctx.fill()
    ctx.strokeStyle = 'rgba(41,51,49,0.6)'
    ctx.lineWidth = 3
    ctx.stroke()
    return canvasTexture(c)
  })
}

export function holeTexture() {
  return cached('hole', () => {
    const s = 64
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(1900)
    ctx.fillStyle = '#20292A'
    ctx.beginPath()
    ctx.ellipse(32, 32, 11, 11, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(41,51,49,0.85)'
    ctx.lineWidth = 3
    for (let i = 0; i < 7; i++) {
      const a = rand(rng, 0, Math.PI * 2)
      const r = rand(rng, 12, 28)
      ctx.beginPath()
      ctx.moveTo(32 + Math.cos(a) * 10, 32 + Math.sin(a) * 10)
      ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r)
      ctx.stroke()
    }
    return canvasTexture(c)
  })
}

export function sparkTexture() {
  return cached('spark', () => {
    const s = 64
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    ctx.fillStyle = PALETTE.yellow
    ctx.beginPath()
    ctx.arc(32, 32, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(41,51,49,0.7)'
    ctx.lineWidth = 3
    ctx.stroke()
    return canvasTexture(c)
  })
}

/** 第一人称武器用的纸板贴图 */
export function cardboardTexture() {
  return cached('cardboard', () => {
    const s = 256
    const c = makeCanvas(s, s)
    const ctx = c.getContext('2d')
    const rng = makeRng(2000)
    ctx.fillStyle = '#E8D3A9'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 22; i++) {
      ctx.globalAlpha = rand(rng, 0.06, 0.18)
      ctx.fillStyle = rng() < 0.5 ? '#F6E7C6' : '#CBB188'
      ctx.beginPath()
      ctx.ellipse(rng() * s, rng() * s, rand(rng, 18, 60), rand(rng, 12, 40), rand(rng, 0, 3), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    for (let i = 0; i < 8; i++) {
      const y = (i / 8) * s
      roughLine(ctx, 0, y, s, y + rand(rng, -2, 2), { rng, width: 1.6, color: 'rgba(41,51,49,0.22)', segments: 5, jitter: 1.2, passes: 1 })
    }
    paperGrain(ctx, s, s, { count: 300, rng, max: 1.2 })
    return canvasTexture(c)
  })
}
