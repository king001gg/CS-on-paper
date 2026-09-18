---
name: run-paper-strike
description: 启动并驱动《纸上交锋 · PAPER STRIKE》这个 Vite + Three.js 网页 3D 射击 Demo —— 起开发服务器，再用仓库自带的 CDP 验收脚本跑通 37 项断言并产出整套截图，必要时再用真实浏览器手打一轮。凡是用户说「启动 / 跑起来 / 开一下 / 看看现在什么效果 / 验收一下 / 截个图 / 改完确认一下」并且指向本仓库，或者改了代码要验证游戏画面与交互是否还正常，都应当使用本技能。不要临场重新摸索启动方式：本仓库自带免依赖的 CDP 验收脚本和一套开发钩子 API，不需要装 Playwright 或任何其它浏览器自动化工具。
---

# 纸上交锋 · PAPER STRIKE —— 启动与验收

一个支持同局域网 1v1 对战的网页 3D 第一人称射击 Demo（Three.js 0.186 + Vite 8，原生 ES Modules，无 UI 框架）。
纯前端，没有后端、API key 或环境变量。

**「跑起来」有三层，先想清楚这次要哪一层：**

| 层 | 手段 | 能证明什么 | 不能证明什么 | 耗时 |
| :--- | :--- | :--- | :--- | :--- |
| A. 服务器 | `npm run dev` | 入口能解析 | 几乎什么都不能 | 秒级 |
| B. 脚本化驱动 | `node tests/browser-qa.js` | 37 项断言：战斗逻辑、HUD、胜负分支、几何、对战模式、离线保证、控制台无错 | 画面好不好看（要看截图）、真鼠标能否通关 | ~2 分钟 |
| B2. 双实例联机 | `node tests/net-qa.js` | 28 项断言：两个标签页建链、邀请码容错、面板全流程 | 跨机器 / 跨防火墙的真实连通性 | ~1 分钟 |
| C. 真实浏览器手打 | playwright-cli + 开发钩子 | 真实输入路径、手感、视觉 | 无自动化回归价值 | 分钟级 |

**默认做 A + B**，然后**读 `artifacts/` 里的截图**。
如果这次改动碰了**输入 / 指针锁定 / 渲染循环**，或用户明说「确认交互正常」，**必须加做 C** ——
B 的断言走的是钩子注入，碰不到真实事件路径。
如果改动碰了 **`src/net/` 或 `src/net-panel.js`**，**必须加做 B2** ——
B 只有单实例，看不见任何联机问题。B2 不需要第二台机器，两个标签页就够。

---

## 第 1 步：启动开发服务器

**先探活，已有服务器就直接复用，别起第二个：**

```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 http://127.0.0.1:5173/
```

- 返回 `200` → 服务器已在跑，**直接进第 2 步**，不要 `npm run dev`。
- 连不上 → 才启动：

```bash
cd <仓库根目录>
[ -d node_modules ] || npm install     # node_modules 存在就跳过；npm ci 适合全新克隆
npm run dev                            # 后台运行
```

**从输出里读取实际端口，不要假定 5173：**

```
  VITE v8.3.0  ready in 184 ms
  ➜  Local:   http://127.0.0.1:5173/
```

`vite.config.js` 是 `strictPort: false`，5173 被占用时 Vite 自动换端口。
**起第二个 server 会让你把后续验收打到错误的端口上** —— 这是复用优先的原因。

---

## 第 2 步：脚本化驱动（默认路径，别另找工具）

仓库自带基于**原生 CDP + WebSocket** 的验收脚本，零额外依赖，自动在
`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` 等标准位置找 Chrome/Edge：

```bash
node tests/browser-qa.js http://127.0.0.1:5173/ artifacts
```

**37 项断言** + 16 张截图 + `qa-report.json` 落到 `artifacts/`（已 gitignore，不脏工作区）。
**耗时约 2 分钟**（无头软渲染只有 ~16 FPS，16 张截图要一张张等），别以为卡死了。

实测输出形如（**数字仅供参考，每次跑会有出入，别把差异当回归**）：

```
✔ 页面加载并渲染标题  纸上交锋 · PAPER STRIKE
✔ 开发模式验收入口可用  debug: [vite] connecting... | connected.
✔ 准备页可见
✔ 进入游戏状态  "playing"
✔ 初始弹药为满弹匣  {"smg":30,"sniper":5}
✔ 八名敌人就位  8
✔ 冲锋枪按住连射会消耗弹药  剩余 11        ← 实测可能是 10 或其它值
✔ 狙击枪 4 倍镜生效且枪身隐藏  {"ads":true,"fov":21.7,...}
✔ 击杀统计正确  kills=8
✔ 胜利结算页出现
✔ 重开恢复初始状态  {"k":0,"hp":100,"e":8}
✔ 玩家血量归零触发失败  defeat hp=0
✔ 小窗口下 HUD 控件不互相遮挡  {"bad":false,"w":960}
✔ 决斗场地清空且双方各就各位  {"mode":"duel","e":0,...}
✔ 决斗 HUD 用对手血条换掉敌人计数
✔ 击倒对手即判决斗胜利  {"state":"victory",...}
✔ 切回单人后敌人重建、HUD 与 match 的引用全部复位
✔ 场景几何体没有 NaN 顶点  []
✔ 全程没有实例化 RTCPeerConnection（单人模式仍然完全离线）  count=0
✔ 控制台没有错误
...
通过 37/37
```

### 一定要看截图

断言全绿 ≠ 画面是对的。`artifacts/` 里的截图才是证据，**挑相关的读进来看**：

| 文件 | 内容 |
| :--- | :--- |
| `01-menu.png` | 准备页（英雄面板 + 装备卡） |
| `02-hud-firefight.png` | 战斗中的 HUD |
| `02b-birdseye.png` | 关卡鸟瞰 |
| `03-aim-enemy.png` / `03b` / `03c` | 瞄准与敌人特写 |
| `04-sniper-scope.png` | 狙击 4 倍镜 |
| `05-reloading.png` | 换弹 |
| `06-victory.png` / `08-defeat.png` | 胜负结算 |
| `07-pause.png` | 暂停 |
| `09-small-window.png` | 960px 窄窗下的 HUD |
| `10-webgl-error.png` | 禁用 WebGL 的错误分支 |
| `11-duel-hud.png` | 决斗模式的 HUD（空场地 + 右上角对手血条） |
| `12-duel-victory.png` | 决斗胜利结算 |
| `13-net-panel.png` | 对战面板（真信令已经接上） |

**空白帧 = 启动失败**，不要当成通过。

`artifacts/qa-report.json` 结构：`{ url, results, consoleErrors, consoleLogs, failedRequests }`。

### 生产模式冒烟

改了构建配置、`base`、资源路径后必做：

```bash
npm run build
npm run preview          # 另开终端保持运行，默认 4173
node tests/browser-qa.js http://127.0.0.1:4173/ artifacts --prod
```

`--prod` 跑 9 项断言：页面能进、WebGL 上下文可用、**无开发钩子入口**、无控制台错误、
资源无 HTTP 错误、无跨源第三方请求，以及在优化构建里打开对战面板并生成一个邀请码
（`PS1-` 开头）——最后这一条是为了确认**生产构建里联机代码也真的能用**，
而不是被 tree-shaking 顺手摇掉了。

---

## 第 3 步：真实浏览器手打（需要手感 / 视觉 / 真输入路径时）

### 默认是 headless —— 想让用户看见，必须显式 `--headed`

`playwright-cli open` **不带 `--headed` 时是无头模式，屏幕上根本没有窗口**。
你以为给用户开了个窗口，其实他什么都看不到，还可能反过来问你「窗口里怎么什么都没有」。
`playwright-cli list` 的 `headed:` 字段可以直接核对。

```bash
playwright-cli -s=auto open --browser=msedge --headed http://127.0.0.1:5173/
playwright-cli list        # 确认 headed: true
```

也用 `--headed` 顺便换掉无头软渲染的 ~16 FPS：真实窗口走的是系统显卡，
手感才有参考价值。代价是它**不会自动超时关闭**（`--idle-timeout` 对 headed 默认是 never），
收工必须自己关。

### 用具名会话，别动默认会话

默认会话（`default`）是共享的：不带 `-s=` 的 `open` / `close` 都作用在它上面。
自动化统一带 `-s=`，跟用户自己开的窗口互不干扰：

```bash
playwright-cli -s=auto eval "…"
playwright-cli -s=auto close          # 只关 auto
playwright-cli list                   # 看当前有哪些会话
```

**关窗口之前先问用户**，并把 URL 一并给出，方便他重新打开。

### 开局的四条必须合成一条命令

每次 `playwright-cli` 调用是独立进程，耗时 2~5 秒，而**站着不动约 25 秒就会被 8 名敌人打死**。
逐条敲必然跑不完，且**失败是静默的**（见下）。所以开局这四条一次跑完：

```bash
playwright-cli -s=auto open --browser=msedge http://127.0.0.1:5173/ >/dev/null
playwright-cli -s=auto click "getByRole('button', { name: '进入训练场' })" >/dev/null
playwright-cli -s=auto eval "window.__PAPER_STRIKE__.setGodMode(true), 'god on'" >/dev/null
playwright-cli -s=auto eval "JSON.stringify(window.__PAPER_STRIKE__.snapshot())" | grep -A1 "### Result"
```

实测：开了无敌后，8 名敌人全活的情况下血量 8 秒纹丝不动。要测真实伤害曲线就别开。

### 静默失效是一整类现象，不只是左键

`src/main.js:207` 的 mousedown 在 `state !== STATE.PLAYING` 时直接 `return`，
**事件根本没进 canvas，不报错**。鼠标观察（`mousemove`）同样被更上游的输入门挡住。

**每次输入前后都查一次 `snapshot().state`。** 否则你会去调试一个不存在的 bug
（历史上真发生过：一条「右键瞄准坏了」的假 bug，追了一轮才发现是回合已经结束）。

### `press` 只适合瞬时动作，按住类必须 `keydown`/`keyup`

**这是最容易踩的坑。** `playwright-cli press w` 是「按下即抬起」，整个落在两帧之间被完全吃掉：

```
press w           → playerPos [0,0,19] → [0,0,19]      什么都没发生，不报错
keydown w + sleep + keyup w → [0,0,19] → [0,0,16.48]   正常前进
```

而 `press 2` 切枪是**对的**（`current` 从 `smg` 变 `sniper`）—— 因为切枪只看单个 keydown 事件，
不看按住状态。**规律：离散动作（切枪、换弹、暂停）用 `press`；需要按住的（移动、连射）用
`keydown` + `sleep` + `keyup`。**

### 开发钩子 API（`window.__PAPER_STRIKE__`，仅 dev 构建）

定义在 `src/main.js` 末尾，被 `import.meta.env.DEV` 包着，**生产构建会被移除**。
共 **27 个键**，这是确认「交互是否正常」最锋利的工具，`browser-qa.js` 自己也在用：

| 方法 | 作用 |
| :--- | :--- |
| `snapshot()` | **最常用**。见下方字段表 |
| `state()` | 只要 `'menu' / 'playing' / 'paused' / 'victory' / 'defeat'` |
| `player` / `world` / `enemyManager` / `match` / `loadout` / `weaponState` | **直接暴露的活对象，可读**。`player.yaw` / `player.pitch` / `player.position` 是严格验证鼠标观察的唯一可靠手段（截图哈希不行，见下）。`loadout` 是本地持枪者的武器/后坐/统计，`weaponState` 是它的 `.weaponState` 别名 |
| `setGodMode(on)` | 关掉玩家受伤 |
| `teleport(x, z, y=0)` | 传送到坐标 |
| `faceEnemy(i=0)` | 视角对准第 i 个敌人 |
| `closeup(i=0, dist=2.8)` | 把镜头贴到敌人跟前（看模型细节） |
| `birdseye(...)` | 切俯视全景并暂停 |
| `switchTo(id)` | `'smg'` / `'sniper'` |
| `fireOnce()` / `setFire(on)` / `setAds(on)` | 不开枪地测射击 / ADS 状态 |
| `reload()` | 触发换弹 |
| `killEnemies(n)` | 直接结算 n 个，快速走到胜利分支 |
| `startDuel()` | **开一局决斗**（空场地 + 一个站着不动的本地陪练）。准备页上已经有「双人对战」走真实路径了，留着它是为了让验收脚本**不必先跑完整套邀请码交换**就能直接起局 |
| `faceOpponent()` | 视角对准决斗对手；返回 `{dx, dz, dist}`。没有对手时返回 `null` |
| `showNet()` | 打开「双人对战」面板。**必须走 `netPanel.open()`** —— 只 `ui.showScreen('net')` 会让面板停在上一次的状态上 |
| `netPanel` | 面板对象本体：`{ open, close, transport, isLinked, dispose }`。**`isLinked` 是判断「链是否真的通了」的唯一入口**，比看屏上的文字可靠 |
| `start()` / `setState(s)` / `press(code, down)` / `look(yaw, pitch)` | 底层状态注入（`look` 是**写**视角，读视角用 `player.yaw`） |

`snapshot()` 返回 20 个字段：

```
state, mode, compatMode, health, ammo{smg,sniper}, current, enemiesAlive, kills, shots, hits,
time, reloading, playerPos, enemyStates[], opponent|null, fov, ads, weaponVisible,
drawCalls, triangles
```

`mode` 是 `'solo'` / `'duel'`；决斗时 `enemyStates` 恒为 `[]`、`opponent` 为
`{name, hp, alive, x, z, hasAvatar}`，单人时 `opponent` 为 `null`。

**`compatMode` 别忽略** —— 它决定走不走指针锁定兼容分支（`src/main.js:82 / 113 / 143 / 154 / 177 / 207`
全是它的分支）。改动指针锁定 / 输入时，这是第一个该看的字段。

### `eval` 的两个坑

1. **只接受单个表达式**，CLI 会包成 `() => (…)`。多语句要写成 IIFE：
   `(() => { const s = …; return … })()`，或用逗号运算符 `a(), b()`。
2. **结果打印在 `### Ran Playwright code` 之前**，`| tail -N` 会截掉结果。
   要 `| grep -A1 "### Result"`。

### 截图

C 层要自己截，存到仓库外或用完删掉（`artifacts/` 也在 gitignore 里，但那是 B 层的地盘）：

```bash
playwright-cli screenshot --filename=/tmp/ps.png
```

**别拿截图哈希当「视角转了」的证据。** 敌人会巡逻、HUD 计时器每秒跳字，
**任意两次截图必然不同**。要证明鼠标观察生效，读 `player.yaw`：

```bash
playwright-cli eval "window.__PAPER_STRIKE__.player.yaw.toFixed(4)"   # 转鼠标前后对比
```

### 键位与按钮

游戏内：`WASD` 移动、鼠标观察、左键射击、右键瞄准、`Space` 跳、`R` 换弹、`1`/`2` 切枪、`Esc` 暂停。

- 准备页：`进入训练场`
- 暂停菜单（`index.html:145`）：`继续演习` / `重新开始` / `返回准备页`
- 结算页（`index.html:164`）：`再来一次` / `返回准备页`

**右键必须用位置参数**：`playwright-cli mousedown right`。
写成 `--button=right` **不报错也不生效**，会白追一个假 bug。
实测 ADS：`fov` 75 → **21.7**（狙击 4 倍镜）、`weaponVisible` true → false，松开还原。

### 一条已经推翻的旧结论

早前一轮测试里真实点击的 `hits` 长期是 0，当时写下「真鼠标能否通关未经证实」。
**这个结论是错的，已推翻。** 后续实测真实左键点击拿到 `shots=31, hits=2, kills=1`，
敌人 8→7 —— **真实 click → 命中判定 → 击杀这条链路是通的**。

`hits` 低是**瞄准与遮挡**问题（纸板敌人会移动、掩体多），**与输入路径无关**。
排查输入相关改动时不要被这个数字带偏。

仍然成立的边界：`browser-qa.js` 用钩子直接设位置、直接结算胜负，它的 37 项断言
**不等同于完整清场一次**；「真鼠标从头到尾打通关」没有被自动化覆盖，别在报告里说成已验证。
决斗那几条同理 —— 它们走的是 `startDuel()` 钩子，**不等于两人各坐一台电脑真打一局**。

联机那 28 项同理，而且它的边界更值得说清楚：`net-qa.js` 跑的是**同一台机器上的两个标签页**，
连的还是 `127.0.0.1`。它证明的是「代码路径是通的」，**不证明跨机器、跨防火墙、mDNS 环境下能连上**。
唯一能证明后者的办法是两台电脑真连一次（`npm run dev:lan` + 手机热点/同一路由器）。
**别拿 B2 全绿去回答「能联机吗」这个问题。**

---

## 已知的坑

- **`--browser=chrome` 失败**：本机没装 Chrome，报 `Chromium distribution 'chrome' is not found`。
- **`--browser=chromium` 也失败**：Playwright 缓存的是 `chromium-1234`，新版 CLI 要 `chromium-1244`，
  报 `Browser "chrome-for-testing" is not installed`。别去下那个 ~150MB 的浏览器，
  **直接用系统已装的 Edge（`--browser=msedge`）**。
- **`@playwright/cli` 可能没装**（本机已装）：第 3 步才需要，`npm install -g @playwright/cli@latest`。
  第 2 步的 CDP 脚本不需要它 —— 这也是默认走第 2 步的原因。
- **验收日志尾部的 `error: THREE.WebGLRenderer: Error creating WebGL context.` 是预期的**，
  来自最后一项故意禁用 WebGL 的负向测试，不是回归。
- **无头软件渲染约 16 FPS**（历史数据 8–10 FPS），是 SwiftShader 软渲染的锅，别据此下性能结论。
- **暂停不是绝对静止**：暂停挡掉玩家操作与伤害结算，但敌人 AI 的完整冻结有已知状态传递边界。
- **两个 CDP 脚本用的是不同端口**（`browser-qa` 9444 / `net-qa` 9445），**可以同时跑**。
  但别把两条命令写在同一个终端前后台里 —— 各开一个终端。
- **`net-qa.js` 必须带 `--disable-features=WebRtcHideLocalIpsWithMdns`**，脚本自己会加。
  Chrome 默认把 host candidate 里的局域网 IP 换成随机 `.local` 域名，同机两个标签页经常解析不到，
  表现为「拿到了候选但就是连不上」。**别把这个 flag 挪到 `browser-qa.js` 去**，那边不需要它。
- **`net-qa.js` 报「这段文本不是有效的应战码」时，先怀疑折行位置**，别怀疑编码本身：
  邀请码是 64 列折行的，如果 `-END` 正好被折行劈开、而聊天软件又在折行处插了引用符号，
  后缀就会断成 `-` + `> ` + `END`。`signaling.test.js` 里有一条穷举每一个折行位置的回归测试。
  这类 bug **是数据相关的**——同一段码有时能解有时不能，所以「跑一遍通过」不算数，
  要连着跑几遍。
- **准备页的按钮在启动完成前是 `disabled` 的**，`main.js` 绑完事件才解禁。
  C 层手测时如果 `open` 之后立刻 `click`，可能点在还没解禁的按钮上——**不报错，只是没反应**，
  跟「左键静默失效」是同一类现象。稳妥做法是先 `eval` 一下
  `document.getElementById('btn-start').disabled`，等到 `false` 再点。
  线上 Pages 冷启动实测约 9 秒才解禁（本地 dev 约 0.6 秒），别按本地的直觉估时间。
- **别用固定 sleep 等页面就绪**。`browser-qa.js` 早先写死 `sleep(3500)`，本地够用，
  对线上 Pages 却在按钮绑定之前就点了下去——生产冒烟因此稳定假失败一项。
  现在改为轮询 `#btn-start` 的 `disabled`。自己写临时脚本时照做。
- 首次 `npm install` 约 30 秒 / 16 个包。

## 清理

**关浏览器窗口前先问用户** —— headed 会话正是他在看的那个窗口（见第 3 步）。
收工时把 `-s=` 会话关掉，并在回复里给出 URL，方便他重新打开。

第 2 步产物在 `artifacts/`（已 gitignore），可留可删。
第 3 步的截图和 `.playwright-cli/` **不在 gitignore 里** —— 收工删掉，别把截图提交进仓库：

```bash
rm -rf .playwright-cli
git status --short     # 干净，或只剩你自己有意的改动
```

dev server 是后台进程，收工前确认是否要停掉。注意 `TaskStop` 杀不掉 Vite 的子进程，
要按端口找 PID：

```bash
netstat -ano | grep ":5173" | grep LISTENING     # 取最后一列的 PID
taskkill //PID <pid> //F
```

## 相关文档

- `docs/TECHNICAL.md` —— 本地运行、部署、战斗数值、安全、验收方法、已知限制（权威来源）
- `tests/browser-qa.js` —— 单实例验收脚本本体，469 行，断言清单看这里
- `tests/net-qa.js` —— 双标签页联机验收，476 行。**它跟 `browser-qa.js` 的 CDP 接法不一样**
  （每个 tab 一条独立的页面级 WebSocket，而不是 `sessionId` 穿透），改之前先读它的头部注释
- `README.md` —— 项目介绍与游玩说明
