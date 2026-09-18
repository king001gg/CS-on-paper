// 纸上交锋 · PAPER STRIKE —— 第一人称武器模型与动作（独立渲染通道）
import * as THREE from 'three'
import { PALETTE } from './sketch.js'
import * as TEX from './textures.js'
import { WEAPONS } from './weapon-state.js'

const INK = new THREE.Color(PALETTE.ink)

/**
 * 冲锋枪开镜时只淡掉「准星」那一小块，枪身其余部分保持实心。
 * 准星导轨正好压在准心线上，淡掉它视野就通了；枪身不动则保留据枪的分量感。
 * 0.5 是「看得见一层半透明准星」而不是「准星没了」—— 再低就只剩个影子。
 */
const SMG_ADS_SIGHT_OPACITY = 0.5
/** 描边比准星本体更淡，否则黑色描边会在准心位置框出一个明显的方框 */
const SMG_ADS_SIGHT_OUTLINE_OPACITY = 0.3

function toon(color, o = {}) {
  return new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    gradientMap: TEX.toonGradientMap(),
    map: o.map || null,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide
  })
}

let outlineMat = null
function inkMat() {
  if (!outlineMat) outlineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide })
  return outlineMat
}

/**
 * 收集「准星」部件的材质；枪体材质一概不碰，保持实心。
 * 描边 inkMat() 是跨两把枪共用的单例，必须复制一份归自己，
 * 否则淡化冲锋枪的准星会连狙击枪的描边一起淡掉。
 * 准星本体与描边分两组，因为两者要淡到不同的程度。
 */
function collectSightMaterials(group) {
  const body = new Set()
  const outline = new Set()
  let outlineClone = null
  group.traverse((o) => {
    if (!o.isMesh || !o.material || !o.userData.sight) return
    if (o.material === outlineMat) {
      if (!outlineClone) {
        outlineClone = o.material.clone()
        outlineClone.userData.isOutline = true
      }
      o.material = outlineClone
      outline.add(o.material)
    } else {
      body.add(o.material)
    }
  })
  return { body: [...body], outline: [...outline] }
}

/**
 * 改写一组材质的不透明度。transparent 只在跨越阈值时翻转，避免每帧触发材质重编译。
 * 刻意保留 depthWrite：只渲染最靠前的表面，枪才是一把轮廓完整的半透明实体；
 * 关掉它会让所有面一起混合，枪身糊成一堆透明板，看不出是把枪。
 */
function fade(list, alpha) {
  const ghost = alpha < 0.999
  for (const m of list) {
    if (m.transparent !== ghost) {
      m.transparent = ghost
      m.needsUpdate = true
    }
    m.opacity = alpha
  }
}

function applySightOpacity(model, bodyAlpha, outlineAlpha) {
  const mats = model.userData.sightMats
  if (!mats) return
  fade(mats.body, bodyAlpha)
  fade(mats.outline, outlineAlpha)
}

/** o.sight：标记为准星部件，开镜时只有这些部件会被淡化（连同它自己的描边） */
function part(parent, geo, mat, x, y, z, o = {}) {
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, y, z)
  if (o.rot) mesh.rotation.set(o.rot[0] || 0, o.rot[1] || 0, o.rot[2] || 0)
  if (o.sight) mesh.userData.sight = true
  parent.add(mesh)
  if (o.outline !== false) {
    const pad = o.pad ?? 0.012
    let line
    if (geo.type === 'BoxGeometry') line = new THREE.Mesh(new THREE.BoxGeometry(geo.parameters.width + pad * 2, geo.parameters.height + pad * 2, geo.parameters.depth + pad * 2), inkMat())
    else if (geo.type === 'CylinderGeometry') line = new THREE.Mesh(new THREE.CylinderGeometry(geo.parameters.radiusTop + pad, geo.parameters.radiusBottom + pad, geo.parameters.height + pad * 2, 10), inkMat())
    if (line) {
      line.position.copy(mesh.position)
      line.rotation.copy(mesh.rotation)
      if (o.sight) line.userData.sight = true
      parent.add(line)
    }
  }
  return mesh
}

/** 贴一张手写小字（pew pew! / loooong!） */
function decal(parent, text, x, y, z, rotY = Math.PI / 2, size = 0.1) {
  const tex = TEX.comicWordTexture(text, PALETTE.uiAccent)
  const aspect = tex.userData.aspect || 3
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size * aspect, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
  mesh.position.set(x, y, z)
  mesh.rotation.y = rotY
  parent.add(mesh)
  return mesh
}

function tapeStrip(parent, w, h, x, y, z, color) {
  return part(parent, new THREE.BoxGeometry(w, h, 0.005), toon(color), x, y, z, { outline: false })
}

/** 软袖子 + 圆手 */
function arms(parent, holdX, holdY, holdZ, shirtColor) {
  const sleeveMat = toon(shirtColor)
  const skinMat = toon(PALETTE.skin)
  const right = new THREE.Group()
  const rs = part(right, new THREE.CylinderGeometry(0.062, 0.075, 0.2, 10), sleeveMat, 0, -0.1, 0.07, { rot: [0.5, 0, 0], pad: 0.01 })
  part(right, new THREE.SphereGeometry(0.062, 12, 10), skinMat, 0, 0.0, -0.02, { outline: false })
  right.position.set(holdX + 0.02, holdY - 0.05, holdZ + 0.08)
  parent.add(right)
  const left = new THREE.Group()
  part(left, new THREE.CylinderGeometry(0.055, 0.068, 0.22, 10), sleeveMat, 0, -0.11, 0.09, { rot: [0.75, 0, 0], pad: 0.01 })
  part(left, new THREE.SphereGeometry(0.058, 12, 10), skinMat, 0, 0.005, -0.03, { outline: false })
  left.position.set(holdX - 0.02, holdY - 0.06, holdZ - 0.06)
  parent.add(left)
  return { right, left, rs }
}

export function buildSmgModel() {
  const g = new THREE.Group()
  const cardboard = toon('#E8D3A9', { map: TEX.cardboardTexture() })
  const teal = toon(PALETTE.teal)
  const orange = toon(PALETTE.uiAccent)
  const yellow = toon(PALETTE.yellow)
  part(g, new THREE.BoxGeometry(0.1, 0.13, 0.4), cardboard, 0, 0, 0, { pad: 0.014 })
  // 准星导轨用独立材质并标记为 sight：开镜时只淡化它，
  // 枪管/机匣等其他 teal 部件共用同一个 teal 材质，不能跟着淡
  part(g, new THREE.BoxGeometry(0.055, 0.045, 0.26), toon(PALETTE.teal), 0, 0.085, -0.03, { pad: 0.012, sight: true })
  part(g, new THREE.CylinderGeometry(0.033, 0.033, 0.2, 10), teal, 0, 0.012, -0.28, { rot: [Math.PI / 2, 0, 0], pad: 0.012 })
  part(g, new THREE.CylinderGeometry(0.042, 0.042, 0.03, 10), orange, 0, 0.012, -0.37, { rot: [Math.PI / 2, 0, 0], pad: 0.008 })
  part(g, new THREE.BoxGeometry(0.05, 0.18, 0.075), orange, 0, -0.14, -0.02, { rot: [0.16, 0, 0], pad: 0.01 })
  part(g, new THREE.BoxGeometry(0.055, 0.13, 0.07), cardboard, 0, -0.11, 0.14, { rot: [-0.22, 0, 0], pad: 0.012 })
  part(g, new THREE.BoxGeometry(0.06, 0.075, 0.1), teal, 0, 0.0, 0.24, { pad: 0.012 })
  tapeStrip(g, 0.104, 0.028, 0, 0.052, -0.12, PALETTE.yellow)
  tapeStrip(g, 0.104, 0.022, 0, -0.05, 0.06, PALETTE.uiAccent)
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 8), inkMat())
  screw.rotation.z = Math.PI / 2
  screw.position.set(0.052, 0.02, 0.03)
  g.add(screw)
  decal(g, 'pew pew!', 0.052, 0.03, 0.05, Math.PI / 2, 0.045)
  const { right } = arms(g, 0.0, -0.09, 0.12, PALETTE.shirtOrange)
  g.userData.holdRight = right
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.4)
  return g
}

export function buildSniperModel() {
  const g = new THREE.Group()
  const cardboard = toon('#E8D3A9', { map: TEX.cardboardTexture() })
  const teal = toon(PALETTE.teal)
  const blue = toon(PALETTE.blue)
  const yellow = toon(PALETTE.yellow)
  part(g, new THREE.BoxGeometry(0.085, 0.11, 0.5), cardboard, 0, 0, 0, { pad: 0.014 })
  part(g, new THREE.CylinderGeometry(0.026, 0.03, 0.52, 10), teal, 0, 0.012, -0.5, { rot: [Math.PI / 2, 0, 0], pad: 0.012 })
  part(g, new THREE.CylinderGeometry(0.038, 0.038, 0.04, 10), yellow, 0, 0.012, -0.76, { rot: [Math.PI / 2, 0, 0], pad: 0.008 })
  // 望远镜式瞄准镜
  part(g, new THREE.CylinderGeometry(0.055, 0.055, 0.26, 12), blue, 0, 0.115, -0.06, { rot: [Math.PI / 2, 0, 0], pad: 0.012 })
  part(g, new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12), PALETTE.dark ? toon(PALETTE.dark) : teal, 0, 0.115, -0.18, { rot: [Math.PI / 2, 0, 0], pad: 0.008 })
  part(g, new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), toon('#2E4A50'), 0, 0.115, -0.195, { rot: [Math.PI / 2, 0, 0], outline: false })
  part(g, new THREE.BoxGeometry(0.02, 0.06, 0.05), cardboard, 0, 0.06, -0.02, { outline: false })
  part(g, new THREE.BoxGeometry(0.02, 0.06, 0.05), cardboard, 0, 0.06, -0.14, { outline: false })
  part(g, new THREE.BoxGeometry(0.045, 0.14, 0.06), toon(PALETTE.uiAccent), 0, -0.1, 0.06, { rot: [0.12, 0, 0], pad: 0.01 })
  part(g, new THREE.BoxGeometry(0.05, 0.11, 0.06), cardboard, 0, -0.09, 0.18, { rot: [-0.18, 0, 0], pad: 0.012 })
  part(g, new THREE.BoxGeometry(0.07, 0.07, 0.14), teal, 0, 0.0, 0.32, { pad: 0.012 })
  // 拉栓
  const bolt = new THREE.Group()
  part(bolt, new THREE.CylinderGeometry(0.011, 0.011, 0.09, 8), yellow, 0.045, 0.02, 0.035, { rot: [0, 0, Math.PI / 2], pad: 0.006 })
  part(bolt, new THREE.SphereGeometry(0.018, 10, 8), yellow, 0.095, 0.02, 0.035, { outline: false })
  bolt.position.set(0, 0, 0)
  g.add(bolt)
  tapeStrip(g, 0.09, 0.026, 0, 0.05, 0.14, PALETTE.yellow)
  decal(g, 'loooong!', 0.045, 0.02, 0.02, Math.PI / 2, 0.04)
  const { right } = arms(g, 0.0, -0.08, 0.16, PALETTE.shirtBlue)
  g.userData.holdRight = right
  g.userData.bolt = bolt
  g.scale.setScalar(0.86)
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.82)
  return g
}

/** 第一人称武器视图：独立场景 + 独立相机，避免枪身插进墙面 */
export class WeaponView {
  constructor() {
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.01, 12)
    this.scene.add(this.camera)
    const hemi = new THREE.HemisphereLight(new THREE.Color(PALETTE.warmWhite), new THREE.Color(PALETTE.dark), 2.1)
    this.scene.add(hemi)
    const dir = new THREE.DirectionalLight(new THREE.Color('#FFF5DB'), 2.0)
    dir.position.set(-0.6, 1.2, 0.9)
    this.scene.add(dir)
    const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.blue), 0.7)
    fill.position.set(0.9, -0.4, -0.8)
    this.scene.add(fill)
    this.scene.fog = null

    // 武器挂在视图相机下，跟随视线一起转动（同时保持独立深度通道，不会插进墙里）
    this.root = new THREE.Group()
    this.root.name = 'weapon-root'
    this.camera.add(this.root)
    this.models = {
      smg: buildSmgModel(),
      sniper: buildSniperModel()
    }
    for (const key of Object.keys(this.models)) {
      const m = this.models[key]
      m.userData.sightMats = collectSightMaterials(m)
      m.visible = false
      this.root.add(m)
    }
    this.current = 'smg'
    this.adsT = 0
    this.switchT = 0
    this.recoil = 0
    this.recoilVel = 0
    this.bobPhase = 0
    this.swayX = 0
    this.swayY = 0
    this.boltT = 0
    this.reloadT = 0
    this.muzzleTimer = 0
    this.hidden = false
    this.baseFov = 75

    const flashTex = TEX.flashTexture()
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.flash.scale.setScalar(0.34)
    this.flash.visible = false
    this.root.add(this.flash)
    this.setWeapon('smg', true)
  }

  setWeapon(id, instant = false) {
    this.current = id
    for (const key of Object.keys(this.models)) this.models[key].visible = key === id
    if (!instant) this.switchT = WEAPONS[id].switchTime
    this.recoil = 0
    this.recoilVel = 0
    this.boltT = 0
    this.reloadT = 0
    this.updateCameraFov(this.baseFov, 0)
  }

  updateCameraFov(baseFov, adsT) {
    const def = WEAPONS[this.current]
    const target = def.adsZoom >= 2 ? baseFov : baseFov * (1 + (def.adsFovScale - 1) * adsT)
    this.camera.fov = target
    this.camera.updateProjectionMatrix()
  }

  fire(id) {
    this.recoilVel += id === 'sniper' ? 5.6 : 3.4
    this.muzzleTimer = 0.055
    const model = this.models[id]
    if (model) {
      const m = model.userData.muzzle
      this.flash.position.copy(m).applyEuler(model.rotation).add(model.position)
      this.flash.scale.setScalar(id === 'sniper' ? 0.45 : 0.3)
      this.flash.material.rotation = Math.random() * Math.PI
      this.flash.visible = true
    }
    if (id === 'sniper') this.boltT = 0.42
  }

  look(dx, dy) {
    this.swayX += (THREE.MathUtils.clamp(-dx * 0.0016, -0.03, 0.03) - this.swayX) * 0.5
    this.swayY += (THREE.MathUtils.clamp(-dy * 0.0016, -0.03, 0.03) - this.swayY) * 0.5
  }

  update(dt, params = {}) {
    const def = WEAPONS[this.current]
    const model = this.models[this.current]
    if (!model) return
    const adsTarget = params.ads && !params.scoped ? 1 : 0
    this.adsT += (adsTarget - this.adsT) * Math.min(1, dt * 12)
    if (this.switchT > 0) this.switchT = Math.max(0, this.switchT - dt)

    // 后坐恢复
    this.recoilVel -= this.recoilVel * Math.min(1, dt * 9)
    this.recoil += this.recoilVel * dt
    this.recoil = Math.max(0, this.recoil - dt * 1.6)
    if (this.recoil < 0) this.recoil = 0

    if (this.boltT > 0) this.boltT = Math.max(0, this.boltT - dt)
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt
      if (this.muzzleTimer <= 0) this.flash.visible = false
    }
    if (params.reloadProgress > 0) {
      this.reloadT = params.reloadProgress
    } else {
      this.reloadT += (0 - this.reloadT) * Math.min(1, dt * 8)
    }

    const moving = params.moving ? 1 : 0
    const speedFactor = params.bobSpeed ?? 1
    this.bobPhase += dt * (6.5 + speedFactor * 4) * moving
    const bobX = Math.sin(this.bobPhase) * 0.012 * moving * speedFactor
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.01 * moving * speedFactor

    this.swayX += (0 - this.swayX) * Math.min(1, dt * 5)
    this.swayY += (0 - this.swayY) * Math.min(1, dt * 5)

    const hipX = this.current === 'smg' ? 0.16 : 0.2
    const hipY = this.current === 'smg' ? -0.17 : -0.17
    const hipZ = this.current === 'smg' ? -0.38 : -0.5
    const adsX = 0.0
    const adsY = -0.075
    const adsZ = -0.4
    const t = this.adsT
    const switchDrop = this.switchT > 0 ? Math.sin((1 - this.switchT / def.switchTime) * Math.PI) : 0
    const reloadDip = Math.sin(this.reloadT * Math.PI) * 1.0
    const interact = Math.max(switchDrop, reloadDip)

    const px = (hipX + (adsX - hipX) * t) + bobX + this.swayX
    const py = (hipY + (adsY - hipY) * t) + bobY - interact * 0.16 + this.recoil * 0.012 + this.swayY
    const pz = (hipZ + (adsZ - hipZ) * t) + this.recoil * 0.045

    model.position.set(px, py, pz)
    model.rotation.set(
      -this.recoil * 0.14 + interact * 0.9 + bobY * 0.6,
      -0.06 * (1 - t) + this.swayX * 2.2 + interact * 0.35,
      0.03 + interact * 0.55 + bobX * 1.4
    )
    if (model.userData.bolt) {
      const k = this.boltT > 0 ? Math.sin((1 - this.boltT / 0.42) * Math.PI) : 0
      model.userData.bolt.position.z = -k * 0.075
      model.userData.bolt.rotation.z = k * 0.5
    }
    // 冲锋枪开镜时只淡掉准星那一小块，枪身保持实心
    if (this.current === 'smg') {
      applySightOpacity(
        model,
        1 + (SMG_ADS_SIGHT_OPACITY - 1) * t,
        1 + (SMG_ADS_SIGHT_OUTLINE_OPACITY - 1) * t
      )
    }
    model.visible = !this.hidden
    this.updateCameraFov(this.baseFov, this.adsT)
  }

  setHidden(hidden) {
    this.hidden = hidden
    for (const key of Object.keys(this.models)) this.models[key].visible = !hidden && key === this.current
  }

  /** 枪口世界坐标（用于弹道起点） */
  muzzleWorldPosition(camera, gunId, out = new THREE.Vector3()) {
    const def = WEAPONS[gunId]
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const side = def.id === 'sniper' ? 0.16 : 0.14
    return out.copy(camera.position).addScaledVector(right, side).addScaledVector(up, -0.09).addScaledVector(fwd, 0.55)
  }
}
