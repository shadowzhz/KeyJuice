#!/usr/bin/env bash
set -euo pipefail

UUID="keyjuice@shadowemperor"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== 安装 KeyJuice GNOME 原生扩展 ==="

# 1. 部署扩展文件
mkdir -p "${EXT_DIR}"
cp "${REPO_DIR}/metadata.json" "${EXT_DIR}/"
cp "${REPO_DIR}/extension.js" "${EXT_DIR}/"
cp "${REPO_DIR}/stylesheet.css" "${EXT_DIR}/"
cp "${REPO_DIR}/x87_battery.py" "${EXT_DIR}/"
chmod +x "${EXT_DIR}/x87_battery.py"
echo "[1/3] 扩展核心与 2.4G 辅助工具已安装到 ${EXT_DIR}"

# 2. 部署 2.4G 接收器免 root 权限规则
UDEV_RULE="99-x87-keyboard.rules"
if [ ! -f "/etc/udev/rules.d/${UDEV_RULE}" ]; then
    echo "[*] 检测到未配置 2.4G 接收器权限，正在安装 udev 规则..."
    sudo cp "${REPO_DIR}/${UDEV_RULE}" "/etc/udev/rules.d/${UDEV_RULE}"
    sudo udevadm control --reload-rules
    sudo udevadm trigger
    echo "[2/3] 2.4G 接收器 udev 规则已配置并生效"
else
    echo "[2/3] 2.4G 接收器 udev 规则已就绪"
fi

# 2. 启用扩展
if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "${UUID}" 2>/dev/null || true
fi

CURRENT_EXTS=$(gsettings get org.gnome.shell enabled-extensions)
if [[ "${CURRENT_EXTS}" != *"${UUID}"* ]]; then
    python3 -c "
import ast, subprocess
lst = ast.literal_eval('''${CURRENT_EXTS}''')
if '${UUID}' not in lst:
    lst.append('${UUID}')
subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions', str(lst)], check=True)
"
fi
echo "[3/3] 已启用 ${UUID}"

echo ""
echo "=== 安装成功！==="
echo "状态栏已由 GNOME 原生扩展接管，显示 ⌨️/🖱️ 实时电量。"
