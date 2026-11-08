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
        if (rawPct === 0) { this.reset(0); return 0; }

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
        this._destroyed = false;
        this._cancellable = new Gio.Cancellable();
        this._sampleTokens = new Map();
        this._sampleValues = new Map();

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
        this._timerId = 0;
        this._upowerProxy = null;
        this._upowerSignalId = 0;

        this._initDBus().then(() => this._refresh());

        // 10s fallback interval
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _initDBus() {
        try {
            this._upowerProxy = new Gio.DBusProxy({
                g_bus_type: Gio.BusType.SYSTEM,
                g_name: 'org.freedesktop.UPower',
                g_object_path: '/org/freedesktop/UPower',
                g_interface_name: 'org.freedesktop.UPower',
            });
            await this._initProxy(this._upowerProxy);
            if (this._destroyed) return;

            this._upowerSignalId = this._upowerProxy.connect('g-signal', (proxy, sender, signalName) => {
                if (signalName === 'DeviceAdded' || signalName === 'DeviceRemoved') {
                    this._refresh();
                }
            });
        } catch (e) {
            this._upowerProxy = null;
            if (!this._destroyed) console.error('[KeyJuice] UPower initialization failed:', e);
        }
    }

    _initProxy(proxy) {
        return new Promise((resolve, reject) => {
            proxy.init_async(GLib.PRIORITY_DEFAULT, this._cancellable, (p, result) => {
                try { p.init_finish(result); resolve(); } catch (e) { reject(e); }
            });
        });
    }

    _sample(key, token, raw, charging) {
        if (!this._smoothers.has(key)) this._smoothers.set(key, new BatterySmoother());
        if (this._sampleTokens.get(key) !== token || !this._sampleValues.has(key)) {
            this._sampleTokens.set(key, token);
            this._sampleValues.set(key, this._smoothers.get(key).update(raw, charging));
        }
        return this._sampleValues.get(key);
    }

    _query24GKeyboard() {
        if (this._destroyed || this._querying24g || !this._extPath) return;

        const helperPath = GLib.build_filenamev([this._extPath, 'x87_battery.py']);
        if (!GLib.file_test(helperPath, GLib.FileTest.IS_EXECUTABLE)) return;

        this._querying24g = true;
        try {
            const proc = Gio.Subprocess.new(
                [helperPath],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            this._proc = proc;
            this._queryTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                this._queryTimeout = 0;
                proc.force_exit();
                return GLib.SOURCE_REMOVE;
            });
            proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
                this._querying24g = false;
                if (this._queryTimeout) GLib.source_remove(this._queryTimeout);
                this._queryTimeout = 0;
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (this._destroyed) return;
                    this._proc = null;
                    this._kb24gInfo = null;
                    if (stdout && p.get_successful()) {
                        const data = JSON.parse(stdout.trim());
                        if (data.online && Number.isFinite(data.percentage) && data.percentage >= 0 && data.percentage <= 100) {
                            this._kb24gInfo = {
                                percentage: data.percentage,
                                online: true,
                                token: GLib.get_monotonic_time(),
                            };
                        } else {
                            this._kb24gInfo = null;
                        }
                    }
                    this._updateDisplay();
                } catch (e) {
                    this._kb24gInfo = null;
                    if (!this._destroyed) this._updateDisplay();
                }
            });
        } catch (e) {
            this._querying24g = false;
            this._kb24gInfo = null;
            this._updateDisplay();
        }
    }

    _classifyDevice(model, nativePath, type, powerSupply = false) {
        const s = `${model} ${nativePath}`.toLowerCase();

        // Skip internal battery / AC power / display
        if (s.includes('bat0') || s.includes('adp0') || s.includes('line_power') || s.includes('displaydevice') || type === 1 || (type === 2 && powerSupply)) {
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

        if (type >= 2) {
            return {
                category: 'other',
                name: model || '外设',
                icon: '🔋',
            };
        }

        return null;
    }

    async _refresh() {
        if (this._destroyed || this._refreshing) return;
        this._refreshing = true;

        try {
            if (!this._upowerProxy) throw new Error('UPower unavailable');
            const res = await new Promise((resolve, reject) => {
                this._upowerProxy.call('EnumerateDevices', null, Gio.DBusCallFlags.NONE,
                    1000, this._cancellable, (proxy, result) => {
                        try { resolve(proxy.call_finish(result)); } catch (e) { reject(e); }
                    });
            });
            if (this._destroyed) return;
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
                        await this._initProxy(proxy);
                        if (this._destroyed) return;
                        const model = proxy.get_cached_property('Model')?.unpack() || '';
                        const nativePath = proxy.get_cached_property('NativePath')?.unpack() || '';
                        const type = proxy.get_cached_property('Type')?.unpack() ?? 0;
                        if (!this._classifyDevice(model, nativePath, type, proxy.get_cached_property('PowerSupply')?.unpack() ?? false)) {
                            continue;
                        }
                        const signalId = proxy.connect('g-properties-changed', (_p, changed) => {
                            const props = changed.deepUnpack();
                            if ('Percentage' in props || 'IsPresent' in props || 'State' in props || 'UpdateTime' in props) {
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
                const rawPct = Math.round(dev.proxy.get_cached_property('Percentage')?.unpack() ?? NaN);
                const cls = this._classifyDevice(model, nativePath, type, dev.proxy.get_cached_property('PowerSupply')?.unpack() ?? false);
                if (cls && cls.category === 'keyboard' && isPresent && Number.isFinite(rawPct) && rawPct >= 0 && rawPct <= 100) {
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
            if (!this._destroyed) this._query24GKeyboard();
        } finally {
            this._refreshing = false;
        }
    }

    _updateDisplay() {
        if (this._destroyed) return;
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
            const rawPercentage = Math.round(proxy.get_cached_property('Percentage')?.unpack() ?? NaN);
            const state = proxy.get_cached_property('State')?.unpack() ?? 0;
            const isCharging = (state === 1);

            const classification = this._classifyDevice(model, nativePath, type, proxy.get_cached_property('PowerSupply')?.unpack() ?? false);
            if (!classification) continue;

            let percentage = 0;
            const online = isPresent && Number.isFinite(rawPercentage) && rawPercentage >= 0 && rawPercentage <= 100;
            if (online) {
                currentOnline.add(path);
                const stamp = proxy.get_cached_property('UpdateTime')?.unpack() ?? '';
                percentage = this._sample(path, `${stamp}:${rawPercentage}:${state}`, rawPercentage, isCharging);
            }

            const item = {
                name: classification.name,
                icon: classification.icon,
                percentage,
                isPresent: online,
                unknown: isPresent && !online,
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
            const percentage = this._sample('2.4g-x87', this._kb24gInfo.token, rawPercentage, false);
            kbInfo = {
                name: '前行者 X87 键盘',
                icon: '⌨️',
                percentage,
                isPresent: true,
                state: 0,
            };
            allPeripherals.push(kbInfo);
            currentOnline.add('2.4g-x87');
        }


        for (const key of this._smoothers.keys()) {
            if (!currentOnline.has(key)) {
                this._smoothers.delete(key);
                this._sampleTokens.delete(key);
                this._sampleValues.delete(key);
            }
        }

        this._renderDevice(this._kbBox, this._kbEmoji, this._kbLabel, kbInfo, '⌨️');
        this._renderDevice(this._mouseBox, this._mouseEmoji, this._mouseLabel, mouseInfo, '🖱️');

        if (!this._kbBox.visible && !this._mouseBox.visible) {
            this._kbEmoji.text = '🔋';
            this._kbLabel.text = '--%';
            this._kbLabel.style = 'color: #888888;';
            this._kbBox.style = 'opacity: 0.6;';
            this._kbBox.visible = true;
        }

        // Update Dropdown Menu
        const menuKey = JSON.stringify(allPeripherals);
        if (menuKey === this._menuKey) return;
        this._menuKey = menuKey;
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

                const pctText = (p.isPresent && p.percentage >= 0) ? `${p.percentage}%${stateText}` : (p.unknown ? '电量未知' : '已离线');

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

    _renderDevice(box, emoji, label, info, icon) {
        box.visible = !!info;
        if (!info) return;
        emoji.text = icon;
        const valid = info.isPresent && Number.isFinite(info.percentage);
        label.text = valid ? `${info.percentage}%` : '--%';
        label.style = valid ? (info.percentage <= 20 ? 'color: #ff5555; font-weight: bold;' : '') : 'color: #888888;';
        box.style = valid ? '' : 'opacity: 0.6;';
    }

    destroy() {
        this._destroyed = true;
        this._cancellable.cancel();
        if (this._queryTimeout) GLib.source_remove(this._queryTimeout);
        this._queryTimeout = 0;
        this._proc?.force_exit();
        this._proc = null;
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }

        if (this._upowerProxy && this._upowerSignalId) {
            this._upowerProxy.disconnect(this._upowerSignalId);
            this._upowerSignalId = 0;
            this._upowerProxy = null;
        }

        for (const dev of this._deviceProxies.values()) {
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
