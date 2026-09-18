// 纸上交锋 · PAPER STRIKE —— 持枪者：一个人的枪、后坐、镜头与统计
//
// 原来这些是 main.js 里的模块级全局，一个进程只能有一份 —— 因为单人模式只有一个持枪者
// 所以一直没暴露问题。双人对战要求「每个持枪者一份」，于是收进这个可实例化的对象。
//
// 这里收的是 main.js:84-94 那一坨藏得最深的全局，逐条核对别漏：
//   lastReloading / recoilPitch / recoilVel / stepDistance / wasOnGround / camFov
// 每一个都是「每个持枪者一份」——去全局化时最常漏的就是它们。
//
// weapon-state.js 一行不改：它零 import、每个函数第一参数都是 state，
// 所以每个 loadout 各调一次 createWeaponState() 就得到两份完全独立的状态。
import * as THREE from 'three'
import {
  createWeaponState, updateWeaponState, tryFire, resetWeaponState,
  spreadFor, damageFor, WEAPONS, adsFov, adsSensitivityScale, reloadProgress, isReloading
} from './weapon-state.js'
import { resolveShot } from './combat.js'
import { MODE } from './match.js'

const BASE_FOV = 75
const MAX_SHOT_DIST = 160
const TRACER_MISS_DIST = 140

// 弹道散布用的临时向量。放在模块级是安全的：整个开火流程是同步的，
// 不存在两个持枪者同时写到一半的情况。
const tmpVec = new THREE.Vector3()
const tmpVec2 = new THREE.Vector3()
const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * 按扩散角扰动弹道方向。散布要发生在垂直于弹道的平面上，
 * 所以需要一组「屏幕的右和上」：有相机时直接取相机的，
 * 没有相机（远端玩家由主机代算）时用世界向上叉出一组正交基。
 */
function applySpread(dir, spread, camera) {
  if (spread <= 0) return dir
  const angle = Math.random() * Math.PI * 2
  const radius = Math.sqrt(Math.random()) * Math.tan(spread)
  let right
  let up
  if (camera) {
    right = tmpVec.set(1, 0, 0).applyQuaternion(camera.quaternion)
    up = tmpVec2.set(0, 1, 0).applyQuaternion(camera.quaternion)
  } else {
    right = tmpVec.copy(dir).cross(WORLD_UP)
    // 垂直朝天开枪时叉积退化为零向量，退回世界 X 轴
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
    right.normalize()
    up = tmpVec2.copy(right).cross(dir).normalize()
  }
  dir.addScaledVector(right, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius)
  return dir.normalize()
}

/**
 * 一个持枪者。player 是它的身体，其余是可选的呈现与反馈通道。
 *
 * 远端玩家（第 3 期）打出来的枪由主机结算：那时传 camera: null、weaponView: null，
 * fire() 会退化成「从眼位沿朝向开枪」，没有镜头晃动也没有第一人称枪模 —— 正是想要的。
 */
export function createLoadout(player, opts = {}) {
  const {
    camera = null,
    weaponView = null,
    audio = null,
    ui = null,
    effects = null,
    world = null,
    match = null,
    enemies = null,
    weaponId = 'smg',
    // 相机的起始 fov。main.js 传的是菜单的 48 —— 开局会缓动到 75，
    // 保留这一点点拉远，否则开局观感与改动前不同。
    initialFov = BASE_FOV
  } = opts

  const self = {
    player,
    camera,
    weaponView,
    audio,
    ui,
    effects,
    world,
    match,
    enemies,
    weaponState: createWeaponState(weaponId),
    stats: { shots: 0, hits: 0, kills: 0, headshots: 0 },
    // ↓ 下面六个是从 main.js:84-89 搬过来的「每个持枪者一份」的状态
    lastReloading: { smg: false, sniper: false },
    recoilPitch: 0,
    recoilVel: 0,
    stepDistance: 0,
    wasOnGround: true,
    camFov: initialFov,

    /** startGame 里与枪有关的那部分。相机 fov 刻意不重置 —— 改动前也没重置，由 syncCamera 缓动收敛 */
    reset(id = weaponId) {
      resetWeaponState(self.weaponState, id)
      self.lastReloading = { smg: false, sniper: false }
      self.stats.shots = 0
      self.stats.hits = 0
      self.stats.kills = 0
      self.stats.headshots = 0
      self.recoilPitch = 0
      self.recoilVel = 0
      self.stepDistance = 0
      self.wasOnGround = true
      return self
    },

    /** 这一枪能打中的全部目标。DUEL 模式场地是空的，只有敌对玩家 */
    hitTargets() {
      if (self.match) return self.match.hitTargets
      return self.enemies ? self.enemies.hitTargets : []
    },

    /**
     * 枪口位置与朝向。
     * 有相机时用相机 —— 这不是随便定的：camera.rotation.x 是 player.pitch + recoilPitch，
     * 也就是**后坐力会抬高弹着点**；相机位置还含走路晃动。改用 player.aimVector() 会同时
     * 丢掉这两样，手感直接变。远端玩家没有相机，才退回到眼位 + 朝向。
     */
    aim(origin, dir) {
      if (self.camera) {
        self.camera.getWorldDirection(dir)
        origin.copy(self.camera.position)
        return
      }
      origin.set(player.position.x, player.eyeY, player.position.z)
      const pitch = player.pitch + self.recoilPitch
      const cp = Math.cos(pitch)
      dir.set(-Math.sin(player.yaw) * cp, Math.sin(pitch), -Math.cos(player.yaw) * cp).normalize()
    },

    /**
     * 打一发。命中结算走 match.damage()（第 1 期统一的入口），
     * 所以打中敌人和打中玩家是同一段代码。
     * hooks.onKill 由主循环提供 —— 胜负判定不该由持枪者自己决定。
     */
    fire(hooks = {}) {
      const id = self.weaponState.current
      const ads = player.ads
      const origin = new THREE.Vector3()
      const dir = new THREE.Vector3()
      self.aim(origin, dir)
      if (self.camera) applySpread(dir, spreadFor(self.weaponState, { ads, moving: player.moving }), self.camera)
      const shot = resolveShot(origin, dir, { solids: self.world.solids, targets: self.hitTargets(), maxDist: MAX_SHOT_DIST })

      self.stats.shots += 1
      if (self.audio) self.audio.shoot(id)
      if (self.weaponView) self.weaponView.fire(id)
      self.recoilVel += id === 'sniper' ? 3.1 : 0.55

      const muzzle = self.weaponView ? self.weaponView.muzzleWorldPosition(self.camera, id) : origin.clone()
      const endPoint = shot.type === 'none' ? origin.clone().addScaledVector(dir, TRACER_MISS_DIST) : shot.point
      if (self.effects) self.effects.spawnTracer(muzzle, endPoint)

      if (self.enemies) {
        self.enemies.alertNoise({ x: player.position.x, y: player.eyeY, z: player.position.z })
      }

      if (shot.type === 'enemy') {
        const part = shot.part
        const damage = damageFor(id, part)
        self.stats.hits += 1
        if (part === 'head') self.stats.headshots += 1
        const result = self.match
          ? self.match.damage(shot.enemy, damage, part)
          : shot.enemy.takeDamage(damage, part)
        if (self.effects) self.effects.hitCharacter(shot.point, shot.normal)
        if (self.ui) {
          self.ui.hitMarker(part === 'head')
          if (part === 'head') self.ui.comic('爆头！', 0.5 + (Math.random() - 0.5) * 0.16, 0.4)
          else self.ui.comic(id === 'sniper' ? 'POW!' : '啪！', 0.5 + (Math.random() - 0.5) * 0.2, 0.42)
        }
        if (self.audio) self.audio.hitMarker(part === 'head')
        if (result.died) {
          self.stats.kills += 1
          if (self.audio) self.audio.enemyDown()
          if (hooks.onKill) hooks.onKill(result, shot)
        }
      } else if (shot.type === 'wall') {
        if (self.effects) self.effects.impact(shot.point, shot.normal, 1)
      }
      return shot
    },

    /** 每帧的武器推进与开火判定。frame 是 InputFrame，边沿已由输入源消费好 */
    updateCombat(dt, frame, hooks = {}) {
      updateWeaponState(self.weaponState, dt)
      const reloaded = self.weaponState.justReloaded
      if (reloaded && self.audio) self.audio.reloadEnd(reloaded)
      for (const id of ['smg', 'sniper']) {
        const now = isReloading(self.weaponState, id)
        if (now && !self.lastReloading[id] && self.audio) self.audio.reloadStart(id)
        self.lastReloading[id] = now
      }

      if (frame.firePressed || frame.fireHeld) {
        const res = tryFire(self.weaponState, { pressed: frame.firePressed, held: frame.fireHeld })
        if (res.fired) self.fire(hooks)
        else if (res.reason === 'empty' && self.audio) self.audio.dryFire()
      }

      // 后坐：先冲量抬高，再自己衰减回去
      self.recoilPitch += self.recoilVel * dt
      self.recoilVel -= self.recoilVel * Math.min(1, dt * 7)
      self.recoilPitch -= self.recoilPitch * Math.min(1, dt * 5.5)
    },

    /** 脚步声与落地音。按移动距离触发，不是按时间 */
    updateFeet(dt) {
      self.stepDistance += Math.hypot(player.velocity.x, player.velocity.z) * dt
      if (player.onGround && self.stepDistance > 2.3) {
        self.stepDistance = 0
        if (self.audio) self.audio.footstep()
      }
      if (player.onGround && !self.wasOnGround && self.audio) self.audio.land()
      self.wasOnGround = player.onGround
    },

    /** 相机跟随：位置含走路晃动，朝向含后坐抬升 */
    syncCamera(dt) {
      if (!self.camera) return
      const camera = self.camera
      const bobAmount = player.bob * 0.045
      const bobY = Math.sin(player.stepPhase) * bobAmount
      const bobX = Math.cos(player.stepPhase * 0.5) * bobAmount * 0.6
      camera.position.set(player.position.x, player.position.y + player.eyeHeight + bobY, player.position.z)
      const right = tmpVec.set(1, 0, 0).applyQuaternion(camera.quaternion)
      camera.position.addScaledVector(right, bobX)
      camera.rotation.set(player.pitch + self.recoilPitch, player.yaw, Math.sin(player.stepPhase * 0.5) * player.bob * 0.012)
      const wantScope = player.ads && self.weaponState.current === 'sniper' && !isReloading(self.weaponState)
      const targetFov = player.ads ? adsFov(self.weaponState, BASE_FOV) : BASE_FOV
      self.camFov += (targetFov - self.camFov) * Math.min(1, dt * (wantScope ? 18 : 14))
      camera.fov = self.camFov
      camera.updateProjectionMatrix()

      if (self.ui) self.ui.setScope(wantScope)
      if (self.weaponView) {
        self.weaponView.setHidden(wantScope)
        self.weaponView.update(dt, {
          ads: player.ads,
          scoped: wantScope,
          moving: player.moving,
          bobSpeed: player.bob,
          reloadProgress: isReloading(self.weaponState) ? reloadProgress(self.weaponState) : 0
        })
        self.weaponView.camera.quaternion.copy(camera.quaternion)
        self.weaponView.camera.fov = camera.fov
        self.weaponView.camera.updateProjectionMatrix()
      }
    },

    /**
     * 写 HUD。DUEL 模式没有敌人，剩余敌人这一项交给 main.js 另行处理
     * ——这里只管枪与血量，那是每个持枪者共通的。
     */
    writeHud(elapsed) {
      if (!self.ui) return
      const w = self.weaponState.weapons[self.weaponState.current]
      const def = WEAPONS[self.weaponState.current]
      self.ui.setHealth(player.health)
      self.ui.setAmmo(w.ammo, def.magSize)
      self.ui.setWeaponName(def.name)
      self.ui.setTimer(elapsed)
      const reloading = isReloading(self.weaponState)
      self.ui.setReload(reloading ? reloadProgress(self.weaponState) : 0, reloading, '换弹中…')
      self.ui.setCrosshairSpread(3 + spreadFor(self.weaponState, { ads: player.ads, moving: player.moving }) * 500)
      if (!player.dead) {
        const near = self.enemies
          ? self.enemies.enemies.some((e) => e.alive && e.state === 'attack' && Math.hypot(e.position.x - player.position.x, e.position.z - player.position.z) < 18)
          : false
        // 模式决定「没在挨打」时的底色：决斗里写「交火中」是错的，场上没有交火
        const idle = self.match && self.match.mode === MODE.DUEL ? '决斗中' : '交火中'
        self.ui.setStatus(reloading ? '换弹中' : near ? '遭到射击' : idle)
      }
    },

    /** 鼠标观察的灵敏度：开镜时既降灵敏度、又随倍率再降一次 */
    lookSensitivity(baseSensitivity, adsSensitivity) {
      if (!player.ads) return baseSensitivity
      return baseSensitivity * (adsSensitivity * adsSensitivityScale(self.weaponState, BASE_FOV))
    }
  }

  return self
}
