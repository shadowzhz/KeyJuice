# KeyJuice 🔋

适用于 Linux (Ubuntu / GNOME Shell) 的无线外设（键盘 / 鼠标）实时电量状态栏显示工具。

[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45%20~%2051-blue.svg)](https://extensions.gnome.org/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Linux-orange.svg)](#)

> **效果预览**  
> *(提示：你可以在 `docs/` 下放置你的顶部栏截图，如 `docs/screenshot.png`)*  
> 顶部面板紧凑显示外设状态与电量：`⌨️ 85%  🖱️ 92%`，悬停或点击可查看设备详情。

---

## 💡 为什么需要 KeyJuice？

在 Linux 下使用无线外设（特别是国产性价比键鼠，如前行者、VXE、狼蛛、黑爵等）时，往往面临两大痛点：
1. **2.4G 接收器模式电量“盲盒”**：许多厂商的 2.4G 接收器不走标准蓝牙 HID / UPower 协议，导致系统原生无法显示电量，用户往往需要切换回 Windows 或依靠私有专有驱动。
2. **电量数值跳变剧烈**：部分外设上报的电量未经平滑滤波，数值容易忽高忽低。

**KeyJuice** 针对以上痛点而设计：
- **双轨采集机制**：优先监听系统 UPower D-Bus；当检测到特定 2.4G 私有接收器时，通过 HID 协议直接与接收器通讯查询电量。
- **纯原生 GNOME Shell 扩展**：完全遵循 GNOME 45+ ESM 规范，不依赖后台常驻守护进程或 Electron 托盘应用；所有外部查询均采用非阻塞异步调用，绝不卡顿桌面主线程。
- **内置智能滤波 (`BatterySmoother`)**：采用中值滤波窗口与充电回升确认机制，消除电量假跳变，保证显示数值平稳真实。

---

## ⌨️🖱️ 已验证设备支持 (Device Support)

| 设备名称 | 连接模式 | 支持方式 | 状态 | 备注 |
| :--- | :--- | :--- | :---: | :--- |
| **前行者 X87** | 2.4G 接收器 (`0c45:fefe`) | 私有 HID 查询 (`x87_battery.py`) | ✅ | 需配置 udev 规则 |
| **前行者 X87** | 蓝牙 (BLE) | UPower D-Bus 原生识别 | ✅ | 蓝牙原生广播 |
| **VXE R1 Pro** | 2.4G 接收器 (Compx 1K Dongle) | UPower D-Bus 原生识别 | ✅ | 开箱即用 |
| **其他标准无线外设** | 蓝牙 (BLE) / 标准 2.4G | UPower D-Bus 原生识别 | ✅ | 只要 UPower 识别即可显示 |

欢迎社区提交更多设备的私有 2.4G 协议适配！请参见 [社区共建指南](#-社区共建--新设备适配指南)。

---

## 🚀 快速安装

### 1. 环境依赖
- **操作系统**：Ubuntu 23.10+ / Fedora 39+ / Arch Linux 或任意运行 **GNOME Shell 45+** 的发行版
- **Python 环境**：Python 3.x（系统通常自带）

### 2. 一键安装
克隆本仓库并执行安装脚本：

```bash
git clone https://github.com/shadowemperor/KeyJuice.git
cd KeyJuice
chmod +x install.sh
./install.sh
```

**脚本将自动执行以下操作：**
1. 将扩展安装到当前用户的 GNOME 扩展目录 (`~/.local/share/gnome-shell/extensions/keyjuice@shadowemperor`)；
2. 安装免 root 访问 2.4G 接收器的 udev 规则 (`/etc/udev/rules.d/99-x87-keyboard.rules`)；
3. 自动启用扩展。

> **提示**：安装完成后，如果顶部栏未立即出现图标，请注销当前桌面后重新登录，或在 Wayland 下锁屏解锁一次即可。

---

## 🗑️ 卸载指南

如果你需要彻底移除 KeyJuice：

```bash
./uninstall.sh
```

脚本会自动禁用扩展、删除扩展文件、清理 udev 规则并恢复 GNOME 配置。

---

## 🤝 社区共建 & 新设备适配指南

如果你拥有其他品牌/型号的 2.4G 三模键鼠（如 VGN、迈从、狼蛛、达尔优等），在 2.4G 接收器模式下系统无法查看电量，欢迎协助抓包或提交 PR！

### 如何协助抓取 HID 报文：
1. 插入 2.4G 接收器，运行 `lsusb` 查看接收器的 `VID:PID`。
2. 在 Windows 虚拟机中通过官方驱动查询电量，同时在 Linux 宿主机通过 `wireshark` 监听 `usbmon` 接口获取电量请求包与响应包。
3. 或者直接在 GitHub 提交 [Issue](https://github.com/shadowemperor/KeyJuice/issues)，附上你的设备型号、`lsusb` 输出与相关信息。

---

## 🗺️ 后续路线规划 (Roadmap)

- [ ] **低电量桌面弹窗提醒**：当外设电量降至 20% 以下时触发 GNOME 系统通知。
- [ ] **自定义设备别名配置**：支持在首选项中自定义外设展示名称与 Emoji。
- [ ] **多设备协议驱动模块化**：将 HID 查询脚本抽象为标准化驱动插件目录，方便社区一键新增设备支持。

---

## 📄 开源许可证

本项目基于 [GNU General Public License v3.0 (GPL-3.0)](LICENSE) 开源。
