// 纸上交锋 · PAPER STRIKE —— 界面控制
export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id)
    this.el = {
      menu: $('menu'),
      hud: $('hud'),
      pause: $('pause'),
      result: $('result'),
      net: $('net'),
      webglError: $('webgl-error'),
      webglErrorText: $('webgl-error-text'),
      lockHint: $('lock-hint'),
      lockToast: $('lock-toast'),
      start: $('btn-start'),
      resume: $('btn-resume'),
      restart: $('btn-restart'),
      toMenu: $('btn-tomenu'),
      again: $('btn-again'),
      resultMenu: $('btn-result-menu'),
      pauseBtn: $('btn-pause'),
      muteBtn: $('btn-mute'),
      muteMenu: $('btn-mute-menu'),
      enemiesLeft: $('enemies-left'),
      pips: $('progress-pips'),
      missionName: document.querySelector('#hud .mission-name'),
      missionCount: document.querySelector('#hud .mission-count'),
      opponentLine: $('opponent-line'),
      opponentName: $('opponent-name'),
      opponentHp: $('opponent-hp'),
      netBack: $('btn-net-back'),
      timer: $('hud-timer'),
      status: $('hud-status'),
      hpNumber: $('hp-number'),
      hpFill: $('hp-fill'),
      ammoMag: $('ammo-mag'),
      weaponName: $('weapon-name'),
      reloadFill: $('reload-fill'),
      reloadText: $('reload-text'),
      crosshair: $('crosshair'),
      hitMarker: $('hit-marker'),
      headshot: $('headshot-flag'),
      scope: $('scope'),
      damage: $('damage-vignette'),
      comic: $('comic-layer'),
      toastLayer: $('toast-layer'),
      compatHint: $('compat-hint'),
      resultTitle: $('result-title'),
      resultSub: $('result-sub'),
      resultKills: $('result-kills'),
      resultTime: $('result-time'),
      resultAcc: $('result-acc'),
      resultShots: $('result-shots'),
      loadoutCards: Array.from(document.querySelectorAll('.loadout-card'))
    }
    this.last = {}
    this.hitTimer = 0
    this.headTimer = 0
    this.damageTimer = 0
    this.buildPips(8)
  }

  buildPips(count) {
    this.el.pips.innerHTML = ''
    this.pips = []
    for (let i = 0; i < count; i++) {
      const d = document.createElement('span')
      d.className = 'pip'
      this.el.pips.appendChild(d)
      this.pips.push(d)
    }
  }

  setPips(deadCount) {
    if (this.last.pips === deadCount) return
    this.last.pips = deadCount
    this.pips.forEach((p, i) => p.classList.toggle('is-dead', i < deadCount))
  }

  showScreen(name) {
    this.el.menu.classList.toggle('hidden', name !== 'menu')
    this.el.hud.classList.toggle('hidden', name !== 'hud')
    this.el.pause.classList.toggle('hidden', name !== 'pause')
    this.el.result.classList.toggle('hidden', name !== 'result')
    this.el.net.classList.toggle('hidden', name !== 'net')
    this.el.webglError.classList.toggle('hidden', name !== 'error')
  }

  /**
   * 切换 HUD 的任务栏形态。
   * SOLO 显示「剩几名敌人 + 进度格」，DUEL 这些没有意义（场地是空的），
   * 换成右上角的对手血条 —— 不去动 HUD 的四角布局，加第五个角必然要在小窗口重排。
   */
  setMode(mode) {
    if (this.last.mode === mode) return
    this.last.mode = mode
    const duel = mode === 'duel'
    if (this.el.missionName) this.el.missionName.textContent = duel ? '决斗 · 日光街区' : '任务 · 日光街区'
    if (this.el.missionCount) this.el.missionCount.classList.toggle('hidden', duel)
    this.el.pips.classList.toggle('hidden', duel)
    if (!duel) this.setOpponent(null)
  }

  /** 对手状态。传 null 隐藏；对手倒下时仍然显示，只是把血量换成「已击倒」 */
  setOpponent(info) {
    if (!info) {
      if (this.last.opponent === null) return
      this.last.opponent = null
      this.el.opponentLine.classList.add('hidden')
      return
    }
    const key = info.id + '/' + info.hp + '/' + info.alive
    if (this.last.opponent === key) return
    this.last.opponent = key
    this.el.opponentLine.classList.remove('hidden')
    if (this.el.opponentName) this.el.opponentName.textContent = info.name
    this.el.opponentHp.textContent = info.alive ? String(Math.max(0, Math.round(info.hp))) : '已击倒'
    this.el.opponentHp.classList.toggle('is-down', !info.alive)
  }

  showWebglError(text) {
    if (text) this.el.webglErrorText.innerHTML = text
    this.showScreen('error')
  }

  setHealth(hp) {
    hp = Math.max(0, Math.round(hp))
    if (this.last.hp === hp) return
    this.last.hp = hp
    this.el.hpNumber.textContent = String(hp)
    this.el.hpFill.style.width = Math.max(0, Math.min(100, hp)) + '%'
    this.el.hpNumber.style.color = hp <= 30 ? '#C0432A' : ''
  }

  setAmmo(mag, magSize) {
    const key = mag + '/' + magSize
    if (this.last.ammo === key) return
    this.last.ammo = key
    this.el.ammoMag.textContent = String(mag)
    this.el.ammoMag.style.color = mag === 0 ? '#C0432A' : mag <= Math.max(1, Math.floor(magSize * 0.25)) ? '#B4761F' : ''
  }

  setWeaponName(name) {
    if (this.last.weapon === name) return
    this.last.weapon = name
    this.el.weaponName.textContent = name
  }

  setEnemies(left, total = 8) {
    const key = left + '/' + total
    if (this.last.enemies === key) return
    this.last.enemies = key
    this.el.enemiesLeft.textContent = String(left)
    this.setPips(total - left)
  }

  setTimer(seconds) {
    const s = Math.max(0, Math.floor(seconds))
    const text = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
    if (this.last.timer === text) return
    this.last.timer = text
    this.el.timer.textContent = text
  }

  setStatus(text) {
    if (this.last.status === text) return
    this.last.status = text
    this.el.status.textContent = text
  }

  setReload(progress, active, label) {
    const w = Math.round(Math.max(0, Math.min(1, progress)) * 100)
    if (this.last.reload !== w) {
      this.last.reload = w
      this.el.reloadFill.style.width = w + '%'
    }
    if (this.last.reloadActive !== active) {
      this.last.reloadActive = active
      this.el.reloadText.classList.toggle('hidden', !active)
    }
    if (active && label && this.last.reloadLabel !== label) {
      this.last.reloadLabel = label
      this.el.reloadText.textContent = label
    }
  }

  setScope(on) {
    if (this.last.scope === on) return
    this.last.scope = on
    this.el.scope.classList.toggle('hidden', !on)
    this.el.crosshair.classList.toggle('hidden', on)
  }

  setCrosshairSpread(px) {
    const v = Math.round(px)
    if (this.last.spread === v) return
    this.last.spread = v
    this.el.crosshair.style.setProperty('--spread', v + 'px')
  }

  hitMarker(head = false) {
    this.el.hitMarker.classList.remove('hidden')
    this.el.hitMarker.classList.toggle('is-head', head)
    this.el.hitMarker.classList.remove('pulse')
    void this.el.hitMarker.offsetWidth
    this.el.hitMarker.classList.add('pulse')
    this.hitTimer = 0.22
    if (head) {
      this.el.headshot.classList.remove('hidden')
      this.headTimer = 0.7
    }
  }

  damageFlash() {
    this.el.damage.classList.add('show')
    this.damageTimer = 0.16
  }

  comic(word, nx = 0.5, ny = 0.45) {
    const d = document.createElement('div')
    d.className = 'comic-word'
    d.textContent = word
    d.style.left = (nx * 100).toFixed(1) + '%'
    d.style.top = (ny * 100).toFixed(1) + '%'
    this.el.comic.appendChild(d)
    setTimeout(() => d.remove(), 900)
  }

  toast(text) {
    const d = document.createElement('div')
    d.className = 'toast'
    d.textContent = text
    this.el.toastLayer.appendChild(d)
    setTimeout(() => d.remove(), 2300)
  }

  update(dt) {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt
      if (this.hitTimer <= 0) this.el.hitMarker.classList.add('hidden')
    }
    if (this.headTimer > 0) {
      this.headTimer -= dt
      if (this.headTimer <= 0) this.el.headshot.classList.add('hidden')
    }
    if (this.damageTimer > 0) {
      this.damageTimer -= dt
      if (this.damageTimer <= 0) this.el.damage.classList.remove('show')
    }
  }

  showResult({ win, kills, time, accuracy, hits, shots, mode = 'solo' }) {
    const duel = mode === 'duel'
    this.el.resultTitle.textContent = duel ? (win ? '决斗胜利！' : '你被击倒了') : win ? '任务完成！' : '演习失败'
    this.el.resultSub.textContent = duel
      ? win ? '对手已倒下，这场决斗归你。' : '对手先一步命中。再来一局吧。'
      : win ? '日光街区已经清空，纸板小兵全部退场。' : '生命值归零，本次演习结束。再来一次吧。'
    this.el.resultKills.textContent = String(kills)
    this.el.resultTime.textContent = time
    this.el.resultAcc.textContent = Math.round(accuracy * 100) + '%'
    this.el.resultShots.textContent = hits + ' / ' + shots
    this.showScreen('result')
  }

  setMuteButtons(muted) {
    const text = muted ? '音效 关' : '音效 开'
    this.el.muteBtn.textContent = muted ? '♪̸' : '♪'
    this.el.muteBtn.classList.toggle('is-off', muted)
    this.el.muteMenu.textContent = text
    this.el.muteMenu.classList.toggle('is-off', muted)
  }

  setSelectedWeapon(id) {
    for (const card of this.el.loadoutCards) card.classList.toggle('is-active', card.dataset.weapon === id)
  }

  showLockHint(text) {
    this.el.lockToast.textContent = text
    this.el.lockHint.classList.remove('hidden')
  }

  hideLockHint() {
    this.el.lockHint.classList.add('hidden')
  }

  setCompatHint(on) {
    this.el.compatHint.classList.toggle('hidden', !on)
  }

  bind(h) {
    this.el.start.addEventListener('click', () => h.onStart())
    this.el.resume.addEventListener('click', () => h.onResume())
    this.el.restart.addEventListener('click', () => h.onRestart())
    this.el.toMenu.addEventListener('click', () => h.onMenu())
    this.el.again.addEventListener('click', () => h.onRestart())
    this.el.resultMenu.addEventListener('click', () => h.onMenu())
    this.el.pauseBtn.addEventListener('click', () => h.onPause())
    // #net 屏的按钮一律由 net-panel.js 自己绑 —— 它才是那一屏的主人。
    // 这里再绑一次会变成两套机制同时生效，一次点击跑两遍回调
    this.el.muteBtn.addEventListener('click', () => h.onMute())
    this.el.muteMenu.addEventListener('click', () => h.onMute())
    for (const card of this.el.loadoutCards) {
      card.addEventListener('click', () => h.onSelectWeapon(card.dataset.weapon))
    }
  }
}
