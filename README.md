# 纸上交锋 · PAPER STRIKE

[![Deploy to GitHub Pages](https://github.com/moeyui1/CS-on-paper/actions/workflows/pages.yml/badge.svg)](https://github.com/moeyui1/CS-on-paper/actions/workflows/pages.yml)

**[在线试玩 → https://moeyui1.github.io/CS-on-paper/](https://moeyui1.github.io/CS-on-paper/)** · [源码](https://github.com/moeyui1/CS-on-paper) · [部署记录](https://github.com/moeyui1/CS-on-paper/actions/workflows/pages.yml) · [反馈问题](https://github.com/moeyui1/CS-on-paper/issues)

一个单人、单关卡的网页 3D 第一人称射击 Demo。用纸板枪，在涂鸦本般的「日光街区」清除 **8 名敌人**。大头小豆人、手绘轮廓、暖黄／橘红／青绿配色；不是静态截图或场景展示。

## 游戏内容

- **可以交战的训练场**：WASD 移动、鼠标观察、射击、瞄准、跳跃、换弹与切枪。生命值 100，无自动恢复；清除全部敌人获胜，生命归零失败。
- **两把随身武器**：蜂鸟冲锋枪与长鸣狙击枪，准备页选择开场装备；弹匣有限、备弹无限，弹量和冷却独立保存。
- **日光街区**：约 46 × 50 米，中央庭院、左右侧路、掩体、拱门，以及 2.5 米东侧高台。
- **敌人 AI**：巡逻、发现预警、交战、追击和搜索最后发现位置；固定导航图与路径采样用于绕障。
- **反馈与界面**：弹道、弹孔、纸片碎屑、命中标记、漫画文字、生命条、八格进度、暂停和胜负结算。
- **程序化资源**：代码搭建几何体，Canvas 2D 绘制贴图，SVG/CSS 绘制界面，Web Audio 合成音效；没有外链引擎、字体、模型、图片或音频。

游戏页面只从当前站点获取构建资源，不请求第三方 CDN、分析服务或游戏后端。首次加载 GitHub Pages 需要网络；此项目没有 Service Worker，不承诺关闭网络后仍能刷新页面。

## 浏览器与设备要求

推荐桌面版 Chrome / Edge、键盘与鼠标，并开启硬件加速和 WebGL 2。不包含移动端触控、联机、存档或账号系统。进入游戏时请求 Pointer Lock；浏览器不允许时会提供兼容控制。不支持 WebGL 2 时显示错误说明。

## 操作

| 操作 | 输入 |
| --- | --- |
| 移动 | `W` `A` `S` `D` |
| 观察 | 鼠标移动 |
| 射击 | 鼠标左键 |
| 瞄准 | 按住鼠标右键 |
| 跳跃 | `Space` |
| 换弹 | `R` |
| 切枪 | `1` / `2` 或滚轮 |
| 暂停、释放鼠标 | `Esc`，或顶部暂停按钮 |
| 静音 / 开启音效 | 顶部音效按钮 |

**兼容模式**：拖动鼠标观察，方向键转向，`F` 射击，`T` 切换瞄准；移动、跳跃和换弹不变。若在内嵌预览里操作受限，请直接打开在线试玩地址。

## 本地运行

推荐 **Node.js 24 + npm**，版本提示见 `.node-version`。Vite 要求 Node `^20.19.0 || >=22.12.0`；浏览器验收脚本使用全局 WebSocket，建议直接用 Node 24。

```bash
git clone https://github.com/moeyui1/CS-on-paper.git
cd CS-on-paper
npm ci
npm run dev
```

打开终端显示的地址，默认是 **http://127.0.0.1:5173/**。端口被占用时 Vite 会选择下一个可用端口。开发、预览默认只监听 `127.0.0.1`，不会暴露到局域网。

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装，适合克隆后或 CI 使用 |
| `npm install` | 常规依赖安装；变更依赖时同时提交锁文件 |
| `npm run dev` | 本地开发服务器 |
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

公开地址：**https://moeyui1.github.io/CS-on-paper/**

工作流位于 [`.github/workflows/pages.yml`](.github/workflows/pages.yml)：

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
vite.config.js              本地服务与相对资源路径
public/favicon.svg          程序绘制图标
src/
  main.js                   输入、渲染循环与游戏状态
  world.js                  关卡、碰撞、导航、场景与描边
  sketch.js / textures.js   固定种子手绘工具和 Canvas 贴图
  player.js                 视角、移动、跳跃与碰撞
  weapon-state.js           弹量、冷却、换弹与伤害逻辑
  weapons.js                第一人称纸板枪、动作与独立渲染
  enemies.js                角色、AI、寻路与伤害
  combat.js                 射线判定与特效
  audio.js                  Web Audio 合成音效
  ui.js / style.css         界面与草图风样式
  *.test.js                 游戏逻辑测试
scripts/
  check-publish.mjs          脱敏输出的提交/产物扫描
  check-publish.test.mjs     扫描规则测试
tests/browser-qa.js         可选 CDP 浏览器验收
```

Three.js **0.186.0** / Vite **8.3.0** / 原生 JavaScript ES Modules；不使用额外 UI 框架。

## 验证与复现

### 单元测试

当前测试集包含 **56 项游戏逻辑测试 + 3 项发布扫描测试**。涉及武器冷却与换弹、伤害与射线遮挡、玩家碰撞、导航连通性、八个出生点到入口/高台的路径，以及 AI 的部分行为。运行 `npm test` 查看最新结果。测试通过并不等于所有交互边界都已覆盖。

### 浏览器验收

另开终端启动开发服务器，再运行：

```bash
node tests/browser-qa.js http://127.0.0.1:5173/ artifacts
```

生产模式应先 `npm run build`，并在另一个终端保持 `npm run preview` 运行：

```bash
node tests/browser-qa.js http://127.0.0.1:4173/ artifacts --prod
# 对公开 Pages 地址执行同样的生产冒烟检查
node tests/browser-qa.js https://moeyui1.github.io/CS-on-paper/ artifacts/pages --prod
```

验收脚本默认查找 Windows 的标准 Chrome/Edge 安装位置；其它位置或 macOS/Linux 需通过 `PS_BROWSER` 指定浏览器可执行文件。`PS_CDP_PORT` 可覆盖调试端口，默认 9444。脚本只清理自身创建的临时浏览器 profile。

既有开发验收流程包含 **29 项断言**，生产冒烟流程包含 **7 项断言**，生成截图与 JSON 报告到指定输出目录（不入 Git）。开发流程使用开发钩子设置位置/状态、触发部分胜负条件；这验证的是相关功能路径，**不等同于通过真实鼠标操作完整清场一次**。生产检查验证页面能进入、WebGL 上下文可用、无开发入口、无控制台错误、资源无 HTTP 错误且无跨源第三方请求。故意禁用 WebGL 的错误分支测试会产生预期渲染错误。

### 尚未确认与实现取舍

- 历史无头 SwiftShader 软件渲染约 8–10 FPS；不能据此承诺真实设备上 60 FPS。需在自己的显卡和浏览器上体验。
- 无头验收主要走 Pointer Lock 兼容分支；真实指针锁定手感和音频听感需要手动确认。
- 自动验收与截图不构成全面的视觉、可访问性或游戏平衡验证。
- 当前暂停状态阻止玩家操作与伤害结算，但敌人 AI 的完整冻结仍有状态传递边界待修复；不要将暂停视为整个场景绝对静止。
- 命中判定使用简化头部/躯干椭球，不是逐像素匹配角色姿态与肢体动画。
- 高台使用 8 级缓台阶与台阶吸附，视觉为阶梯坡道，并非连续斜面。
- 远景建筑只用于画面层次，不参与碰撞导航。

## 常见问题

- **Pages 404 或未更新**：检查工作流是否成功、Pages Source 是否为 GitHub Actions、地址是否包含 `/CS-on-paper/`。部署完成后再刷新；不要将源码目录当成 Pages artifact。
- **黑屏或 3D 错误提示**：使用新版桌面 Chrome/Edge，开启硬件加速与 WebGL 2；可查看浏览器控制台定位显卡相关问题。
- **鼠标没有被锁定**：直接打开站点而非内嵌预览；或使用兼容模式。失焦后通过继续按钮恢复。
- **没有声音**：先点击进入训练场，再检查顶部音效开关、浏览器标签页静音和系统音量。
- **构建失败**：使用 Node 24，运行 `npm ci`；不要只复制单个平台的 `node_modules` 到其它机器。
- **提交扫描失败**：先检查所报文件/行号；不要为了通过部署而把凭据加入白名单。
