<div align="center">

# CodingMacro

**用游戏手柄控制 AI Coding Agent。**

让小鸡、Xbox、DualSense 等普通手柄控制 Codex、Claude Code 和多个 Agent 会话。

[English](README.md) · [手柄兼容表](CONTROLLERS.md) · [参与开发](CONTRIBUTING.md)

</div>

![CodingMacro 本地手柄与 Agent 控制面板](assets/codingmacro-dashboard.jpg)

CodingMacro 不只是按键映射。它读取 Agent 生命周期状态，用一个手柄切换多个会话，并通过本地 HUD 显示执行中、等待审批、完成和报错。没带手柄时，浏览器模拟器走同一套标准化事件管线。

## 安装

一条命令安装最新版 GitHub Release：

```sh
curl -fsSL https://raw.githubusercontent.com/MisterBrookT/CodingMacro/main/install.sh | sh
```

当前优先支持 macOS，要求 Node.js 22+。控制 Codex 桌面端需要给终端 Accessibility 权限。

## 启动

```sh
codingmacro claude
codingmacro codex
codingmacro codex-app
```

真实手柄加可视化 HUD：

```sh
codingmacro --dashboard codex-app
```

无手柄模拟：

```sh
codingmacro --simulate codex-app
```

模拟器只监听 localhost，默认关闭。它不安装虚拟驱动，而是直接注入 CodingMacro 标准化事件层，因此可验证按键映射、工作流、Agent 切换和状态 UI。

## 默认控制

| 手柄操作         | 功能                           |
| ---------------- | ------------------------------ |
| A / Cross        | 提交；等待审批时按住 500ms     |
| B / Circle       | 中断、关闭                     |
| X / Square       | 新建会话                       |
| Y / Triangle     | 语音输入，取决于 Agent         |
| 方向键           | 导航 Agent UI                  |
| 左摇杆甩动       | Review、Debug、Refactor、Tests |
| 右摇杆旋转       | 调整推理深度                   |
| Home / Touchpad  | 切换 Agent 会话                |
| L1 + 面键/方向键 | 切换六层配置                   |

配置位于 `~/.codingmacro/config.json`。可修改按键、颜色、Prompt 工作流和原始按键序列。错误配置不会覆盖原文件。

## 已支持

- Claude Code、Codex CLI、Codex macOS App。
- 多会话状态聚合和输入路由。
- GameSir Cyclone 2、GameSir G7 Pro、Xbox One S、DualSense 回放测试。
- DualSense 灯条和玩家灯反馈。
- 通用 HID 尽力兼容。
- 浏览器 HUD、鼠标/触摸/键盘模拟。

检测自己的手柄：

```sh
codingmacro doctor
codingmacro doctor --capture
```

## 隐私与安全

- 服务仅绑定 `127.0.0.1:48762`。
- 不上传遥测。
- 模拟输入必须显式添加 `--simulate`。
- Agent hooks 采用原子合并，不覆盖其他工具的 hooks。
- 不支持的 Agent 动作保持空映射，不猜测脆弱快捷键。

## 开发

```sh
git clone https://github.com/MisterBrookT/CodingMacro.git
cd CodingMacro
npm ci
npm run verify
npm run build
npm link
```

## 来源

基于 Stephen Leo 的 [OpenMicro](https://github.com/stephenleo/OpenMicro)，保留原 MIT 许可和版权声明。详见 [NOTICE.md](NOTICE.md)。
