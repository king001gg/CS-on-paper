// 纸上交锋 · PAPER STRIKE —— 输入帧：把「谁在操作」变成显式参数
//
// 原来按住的键、开火、瞄准全是 main.js 的模块级全局，一个进程只能有一份。
// 这里把它们收进可实例化的对象，产出统一的 InputFrame —— 本地玩家、远端玩家、
// 脚本回放都走同一个 sample() 接口，Player.update 因此不需要知道自己被谁驱动。
//
// 本文件不碰 DOM，也不引用任何游戏状态，可独立测试。

/** 一帧输入。yaw/pitch 是绝对值而非增量 —— 网络包丢一帧只是稍旧，不会永久漂移。 */
export function createInputFrame() {
  return {
    seq: 0,
    // forward / right 直接就是 Player.step 读的两个字段名 —— 中间不做换算，
    // 少一层映射就少一处对不齐的机会
    forward: 0,        // -1..1，W/S
    right: 0,          // -1..1，D/A
    jump: false,
    ads: false,
    firePressed: false, // 本帧刚按下（边沿，消费一次即清）
    fireHeld: false,
    lookDx: 0,          // 本帧累积的观察增量，仅本地用来记录手感
    lookDy: 0,
    yaw: 0,             // 绝对朝向，由调用方在应用观察后写回
    pitch: 0
  }
}

/**
 * 本地键鼠输入。持有「当前按住什么」，并在 sample() 时把边沿消费掉。
 * DOM 监听器留在 main.js —— 那里还有暂停、换弹音效等游戏逻辑，
 * 搬进来会让这个模块反向依赖游戏状态。这样切分同样达到了解耦目的。
 */
export class HumanInput {
  constructor() {
    this.pressed = new Set()
    this.shootPressed = false
    this.shootHeld = false
    this.adsHeld = false
    this.compatAds = false
    this.lookDx = 0
    this.lookDy = 0
    this.seq = 0
  }

  /** 瞄准：右键按住，或兼容模式下用 T 切换 */
  get ads() {
    return this.adsHeld || this.compatAds
  }

  setKey(code, down) {
    if (down) this.pressed.add(code)
    else this.pressed.delete(code)
  }

  isDown(code) {
    return this.pressed.has(code)
  }

  pressFire() {
    this.shootPressed = true
    this.shootHeld = true
  }

  releaseFire() {
    this.shootHeld = false
  }

  setAds(on) {
    this.adsHeld = !!on
  }

  toggleCompatAds() {
    this.compatAds = !this.compatAds
  }

  addLook(dx, dy) {
    this.lookDx += dx
    this.lookDy += dy
  }

  /** 产出本帧输入。边沿（firePressed）与观察增量消费后清零。 */
  sample() {
    const f = createInputFrame()
    f.seq = ++this.seq
    f.forward = (this.pressed.has('KeyW') ? 1 : 0) - (this.pressed.has('KeyS') ? 1 : 0)
    f.right = (this.pressed.has('KeyD') ? 1 : 0) - (this.pressed.has('KeyA') ? 1 : 0)
    f.jump = this.pressed.has('Space')
    f.ads = this.ads
    f.firePressed = this.shootPressed
    f.fireHeld = this.shootHeld
    f.lookDx = this.lookDx
    f.lookDy = this.lookDy
    this.shootPressed = false
    this.lookDx = 0
    this.lookDy = 0
    return f
  }

  /** 清空所有按住状态。状态转换（暂停/重开/回菜单）时必须调用。 */
  clear() {
    this.pressed.clear()
    this.shootPressed = false
    this.shootHeld = false
    this.adsHeld = false
    this.compatAds = false
    this.lookDx = 0
    this.lookDy = 0
  }
}

/**
 * 远端玩家的输入。网络包到达时 push，主机每帧 sample。
 * 没有新包时重复上一帧 —— 相当于「保持按键」，比清零更接近真实行为。
 */
export class RemoteInput {
  constructor() {
    this.latest = createInputFrame()
    this.received = 0
    // 边沿必须单独记：sample 是无状态的，只看 latest.firePressed 的话，
    // 要么第一次就漏掉，要么每次 sample 都重复开火。
    this.pendingFire = false
  }

  push(frame) {
    this.latest = frame
    this.received++
    if (frame.firePressed) this.pendingFire = true
  }

  /** 取最近一帧的副本；未消费的开火边沿放行一次 */
  sample() {
    const f = createInputFrame()
    Object.assign(f, this.latest)
    f.firePressed = this.pendingFire
    this.pendingFire = false
    return f
  }
}

/** 脚本驱动的输入，供单测与验收脚本回放用 */
export class ScriptedInput {
  constructor(frames = []) {
    this.queue = [...frames]
    this.latest = createInputFrame()
  }

  push(frame) {
    this.queue.push(frame)
  }

  sample() {
    if (this.queue.length) this.latest = this.queue.shift()
    return this.latest
  }
}
