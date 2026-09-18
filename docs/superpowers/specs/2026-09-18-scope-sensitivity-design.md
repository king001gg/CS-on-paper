# 狙击镜灵敏度按倍率缩放 —— 设计规格

日期：2026-09-18
状态：已批准设计，待实现

## 目标

让开镜后的转向灵敏度随倍率缩放，使「开镜」成为一次真实的取舍：保留跟枪手感，但显著提高转身扫视的代价。方向是**增加操控代价**，不是加剧视野狭窄。

## 非目标

- 不改视野（`fov`）、暗角半径或任何视觉呈现。
- 不加瞄准抖动、屏息、举镜耗时、移动惩罚 —— 这些维度经讨论后明确排除。
- 不改冲锋枪的基准灵敏度设计意图（虽然会产生一个可接受的副作用，见下）。

## 背景：为什么要改

当前 `src/main.js:241` 对所有开镜状态使用**固定** `0.45` 倍灵敏度，不区分武器、不随倍率变化：

```js
const sens = baseSensitivity() * (player.ads ? 0.45 : 1)
```

4 倍镜下这导致：准星在屏幕上移动过快，微调困难；同时转身扫视又不够慢，「开镜」几乎没有机会成本。

## 核心公式

monitor-distance 匹配 —— 准星在**屏幕上的**移动距离与不开镜时保持一致：

```
sens_ads / sens_hip = tan(adsFov / 2) / tan(baseFov / 2)
```

本项目 `scopeFov` 的定义（`src/weapon-state.js:188`）是 `2·atan(tan(base/2)/zoom)`，
即上述 tan 公式的**精确反函数**。因此对走狙击镜路径的武器，该比例恒等于 `1 / adsZoom`。

**选择 tan 比例而非简单除以倍率的理由**：一个公式同时正确覆盖两条 adsFov 计算路径
（`adsZoom >= 2` 走 `scopeFov`，否则走线性 `adsFovScale`），无需 `if (scoped)` 分支。

## 改动

### 1. `src/weapon-state.js` —— 新增纯函数

```js
/** 开镜灵敏度缩放比例：monitor-distance 匹配 */
export function adsSensitivityScale(state, baseFovDeg) {
  const base = (baseFovDeg * Math.PI) / 180
  const ads = (adsFov(state, baseFovDeg) * Math.PI) / 180
  return Math.tan(ads / 2) / Math.tan(base / 2)
}
```

放这里的理由：`weapon-state.js` 是该项目的纯逻辑模块（不碰 DOM / Three.js），
`adsFov` / `scopeFov` 已在此，且已有 `weapon-state.test.js` 可做确定性单测。

### 2. `src/main.js` —— 提出常量并接入

魔数 `0.45` 提为具名常量（`BASE_FOV` 附近，`src/main.js:16`）：

```js
const ADS_SENSITIVITY = 0.45
```

`src/main.js:241` 改为：

```js
const sens = baseSensitivity() *
  (player.ads ? ADS_SENSITIVITY * adsSensitivityScale(weaponState, BASE_FOV) : 1)
```

## 具体数值

输入常量：`baseSensitivity() = 0.0021` rad/px，`BASE_FOV = 75`。

| 状态 | adsFov | 缩放比例 | 有效 sens | 100px 横移转过 |
| :--- | :--- | :--- | :--- | :--- |
| 不开镜 | 75° | 1 | 0.0021 | 12.03° |
| 狙击开镜（改前） | 21.7179° | — | 0.00135 (=0.45 固定) | 5.41° |
| **狙击开镜（改后）** | 21.7179° | **0.25** | **0.00023625** | **1.35°** |
| 冲锋枪开镜（改前） | 66° | — | 0.00135 | 5.41° |
| 冲锋枪开镜（改后） | 66° | 0.84634 | 0.0007998 | 4.58° |

狙击镜比例恰为 `1/4 = 0.25`（精确，非近似）。有效 sens = `0.0021 × 0.45 × 比例`。

转身 90° 所需鼠标横移：狙击开镜 **6649 px**（改前 1662 px）。

## 已知副作用与边界

### 冲锋枪顺带变化 15%（已接受）

`player.ads` 不区分武器，故冲锋枪开镜系数 `0.45 → 0.3808`（快约 15.4%）。
这在数学上是**正确的** —— 冲锋枪 1.15 倍，monitor-distance 比例即为 0.84634。
若强行让冲锋枪保持 0.45，需引入 `if (scoped)` 分支并破坏公式一致性，故不做。

### 兼容模式方向键转向不受影响（本次不处理）

`src/main.js:441-444` 的方向键转向使用硬编码 `0.0021`，未经由 `baseSensitivity()`，
本就不在灵敏度体系内。一并修正属于独立话题，记入已知限制。

### 无法被现有自动化验收覆盖

`tests/browser-qa.js` 的 29 项断言全部走开发钩子注入，而钩子 `look(yaw, pitch)`
直接写 `player.yaw` / `player.pitch`，**绕过灵敏度计算**。因此本改动必须依靠：

1. `weapon-state.test.js` 单测 `adsSensitivityScale` 的数学正确性；
2. 有头真实浏览器中移动鼠标、读 `player.yaw` 前后对比（第 3 层验收）。

## 验收标准

1. `adsSensitivityScale` 对狙击枪返回恰为 `0.25`（浮点容差内）。
2. 对冲锋枪返回约 `0.84634`。
3. 不开镜时乘数恰为 1（回归保护：不开镜手感不得改变）。
4. 有头浏览器中，狙击开镜状态下真实鼠标横移 200px，`player.yaw` 变化约 `0.04725 rad`（2.71°），
   而非改前的 `0.189 rad`（10.83°）。
5. 现有 29 项断言保持全绿（本改动不触及任何被断言的路径）。

## 影响文件

| 文件 | 改动 |
| :--- | :--- |
| `src/weapon-state.js` | 新增导出 `adsSensitivityScale` |
| `src/weapon-state.test.js` | 新增该函数的单测 |
| `src/main.js` | 新增常量 `ADS_SENSITIVITY`；修改 1 行调用 |
| `docs/TECHNICAL.md` | 本次不改。补充灵敏度公式与兼容模式限制留作后续独立改动 |
