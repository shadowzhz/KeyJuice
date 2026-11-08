#!/usr/bin/env bash
set -euo pipefail

UUID="keyjuice@shadowemperor"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
UDEV_RULE="99-x87-keyboard.rules"

echo "=== 卸载 KeyJuice GNOME 原生扩展 ==="

# 1. 禁用扩展
if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "${UUID}" 2>/dev/null || true
    echo "[1/3] 已禁用扩展 ${UUID}"
else
    echo "[1/3] gnome-extensions 命令未找到，跳过显式禁用"
fi

# 2. 移除扩展安装目录
if [ -d "${EXT_DIR}" ]; then
    rm -rf "${EXT_DIR}"
    echo "[2/3] 已移除扩展文件目录: ${EXT_DIR}"
else
    echo "[2/3] 扩展目录不存在，跳过"
fi

# 3. 移除 udev 规则
if [ -f "/etc/udev/rules.d/${UDEV_RULE}" ]; then
    echo "[*] 检测到已安装 udev 规则，正在移除（需要 sudo 权限）..."
    sudo rm -f "/etc/udev/rules.d/${UDEV_RULE}"
    sudo udevadm control --reload-rules
    sudo udevadm trigger
    echo "[3/3] 2.4G 接收器 udev 规则已移除并生效"
else
    echo "[3/3] udev 规则未配置或已移除，跳过"
fi

/usr/bin/python3 - <<'PYSETTINGS'
from gi.repository import Gio
settings = Gio.Settings.new('org.gnome.shell')
uuid = 'keyjuice@shadowemperor'
values = list(settings.get_strv('enabled-extensions'))
if uuid in values:
    values.remove(uuid)
    settings.set_strv('enabled-extensions', values)
    Gio.Settings.sync()
PYSETTINGS
echo ""
echo "=== 卸载成功！==="
echo "如果状态栏图标未立即消失，可通过注销并重新登录或重启桌面生效。"
