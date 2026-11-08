# KeyJuice 项目状态接力 (HANDOFF.md)

## 一、当前项目状态
- **核心功能与双模支持就绪**：
  - 支持蓝牙模式（UPower D-Bus 标准 BLE 电池服务）与 2.4G 接收器模式。
  - 针对前行者 X87 键盘 2.4G 接收器（0c45:fefe），新增 `x87_battery.py` 辅助脚本与 `99-x87-keyboard.rules` udev 规则。
  - `extension.js` 优先使用 UPower 在线设备；当 UPower 无键盘时异步调用私有 HID 辅助工具读取 2.4G 电量，不阻塞 GNOME Shell 主线程。
  - 顶部状态栏图标采用独立 22px Emoji 标签（`⌨️` 与 `🖱️`），百分比维持 13px 正常文本。
  - 维持纯原生扩展架构，无常驻后台服务与托盘进程。

- **核心文件清单**：
  - `extension.js`：GNOME Shell 原生扩展逻辑（支持 UPower 与 2.4G 异步降级）。
  - `x87_battery.py`：前行者 X87 2.4G 接收器 HID 私有协议电量读取工具。
  - `99-x87-keyboard.rules`：2.4G 接收器免 root 访问权限规则。
  - `install.sh`：一键安装与 udev 权限配置脚本。
  - `metadata.json`：GNOME 扩展元数据（UUID: `keyjuice@shadowemperor`）。
  - `stylesheet.css`：状态栏样式。

## 二、下一步待办
- **低电量桌面弹窗提醒**：当外设电量降至 20% 以下时发送系统通知。
- **自定义设备名称配置**：支持配置文件覆盖外设显示别名。
