<div align="center">

# 纸上交锋 · PAPER STRIKE

**纸板枪、大头小豆人与涂鸦街区。**

[![在线试玩](https://img.shields.io/badge/PLAY-ONLINE-E66B43?style=flat-square)](https://moeyui1.github.io/CS-on-paper/)
![项目状态：仅供参考，停止维护](https://img.shields.io/badge/STATUS-REFERENCE_ONLY-659A99?style=flat-square)

[在线试玩 ↗](https://moeyui1.github.io/CS-on-paper/) · [技术文档](docs/TECHNICAL.md) · [Prompt 参考](RECREATE_PROMPT.md)

</div>

---

一个单关卡的网页 3D 第一人称射击 Demo。在涂鸦本般的「日光街区」，用纸板枪与大头小豆人交战。暖黄、橘红、青绿配色，搭配手绘轮廓和漫画反馈。

单人模式要清空 8 名 AI 敌人；也可以和**同一个局域网内的另一台电脑 1v1 决斗**——在准备页点「双人对战」，双方各复制一段邀请码发给对方即可，不经任何后端或第三方服务。两台机器打开[在线试玩地址](https://moeyui1.github.io/CS-on-paper/)即可；想在本地跑，用 `npm run dev:lan` 让第二台机器访问 `http://<你的局域网IP>:5173/`（⚠️ 这会把这个开发服务器暴露给整个局域网，仅限可信网络）。

## 项目说明

本项目由 **Deepseek harness + deepseek v4.1 flash** 开发完成。

> [!IMPORTANT]
> **仅供参考，不再更新或维护。**
>
> 本仓库与在线 Demo 保留为开发实验与学习参考，不提供后续功能迭代、问题修复或性能保证。

**欢迎 [Fork 本项目](https://github.com/moeyui1/CS-on-paper/fork)**，根据自己的需求修改、扩展或继续完善，打造适合自己的版本。

## 参考文档

| 文档 | 内容 |
| :--- | :--- |
| [技术文档](docs/TECHNICAL.md) | 本地运行、工程结构、战斗数值、部署、安全检查、验收方法与已知限制 |
| [复刻 Prompt](RECREATE_PROMPT.md) | 完整单文档规格：交给实现 agent 即可复现本项目当前形态 |

**版本说明**：`RECREATE_PROMPT.md` 描述的就是当前交付的形态——单关卡、单人 8 名敌人、外加同局域网 1v1。它不包含尚未实现的扩展设想。项目已停止维护，没有后续更新计划。
