<div align="center">

# 纸上交锋 · PAPER STRIKE

**纸板枪、大头小豆人与涂鸦街区。**

[![GitHub](https://img.shields.io/badge/GITHUB-king001gg%2FCS--on--paper-E66B43?style=flat-square)](https://github.com/king001gg/CS-on-paper)

[技术文档](docs/TECHNICAL.md) · [复刻 Prompt](RECREATE_PROMPT.md)

</div>

---

一个单关卡的网页 3D 第一人称射击 Demo。在涂鸦本般的「日光街区」，用纸板枪与大头小豆人交战。暖黄、橘红、青绿配色，搭配手绘轮廓和漫画反馈。

单人模式要清空 8 名 AI 敌人；也可以和**同一个局域网内的另一台电脑 1v1 决斗**——在准备页点「双人对战」，双方各复制一段邀请码发给对方即可，不经任何后端或第三方服务。

本地运行：

```bash
npm ci
npm run dev          # 默认只监听 127.0.0.1
```

两台机器对战时改用 `npm run dev:lan`，让第二台机器访问 `http://<你的局域网IP>:5173/`（⚠️ 这会把开发服务器暴露给整个局域网，仅限可信网络）。

## 项目说明

本仓库是 [moeyui1/CS-on-paper](https://github.com/moeyui1/CS-on-paper) 的 fork，由 **king001gg** 维护与扩展。原项目由 **Deepseek harness + deepseek v4.1 flash** 开发完成。

本 fork 在原项目基础上加入：

- **同局域网 1v1 对战**：手动复制粘贴邀请码建立 WebRTC 直连，零后端、零第三方服务，默认不向任何外部地址发请求。
- 为支撑对战而做的多角色重构：输入采样、武器状态、胜负判定与角色注册从全局单例中拆出，逻辑模块可在无 DOM 环境下测试。
- 重写 `RECREATE_PROMPT.md`，使其描述当前交付形态，而不是此前那套几乎未被实现的扩展设想。

> [!NOTE]
> 上游原项目已标注为「仅供参考，不再更新或维护」。本 fork 在其基础上继续扩展，两者的维护状态相互独立。

**欢迎 Fork 本仓库**，根据自己的需求修改、扩展或继续完善。

## 参考文档

| 文档 | 内容 |
| :--- | :--- |
| [技术文档](docs/TECHNICAL.md) | 本地运行、工程结构、战斗数值、部署、安全检查、验收方法与已知限制 |
| [复刻 Prompt](RECREATE_PROMPT.md) | 完整单文档规格：交给实现 agent 即可复现本项目当前形态 |

**版本说明**：`RECREATE_PROMPT.md` 描述的就是当前交付的形态——单关卡、单人 8 名敌人、外加同局域网 1v1。它不包含尚未实现的扩展设想。
