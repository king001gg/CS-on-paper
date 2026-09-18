# 技术文档 · PAPER STRIKE

[返回项目介绍](../README.md) · [Prompt 参考](../RECREATE_PROMPT.md) · [部署记录](https://github.com/king001gg/CS-on-paper/actions/workflows/pages.yml)

> 项目已停止更新与维护。本文保留工程、部署、安全与验收细节，仅供学习、复现或自行 fork 参考，不代表后续维护承诺。

## 技术概览

- HTML + JavaScript ES Modules + Three.js 0.186.0 + Vite 8.3.0，无额外 UI 框架与游戏后端。
- 代码搭建几何体，Canvas 2D 绘制贴图，SVG/CSS 绘制界面，Web Audio 合成音效；没有外链引擎、字体、模型、图片或音频。
- 敌人采用固定导航图与路径采样绕障，命中使用简化几何体判定；具体边界见下文“尚未确认与实现取舍”。
- 支持**同局域网的 1v1 对战**，信令是手动复制粘贴一段邀请码，不经过任何后端或第三方服务；对局形式是空场地的单挑，那 8 名 AI 敌人只在单人模式下出现。
- 页面只从当前站点获取构建资源，不请求第三方 CDN、分析服务或游戏后端。单人模式全程零外部请求，并且这一点由 `tests/browser-qa.js` 的一条断言守着（未打开对战面板时不实例化 `RTCPeerConnection`）。对战模式默认同样零外部请求，只有在使用者主动填入 STUN 地址时才会去连那台服务器。首次加载 GitHub Pages 需要网络；没有 Service Worker，不承诺断网后仍能刷新页面。
- **准备页的控件在启动完成前是 `disabled` 的**。`main.js` 的模块体里，bundle 下载之后还有贴图生成、关卡构建、8 名敌人建模等同步工作，`ui.bind()` 在全部结束之后才执行——冷启动时这段有数秒（线上 Pages 实测约 9 秒，本地约 0.6 秒）。`index.html` 里把这五个控件写成 `disabled`，`main.js` 绑完事件再统一解禁，用户看到的是灰着的按钮而不是一个「点了没反应」的按钮。这也顺带给验收脚本提供了唯一的就绪信号（见下文浏览器验收）。

以下文件路径及命令均以**仓库根目录**为基准。

## 本地运行

推荐 **Node.js 24 + npm**，版本提示见 `.node-version`。Vite 要求 Node `^20.19.0 || >=22.12.0`；浏览器验收脚本使用全局 WebSocket，建议直接用 Node 24。

```bash
git clone https://github.com/king001gg/CS-on-paper.git
cd CS-on-paper
npm ci
npm run dev
```

打开终端显示的地址，默认是 **http://127.0.0.1:5173/**。端口被占用时 Vite 会选择下一个可用端口。开发、预览默认只监听 `127.0.0.1`，不会暴露到局域网。

想做**两台电脑联机对战**时，需要让第二台机器能访问到这个页面，用：

```bash
npm run dev:lan        # 等价于 vite --host，会监听所有网卡
```

⚠️ **`dev:lan` 会把整个开发服务器暴露给所在局域网**，同网段的任何人都能打开它，并且拿到开发钩子（`window.__PAPER_STRIKE__`，可以直接改血量、传送、结算胜负）。**只在可信网络下使用**，用完就关掉。Windows 首次运行还会弹出防火墙授权，需要放行。

局域网地址是 `http://<你的局域网IP>:5173/`（`ipconfig` 里那个 `IPv4 地址`）。注意这个地址**不是安全上下文**，`navigator.clipboard` 在此不可用——复制按钮已为此做了回退，见下文。

`npm run dev`（不带 `--host`）的默认行为**没有改动**，仍然是只监听 `127.0.0.1`。

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装，适合克隆后或 CI 使用 |
| `npm install` | 常规依赖安装；变更依赖时同时提交锁文件 |
| `npm run dev` | 本地开发服务器（仅本机） |
| `npm run dev:lan` | 开发服务器，监听所有网卡供局域网内其它机器访问 ⚠️ |
| `npm test` | Node 单元/逻辑测试 |
| `npm run build` | 构建到 `dist/` |
| `npm run preview` | 本地预览 `dist/`，默认 http://127.0.0.1:4173/ |
| `npm run check:publish` | 扫描 Git 暂存区中的实际待提交内容 |
| `npm run check:publish -- --dist` | 扫描生产产物，并检查没有开发入口或 source map |

```bash
npm test
npm run build
npm run preview
```

`dist/` 可由任意静态 HTTP 服务托管。不能通过双击开发用 `index.html` 运行 ES Modules 工程。安装依赖需要连接 npm；游戏本身不需要 API key、环境变量或后端服务。

## GitHub Pages 部署

公开地址：**https://king001gg.github.io/CS-on-paper/**

工作流位于 [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)：

1. 推送到 `main`，或在 Actions → **Deploy to GitHub Pages** → **Run workflow** 手动触发。
2. GitHub 的 Ubuntu runner 使用 Node 24，先扫描已提交文件，再运行 `npm ci`、`npm test`、`npm run build`。
3. 扫描 `dist/`，仅将该目录上传为 Pages artifact。
4. 部署作业通过 `github-pages` environment 发布。Pull Request 只验证和构建，不发布。

仓库 **Settings → Pages → Build and deployment → Source** 应为 **GitHub Actions**，不需要 `gh-pages` 分支，也不需要将 `dist/` 或 `node_modules/` 提交到仓库。

- Vite 使用 `base: './'`，资源路径适配 `/CS-on-paper/` 项目子目录。此 Demo 无客户端路由，也无需 404 重写。
- Actions 固定到完整提交 SHA。构建作业仅需 `contents: read`、`pages: read`；部署作业仅额外使用 `pages: write` 与 `id-token: write`。
- 发布使用 GitHub Actions 自动提供的短期身份，不需要在源码或仓库 Secrets 中保存个人访问令牌。
- 首次部署和后续更新都以 Actions 的成功状态及 Pages 返回的地址为准；无需本机开发服务器长期运行。
- 若 fork 到其它账号/仓库，需在 fork 中启用 Actions 与 Pages，并更新 README、`package.json` 中的公开链接。

## 安全与提交范围

发布只包含源码、公开文档、测试、锁文件及工作流。`.gitignore` 排除了本机环境文件、包管理器认证配置、私钥、依赖目录、构建目录、浏览器截图/日志与验收报告。不要强制添加这些被忽略的内容。

提交前建议：

```bash
git add <准备提交的源码文件>
git diff --cached --stat
npm run check:publish
```

`scripts/check-publish.mjs` 扫描 **Git 暂存内容**（而非仅工作区），检查常见令牌/私钥格式、授权头、带凭据 URL、硬编码密钥、个人目录路径、私人邮箱，以及不应发布的文件类型。命中时只打印文件名、行号和类型，不回显可疑值。CI 对源码和生产产物重复检查。规则扫描不是穷尽性安全保证，仍需人工审查提交清单。

锁文件使用 npm 官方下载地址并保留 integrity 校验。页面无账号、数据上传或遥测代码；调试浏览器配置和截图保留在本机，不随 Git 推送。提交者可使用 GitHub noreply 邮箱，避免在公开 Git 元数据中暴露私人邮箱。

**注意**：`VITE_*` 环境变量会被编译进前端，绝不能用来保存秘密。若误提交凭据，应立即撤销/轮换，而不是只在后续提交中删除字符串。

### 联机带来的额外边界

- **绝不要把真实抓包的邀请码 / 应战码提交进仓库。** 那段字符串解出来就是完整 SDP，里面有 `c=IN IP4 <你的局域网IP>` 这样的候选地址，等于把内网拓扑写进公开 Git 历史。测试夹具一律用合成数据，地址用 RFC 5737 保留给文档的 `192.0.2.0/24`（`src/net/signaling.test.js` 的 `fakeSdp()` 就是这么做的）。
- **绝不在代码里硬编码 STUN/TURN 地址。** 面板上有一个可选的输入框，地址由使用者自己填写；`parseStunList()` 只接受 `stun:` / `stuns:` 开头的值，避免这个输入框变成「页面往任意地址发请求」的口子。默认留空，也就是零外部请求。
- **`dev:lan` 会把开发钩子暴露给整个局域网**（见「本地运行」）。开发钩子能直接改血量、传送、结算胜负。
- **WebRTC 走 UDP，CDP 的 `Network.requestWillBeSent` 看不见它。** 因此单实例验收里那条「无跨源第三方请求」断言，在引入联机之后**不再能证明页面是离线的**。替代品是一条新断言：**未打开对战面板时全程不实例化 `RTCPeerConnection`**（`tests/browser-qa.js` 用一个注入的哨兵计数）。也就是说，「单人模式仍然完全离线」依然是个可证命题，只是证明方式换了。

## 武器与战斗数值

| 项目 | 蜂鸟 · 冲锋枪 `smg` | 长鸣 · 狙击枪 `sniper` |
| --- | --- | --- |
| 射击 | 按住连射，间隔 0.1 秒 | 每次按下一发，间隔 1.2 秒 |
| 弹匣 / 备弹 | 30 / 无限 | 5 / 无限 |
| 身体 / 爆头伤害 | 20 / 40 | 100 / 200 |
| 换弹 | 1.5 秒 | 2.2 秒 |
| 腰射 / 瞄准散布 | 0.022 / 0.006 | 0.032 / 0.00035 |
| 瞄准 | 轻微放大 | 圆形 4 倍镜，降低灵敏度 |

每名敌人 80 生命；命中玩家造成 10 点伤害。玩家移动速度约 5.5 m/s，瞄准约 3.25 m/s；跳跃初速 6.4 m/s，重力 18 m/s²，台阶容差 0.35 m。基础垂直 FOV 为 75°。

4 倍镜按投影放大公式计算：`2 * atan(tan(baseFov / 2) / 4)`，即约 **21.7°**。换弹时退出瞄准显示；重复换弹请求不重置进度，切枪取消未完成的换弹并保留弹量。

## 项目结构

```text
.github/workflows/pages.yml  GitHub Pages 构建与发布
.node-version               Node 24
index.html                  准备页、HUD、暂停与结算
package.json / package-lock.json
README.md                   项目介绍与游玩说明
docs/TECHNICAL.md           技术、部署、安全与验收说明
RECREATE_PROMPT.md          完整复刻 Prompt（描述当前交付形态）
vite.config.js              本地服务与相对资源路径
public/favicon.svg          程序绘制图标
src/
  main.js                   渲染循环、游戏状态与各模块的接线
  world.js                  关卡、碰撞、导航、场景与描边
  sketch.js / textures.js   固定种子手绘工具和 Canvas 贴图
  player.js                 视角、移动、跳跃与碰撞
  input.js                  输入采样；本地 / 远端 / 脚本三种输入源
  loadout.js                一个持枪者的全部状态：武器、弹药、后坐力、HUD
  match.js                  角色注册、模式规则、胜负判定（无 DOM，可单测）
  player-rig.js             远端玩家的可视化身与动画
  weapon-state.js           弹量、冷却、换弹与伤害逻辑（与持有者无关）
  weapons.js                第一人称纸板枪、动作与独立渲染
  enemies.js                角色、AI、寻路与伤害
  combat.js                 射线判定与特效
  audio.js                  Web Audio 合成音效
  ui.js / style.css         界面与草图风样式
  net-panel.js              双人对战面板：邀请码流程与连接状态
  net/
    protocol.js             报文字段、长度上限与版本门槛
    transport.js            传输接口 + 回环 / BroadcastChannel 两种实现
    rtc-transport.js        WebRTC 实现（唯一允许 new RTCPeerConnection 的地方）
    signaling.js            邀请码的编解码与容错、连接失败的人话解释
  *.test.js                 游戏逻辑测试
scripts/
  check-publish.mjs          脱敏输出的提交/产物扫描
  check-publish.test.mjs     扫描规则测试
tests/browser-qa.js         可选 CDP 浏览器验收（单实例）
tests/net-qa.js             可选 CDP 双标签页联机验收
```

Three.js **0.186.0** / Vite **8.3.0** / 原生 JavaScript ES Modules；不使用额外 UI 框架。

## 验证与复现

### 单元测试

当前测试集包含 **149 项游戏逻辑测试 + 3 项发布扫描测试**（共 152 项）。涉及武器冷却与换弹、伤害与射线遮挡、玩家碰撞、导航连通性、八个出生点到入口/高台的路径、两个决斗出生点的合法性与互不可见、输入抽样与边沿消费、角色注册与胜负判定，以及 AI 的部分行为；另有 38 项覆盖联机模块（报文字段与版本门槛、传输接口、邀请码编解码容错、WebRTC 实现）。运行 `npm test` 查看最新结果。测试通过并不等于所有交互边界都已覆盖。

### 浏览器验收

另开终端启动开发服务器，再运行：

```bash
node tests/browser-qa.js http://127.0.0.1:5173/ artifacts
```

生产模式应先 `npm run build`，并在另一个终端保持 `npm run preview` 运行：

```bash
node tests/browser-qa.js http://127.0.0.1:4173/ artifacts --prod
# 对公开 Pages 地址执行同样的生产冒烟检查
node tests/browser-qa.js https://king001gg.github.io/CS-on-paper/ artifacts/pages --prod
```

验收脚本默认查找 Windows 的标准 Chrome/Edge 安装位置；其它位置或 macOS/Linux 需通过 `PS_BROWSER` 指定浏览器可执行文件。`PS_CDP_PORT` 可覆盖调试端口，默认 9444。脚本只清理自身创建的临时浏览器 profile。

脚本**不用固定 sleep 等页面就绪**，而是轮询 `#btn-start` 何时不再 `disabled`（即上面那条「准备页控件」的就绪信号）。这不是洁癖：早先写死 `sleep(3500)`，在本地 0.6 秒就绪时够用，对线上 Pages 却会在按钮绑上事件之前就点下去——合成点击落在没有监听器的按钮上**不报错、也不抛异常**，只表现为「点了没反应」，于是生产冒烟稳定地假失败一项。任何按固定时长等待页面就绪的验收脚本都会有这个毛病。

既有开发验收流程包含 **37 项断言**，生产冒烟流程包含 **9 项断言**，生成截图与 JSON 报告到指定输出目录（不入 Git）。开发流程使用开发钩子设置位置/状态、触发部分胜负条件；这验证的是相关功能路径，**不等同于通过真实鼠标操作完整清场一次**。其中 7 项覆盖决斗模式（空场地、出生点、对手血条、击倒判胜、模式往返重建），但它们同样是靠 `startDuel()` 钩子起局，**不等于两人各一台电脑真打一局**。生产检查验证页面能进入、WebGL 上下文可用、无开发入口、无控制台错误、资源无 HTTP 错误且无跨源第三方请求，并在优化构建里跑一遍对战面板的邀请码生成。故意禁用 WebGL 的错误分支测试会产生预期渲染错误。

**另有一套双实例联机验收**（`tests/net-qa.js`，28 项断言），开两个标签页跑通整条联机路径：

```bash
node tests/net-qa.js http://127.0.0.1:5173/ artifacts
```

它用真实代码路径建两条链：`BroadcastChannel` 一条（验证上层收发，与 WebRTC 无关），以及 WebRTC 一条（走完整的手动 SDP 交换）。**邀请码在传递途中会被故意破坏**——折行换成 `\r\n`、`-` 全换成 `—`、前后加上聊天记录、每行加 `>` 引用符号——用来替代「在微信里手工转发一遍」这个动作。最后还会以用户的身份点完整个面板流程（选身份 → 复制邀请码 → 生成应战码 → 应用 → 进入决斗场地）。

它能证明的是**代码路径是通的**，不能证明的是：跨机器、真实局域网、防火墙与 mDNS 环境下的连通性。那些只能靠两台机器人工验（见 `run-paper-strike` 技能的第 3 步）。脚本需要浏览器支持 WebRTC，并会带上 `--disable-features=WebRtcHideLocalIpsWithMdns`——Chrome 默认把 host candidate 里的局域网 IP 换成随机 `.local` 域名，同机两个标签页之间经常解析不到，表现为「有候选但连不上」。

### 尚未确认与实现取舍

- 历史无头 SwiftShader 软件渲染约 8–10 FPS；不能据此承诺真实设备上 60 FPS。需在自己的显卡和浏览器上体验。
- 无头验收主要走 Pointer Lock 兼容分支；真实指针锁定手感和音频听感需要手动确认。
- 自动验收与截图不构成全面的视觉、可访问性或游戏平衡验证。
- 当前暂停状态阻止玩家操作与伤害结算，但敌人 AI 的完整冻结仍有未解决的状态传递边界；不要将暂停视为整个场景绝对静止。
- 命中判定使用简化头部/躯干椭球，不是逐像素匹配角色姿态与肢体动画。
- 高台使用 8 级缓台阶与台阶吸附，视觉为阶梯坡道，并非连续斜面。
- 远景建筑只用于画面层次，不参与碰撞导航。
- **联机只做到了「通道打通」**：两端能建链、能互发报文，但游戏里还没有任何同步——对手不会真的出现在你的场上。位置同步与命中判定是下一步，两个玩家现在各自进入自己的空场地。
- **联机只能同局域网**。`iceServers` 默认是空数组，也就是不借助任何 STUN/TURN 服务器，全程零外部请求；代价是只有 host candidate，两台机器必须连在同一个路由器下。面板留了一个可选的自定义 STUN 输入框，地址由使用者自己提供，**本项目不内置、不推荐任何第三方服务器**。
- **手动复制粘贴邀请码是永久摩擦**。这条路上没有任何自动化可以消除它：聊天软件会折行、加引号、把 `--` 转成 `—`、在折行处插引用符号。`src/net/signaling.js` 用 base64url + deflate + 前后缀 + 64 列折行 + 容错解码把它压到「约 650 字符 / 10 行，一条消息发得下」，但**首次交换仍然可能失败**，失败时请用面板上的「复制诊断信息」把线索带出来。
- **`navigator.clipboard` 在局域网 http 下不存在**。`http://127.0.0.1` 算安全上下文，`http://192.168.x.x` 不算——而后者正是两机联机时打开的地址。所以复制按钮走的是 `document.execCommand('copy')` 回退，两条路都不通时会明确告诉用户手动 Ctrl+C，而不是静默失败。
- **联机验收没有覆盖真实跨机连通性**。`tests/net-qa.js` 跑的是同一台机器上的两个标签页；跨机器、跨防火墙、mDNS 环境下的表现没有被任何自动化覆盖。

## 常见问题

- **Pages 404 或未更新**：检查工作流是否成功、Pages Source 是否为 GitHub Actions、地址是否包含 `/CS-on-paper/`。部署完成后再刷新；不要将源码目录当成 Pages artifact。
- **黑屏或 3D 错误提示**：使用新版桌面 Chrome/Edge，开启硬件加速与 WebGL 2；可查看浏览器控制台定位显卡相关问题。
- **鼠标没有被锁定**：直接打开站点而非内嵌预览；或使用兼容模式。失焦后通过继续按钮恢复。
- **没有声音**：先点击进入训练场，再检查顶部音效开关、浏览器标签页静音和系统音量。
- **构建失败**：使用 Node 24，运行 `npm ci`；不要只复制单个平台的 `node_modules` 到其它机器。
- **提交扫描失败**：先检查所报文件/行号；不要为了通过部署而把凭据加入白名单。
