import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

class BatterySmoother {
    constructor(windowSize = 5, chargeConfirmCount = 3) {
        this.windowSize = windowSize;
        this.chargeConfirmCount = chargeConfirmCount;
        this.history = [];
        this.currentDisplay = null;
        this.chargeStreak = 0;
    }
    reset(val = null) {
        this.currentDisplay = val;
        this.history = val !== null ? [val] : [];
        this.chargeStreak = 0;
    }


    update(rawPct, isCharging = false) {
        if (rawPct <= 0) return rawPct;

        if (this.currentDisplay === null) {
            this.currentDisplay = rawPct;
            this.history = [rawPct];
            return this.currentDisplay;
        }

        if (isCharging) {
            this.currentDisplay = rawPct;
            this.history = [rawPct];
            this.chargeStreak = 0;
            return this.currentDisplay;
        }

        if (rawPct >= this.currentDisplay + 4 || (rawPct === 100 && this.currentDisplay < 100)) {
            this.chargeStreak += 1;
            if (this.chargeStreak >= this.chargeConfirmCount) {
                this.currentDisplay = rawPct;
                this.history = [rawPct];
                this.chargeStreak = 0;
            }
            return this.currentDisplay;
        }

        this.chargeStreak = 0;
        this.history.push(rawPct);
        if (this.history.length > this.windowSize) {
            this.history.shift();
        }

        const sorted = [...this.history].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        if (median < this.currentDisplay) {
            this.currentDisplay = median;
        }
        return this.currentDisplay;
    }
}

const KeyJuiceIndicator = GObject.registerClass(
class KeyJuiceIndicator extends PanelMenu.Button {
    _init(extPath = '') {
        super._init(0.0, 'KeyJuice', false);
        this._extPath = extPath;
        this._kb24gInfo = null;
        this._querying24g = false;

        this._box = new St.BoxLayout({
            style_class: 'panel-status-indicators-box keyjuice-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._kbBox = new St.BoxLayout({
            style_class: 'keyjuice-item-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._kbEmoji = new St.Label({
            text: '⌨️',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'keyjuice-emoji',
        });
        this._kbLabel = new St.Label({
            text: '--%',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'keyjuice-label',
        });
        this._kbBox.add_child(this._kbEmoji);
        this._kbBox.add_child(this._kbLabel);

        this._mouseBox = new St.BoxLayout({
            style_class: 'keyjuice-item-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._mouseEmoji = new St.Label({
            text: '🖱️',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'keyjuice-emoji',
        });
        this._mouseLabel = new St.Label({
            text: '--%',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'keyjuice-label',
        });
        this._mouseBox.add_child(this._mouseEmoji);
        this._mouseBox.add_child(this._mouseLabel);

        this._box.add_child(this._kbBox);
        this._box.add_child(this._mouseBox);
        this.add_child(this._box);

        this._deviceProxies = new Map();
        this._smoothers = new Map();
        this._seenOnline = new Set();
        this._timerId = 0;
        this._upowerProxy = null;
        this._upowerSignalId = 0;

        this._initDBus();
        this._refresh();

        // 10s fallback interval
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _initDBus() {
        try {
            this._upowerProxy = new Gio.DBusProxy({
                g_bus_type: Gio.BusType.SYSTEM,
                g_name: 'org.freedesktop.UPower',
                g_object_path: '/org/freedesktop/UPower',
                g_interface_name: 'org.freedesktop.UPower',
            });
            this._upowerProxy.init(null);

            this._upowerSignalId = this._upowerProxy.connect('g-signal', (proxy, sender, signalName) => {
                if (signalName === 'DeviceAdded' || signalName === 'DeviceRemoved') {
                    this._refresh();
                }
            });
        } catch (e) {
            console.error('[KeyJuice] Failed to init UPower DBus proxy:', e);
        }
    }

    _query24GKeyboard() {
        if (this._querying24g || !this._extPath) return;

        const helperPath = GLib.build_filenamev([this._extPath, 'x87_battery.py']);
        if (!GLib.file_test(helperPath, GLib.FileTest.IS_EXECUTABLE)) return;

        this._querying24g = true;
        try {
            const proc = Gio.Subprocess.new(
                [helperPath],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                this._querying24g = false;
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (stdout) {
                        const data = JSON.parse(stdout.trim());
                        if (data.online && data.percentage !== undefined) {
                            this._kb24gInfo = {
                                percentage: data.percentage,
                                online: true,
                            };
                        } else {
                            this._kb24gInfo = null;
                        }
                        this._updateDisplay();
                    }
                } catch (e) {
                    this._kb24gInfo = null;
                }
            });
        } catch (e) {
            this._querying24g = false;
            this._kb24gInfo = null;
        }
    }

    _classifyDevice(model, nativePath, type) {
        const s = `${model} ${nativePath}`.toLowerCase();

        // Skip internal battery / AC power / display
        if (s.includes('bat0') || s.includes('adp0') || s.includes('line_power') || s.includes('displaydevice') || type === 1 || type === 2) {
            return null;
        }

        // Mouse detection
        if (s.includes('mouse') || s.includes('vxe') || s.includes('kysona') || type === 5) {
            return {
                category: 'mouse',
                name: model || '无线鼠标',
                icon: '🖱️',
            };
        }

        // Keyboard detection
        if (s.includes('keyboard') || s.includes('x87') || s.includes('keychron') || type === 6) {
            return {
                category: 'keyboard',
                name: model || '无线键盘',
                icon: '⌨️',
            };
        }

        if (type > 2) {
            return {
                category: 'other',
                name: model || '外设',
                icon: '🔋',
            };
        }

        return null;
    }

    _refresh() {
        if (!this._upowerProxy) return;

        try {
            const res = this._upowerProxy.call_sync(
                'EnumerateDevices',
                null,
                Gio.DBusCallFlags.NONE,
                1000,
                null
            );
            const [devicePaths] = res.recursiveUnpack();
            const currentPaths = new Set(devicePaths);

            // Clean up removed devices
            for (const [path, dev] of this._deviceProxies) {
                if (!currentPaths.has(path)) {
                    if (dev.signalId) {
                        dev.proxy.disconnect(dev.signalId);
                    }
                    this._deviceProxies.delete(path);
                }
            }

            // Register new peripheral devices (skip internal laptop battery/AC)
            for (const path of devicePaths) {
                const lp = path.toLowerCase();
                if (lp.includes('bat0') || lp.includes('adp0') || lp.includes('line_power') || lp.includes('displaydevice')) {
                    continue;
                }
                if (!this._deviceProxies.has(path)) {
                    try {
                        const proxy = new Gio.DBusProxy({
                            g_bus_type: Gio.BusType.SYSTEM,
                            g_name: 'org.freedesktop.UPower',
                            g_object_path: path,
                            g_interface_name: 'org.freedesktop.UPower.Device',
                        });
                        proxy.init(null);
                        const model = proxy.get_cached_property('Model')?.unpack() || '';
                        const nativePath = proxy.get_cached_property('NativePath')?.unpack() || '';
                        const type = proxy.get_cached_property('Type')?.unpack() ?? 0;
                        if (!this._classifyDevice(model, nativePath, type)) {
                            continue;
                        }
                        const signalId = proxy.connect('g-properties-changed', (_p, changed) => {
                            const props = changed.deepUnpack();
                            if ('Percentage' in props || 'IsPresent' in props || 'State' in props) {
                                this._updateDisplay();
                            }
                        });
                        this._deviceProxies.set(path, { proxy, signalId });
                    } catch (e) {
                        // ignore unreadable devices
                    }
                }
            }
            let hasOnlineKb = false;
            for (const [, dev] of this._deviceProxies) {
                const model = dev.proxy.get_cached_property('Model')?.unpack() || '';
                const nativePath = dev.proxy.get_cached_property('NativePath')?.unpack() || '';
                const type = dev.proxy.get_cached_property('Type')?.unpack() ?? 0;
                const isPresent = dev.proxy.get_cached_property('IsPresent')?.unpack() ?? false;
                const rawPct = Math.round(dev.proxy.get_cached_property('Percentage')?.unpack() ?? 0);
                const cls = this._classifyDevice(model, nativePath, type);
                if (cls && cls.category === 'keyboard' && isPresent && rawPct > 0) {
                    hasOnlineKb = true;
                    break;
                }
            }
            if (!hasOnlineKb) {
                this._query24GKeyboard();
            } else {
                this._kb24gInfo = null;
            }

            this._updateDisplay();
        } catch (e) {
            console.error('[KeyJuice] Refresh error:', e);
        }
    }

    _updateDisplay() {
        let kbInfo = null;
        let mouseInfo = null;
        const allPeripherals = [];
        const currentOnline = new Set();

        for (const [path, dev] of this._deviceProxies) {
            const proxy = dev.proxy;
            const model = proxy.get_cached_property('Model')?.unpack() || '';
            const nativePath = proxy.get_cached_property('NativePath')?.unpack() || '';
            const type = proxy.get_cached_property('Type')?.unpack() ?? 0;
            const isPresent = proxy.get_cached_property('IsPresent')?.unpack() ?? false;
            const rawPercentage = Math.round(proxy.get_cached_property('Percentage')?.unpack() ?? 0);
            const state = proxy.get_cached_property('State')?.unpack() ?? 0;
            const isCharging = (state === 1);

            const classification = this._classifyDevice(model, nativePath, type);
            if (!classification) continue;

            let percentage = 0;
            const online = isPresent && rawPercentage > 0;
            if (online) {
                currentOnline.add(classification.category);
                if (!this._smoothers.has(classification.category)) {
                    this._smoothers.set(classification.category, new BatterySmoother());
                }
                if (!this._seenOnline.has(classification.category)) {
                    this._smoothers.get(classification.category).reset(rawPercentage);
                }
                percentage = this._smoothers.get(classification.category).update(rawPercentage, isCharging);
            }

            const item = {
                path,
                model,
                nativePath,
                category: classification.category,
                name: classification.name,
                icon: classification.icon,
                percentage,
                isPresent: online,
                state,
            };
            allPeripherals.push(item);

            // 优先选取当前在线的节点，避免被离线残留节点遮蔽
            if (classification.category === 'keyboard') {
                if (!kbInfo || (!kbInfo.isPresent && item.isPresent)) {
                    kbInfo = item;
                }
            } else if (classification.category === 'mouse') {
                if (!mouseInfo || (!mouseInfo.isPresent && item.isPresent)) {
                    mouseInfo = item;
                }
            }
        }
        if ((!kbInfo || !kbInfo.isPresent) && this._kb24gInfo && this._kb24gInfo.online) {
            const rawPercentage = this._kb24gInfo.percentage;
            if (!this._smoothers.has('keyboard')) {
                this._smoothers.set('keyboard', new BatterySmoother());
            }
            if (!this._seenOnline.has('keyboard')) {
                this._smoothers.get('keyboard').reset(rawPercentage);
            }
            const percentage = this._smoothers.get('keyboard').update(rawPercentage, false);
            kbInfo = {
                path: '2.4g-x87',
                model: '前行者 X87 (2.4G)',
                nativePath: '0c45:fefe',
                category: 'keyboard',
                name: '前行者 X87 键盘',
                icon: '⌨️',
                percentage,
                isPresent: true,
                state: 0,
            };
            allPeripherals.push(kbInfo);
            currentOnline.add('keyboard');
        }


        this._seenOnline = currentOnline;

        // Update Top Bar Labels
        if (kbInfo && kbInfo.isPresent && kbInfo.percentage > 0) {
            this._kbEmoji.text = '⌨️';
            this._kbLabel.text = `${kbInfo.percentage}%`;
            const low = kbInfo.percentage <= 20;
            this._kbLabel.style = low ? 'color: #ff5555; font-weight: bold;' : '';
            this._kbBox.style = '';
            this._kbBox.visible = true;
        } else if (kbInfo) {
            this._kbEmoji.text = '⌨️';
            this._kbLabel.text = '--%';
            this._kbLabel.style = 'color: #888888;';
            this._kbBox.style = 'opacity: 0.6;';
            this._kbBox.visible = true;
        } else {
            this._kbBox.visible = false;
        }

        if (mouseInfo && mouseInfo.isPresent && mouseInfo.percentage > 0) {
            this._mouseEmoji.text = '🖱️';
            this._mouseLabel.text = `${mouseInfo.percentage}%`;
            const low = mouseInfo.percentage <= 20;
            this._mouseLabel.style = low ? 'color: #ff5555; font-weight: bold;' : '';
            this._mouseBox.style = '';
            this._mouseBox.visible = true;
        } else if (mouseInfo) {
            this._mouseEmoji.text = '🖱️';
            this._mouseLabel.text = '--%';
            this._mouseLabel.style = 'color: #888888;';
            this._mouseBox.style = 'opacity: 0.6;';
            this._mouseBox.visible = true;
        } else {
            this._mouseBox.visible = false;
        }

        if (!this._kbBox.visible && !this._mouseBox.visible) {
            this._kbEmoji.text = '🔋';
            this._kbLabel.text = '--%';
            this._kbLabel.style = 'color: #888888;';
            this._kbBox.style = 'opacity: 0.6;';
            this._kbBox.visible = true;
        }

        // Update Dropdown Menu
        this.menu.removeAll();

        const titleItem = new PopupMenu.PopupMenuItem('🔋 KeyJuice 外设电量', { reactive: false });
        titleItem.label.style = 'font-weight: bold;';
        this.menu.addMenuItem(titleItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (allPeripherals.length === 0) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem('未检测到支持的无线外设', { reactive: false }));
        } else {
            for (const p of allPeripherals) {
                let stateText = '';
                if (p.state === 1) stateText = ' (充电中)';
                else if (p.state === 4) stateText = ' (已充满)';

                const pctText = (p.isPresent && p.percentage > 0) ? `${p.percentage}%${stateText}` : '已离线';

                let friendlyName = p.name;
                if (friendlyName.includes('X87')) friendlyName = '前行者 X87 键盘';
                else if (friendlyName.includes('NordicMouse') || friendlyName.includes('VXE')) friendlyName = 'VXE R1 Pro 鼠标';

                const item = new PopupMenu.PopupMenuItem(`${p.icon} ${friendlyName}: ${pctText}`);
                this.menu.addMenuItem(item);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refreshItem = new PopupMenu.PopupMenuItem('🔄 立即刷新');
        refreshItem.connect('activate', () => {
            this._refresh();
        });
        this.menu.addMenuItem(refreshItem);
    }

    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }

        if (this._upowerProxy && this._upowerSignalId) {
            this._upowerProxy.disconnect(this._upowerSignalId);
            this._upowerSignalId = 0;
            this._upowerProxy = null;
        }

        for (const [path, dev] of this._deviceProxies) {
            if (dev.signalId) {
                dev.proxy.disconnect(dev.signalId);
            }
        }
        this._deviceProxies.clear();

        super.destroy();
    }
});

export default class KeyJuiceExtension extends Extension {
    enable() {
        this._indicator = new KeyJuiceIndicator(this.path);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
