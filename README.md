# KeyJuice 🔋

<p align="center">
  <img src="https://img.shields.io/badge/GNOME%20Shell-45%20~%2051-blue.svg?logo=gnome&logoColor=white" alt="GNOME Shell: 45~51">
  <img src="https://img.shields.io/badge/Platform-Linux-orange.svg?logo=linux&logoColor=white" alt="Platform: Linux">
  <img src="https://img.shields.io/badge/Python-3.8+-3776AB.svg?logo=python&logoColor=white" alt="Python 3.8+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-green.svg" alt="License: GPLv3"></a>
  <img src="https://img.shields.io/badge/Architecture-ESM%20%2B%20UPower%20%2B%20HID-purple.svg" alt="Architecture">
</p>

> **适用于 Linux (Ubuntu / GNOME Shell) 的无线外设（键盘 / 鼠标）实时电量状态栏显示工具。**  
> 破解国产外设 2.4G 接收器在 Linux 下无法读取电量的“盲盒”痛点，支持 UPower D-Bus 与私有 2.4G HID 双轨采集，原生丝滑且轻量。

```text
┌────────────────────────────────────────────────────────┐
│  活动   [终端] [浏览器]          ⌨️ 85%  🖱️ 92%   10:30 │
└────────────────────────────────────────────────────────┘
```

---

## ✨ 核心特性 (Features)

- 🔌 **双轨采集机制**：优先监听系统 UPower D-Bus 原生广播；当检测到特定 2.4G 私有接收器时，通过底层 HID 协议直接与接收器通讯查询电量。
- ⚡ **原生轻量，拒绝卡顿**：基于现代 GNOME 45+ ESM 规范构建，无需常驻后台 Electron 托盘应用；所有外部设备查询均为非阻塞异步调用，绝不抢占桌面主线程。
- 📈 **智能平滑滤波 (`BatterySmoother`)**：内置中值滤波窗口与充电状态确认机制，有效滤除低端外设主控频繁跳变的抖动数据，显示真实平稳。
- 🛡️ **免 Root 权限设计**：自动配置 udev 规则，普通用户空间即可安全与 2.4G 接收器握手通讯。

---

## ⌨️🖱️ 已验证设备支持 (Device Support)

| 设备名称 | 连接模式 | 支持方式 | 状态 | 备注 |
| :--- | :--- | :--- | :---: | :--- |
| **前行者 X87** | 2.4G 接收器 (`0c45:fefe`) | 私有 HID 查询 (`x87_battery.py`) | ✅ | 需配置附带的 udev 规则 |
| **前行者 X87** | 蓝牙 (BLE) | UPower D-Bus 原生识别 | ✅ | 蓝牙原生广播电量 |
| **VXE R1 Pro** | 2.4G 接收器 (Compx 1K Dongle) | UPower D-Bus 原生识别 | ✅ | 开箱即用 |
| **其他标准无线外设** | 蓝牙 (BLE) / 标准 2.4G | UPower D-Bus 原生识别 | ✅ | 只要系统 UPower 识别即可直接展示 |

*欢迎社区提交更多设备的私有 2.4G 协议适配！详见 [社区共建指南](#-社区共建--新设备适配指南)。*

---

## ⚡ 快速安装 (Quick Start)

### 1. 环境依赖
- **操作系统**：Ubuntu 23.10+ / Fedora 39+ / Arch Linux 或任意运行 **GNOME Shell 45+** 的发行版
- **Python 环境**：Python 3.8+ 与系统 PyGObject（Debian/Ubuntu: `sudo apt install python3-gi`）

### 2. 一键安装
克隆仓库并执行安装脚本：

```bash
git clone https://github.com/shadowzhz/KeyJuice.git
cd KeyJuice
chmod +x install.sh
./install.sh
```

**脚本将自动完成：**
1. 将扩展安装到当前用户的 GNOME 扩展目录 (`~/.local/share/gnome-shell/extensions/keyjuice@shadowemperor`)；
2. 安装免 root 访问 2.4G 接收器的 udev 规则 (`/etc/udev/rules.d/99-x87-keyboard.rules`)；
3. 自动载入并启用扩展。

> **安装提示**：若安装后顶部栏未立即刷新，请在 Wayland 环境下锁屏后解锁一次，或注销桌面重新登录即可。

---

## 📁 项目结构 (Project Structure)

```text
KeyJuice/
├── metadata.json          # GNOME Shell 扩展元数据声明 (UUID/版本/兼容性)
├── extension.js           # 扩展核心入口，面板指示器 UI 与 UPower 异步监听
├── stylesheet.css         # 顶部面板与下拉菜单紧凑样式
├── x87_battery.py         # 针对特定 2.4G 接收器的底层 HID 报文查询独立脚本
├── 99-x87-keyboard.rules  # udev 权限规则（赋予当前用户读取 hidraw 节点权限）
├── install.sh             # 一键安装配置自动化脚本
├── uninstall.sh           # 干净卸载与清理脚本
└── tests/                 # 单元测试与设备报文回放模拟
```

---

## 🗑️ 卸载指南 (Uninstallation)

如果你需要彻底移除 KeyJuice：

```bash
./uninstall.sh
```

*脚本会自动禁用扩展、删除扩展文件、清理 udev 规则并恢复 GNOME 原始配置。*

---

## 🤝 社区共建 & 新设备适配指南

如果你拥有其他品牌/型号的 2.4G 三模键鼠（如 VGN、迈从、狼蛛、黑爵等），在 2.4G 接收器模式下系统无法查看电量，欢迎协助抓包或提交 PR！

### 协助抓取 HID 报文流程：
1. 插入 2.4G 接收器，运行 `lsusb` 查看接收器的 `VID:PID`。
2. 在 Windows 虚拟机中通过官方驱动查询电量，同时在 Linux 宿主机通过 `wireshark` 监听 `usbmon` 接口获取电量请求包与响应包。
3. 或者直接在 GitHub 提交 [Issue](https://github.com/shadowzhz/KeyJuice/issues)，附上你的设备型号、`lsusb` 输出与相关信息。

---

## 🗺️ 路线规划 (Roadmap)

- [ ] **低电量桌面弹窗提醒**：当外设电量降至 20% 以下时触发 GNOME 系统原生通知。
- [ ] **自定义设备别名配置**：支持在首选项中自定义外设展示名称与 Emoji。
- [ ] **多设备协议驱动模块化**：将 HID 查询脚本抽象为标准化驱动插件目录，方便社区一键新增设备支持。

---

## 📄 开源许可证 (License)

本项目基于 [GNU General Public License v3.0 (GPL-3.0)](LICENSE) 开放源代码。
