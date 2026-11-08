const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let pending;
const Gio = {
  DBusCallFlags: {NONE: 0},
  SubprocessFlags: {STDOUT_PIPE: 1, STDERR_SILENCE: 2},
  Subprocess: {new: () => ({force_exit() {}, communicate_utf8_async(a, b, cb) {pending = cb;}})},
};
const context = vm.createContext({
  console: {error() {}}, Gio,
  Extension: class {},
  PanelMenu: {Button: class {destroy() {this.destroyed = true;}}},
  GObject: {registerClass: c => c},
  GLib: {timeout_add_seconds: () => 1, source_remove() {}, get_monotonic_time: () => 42, build_filenamev: a => a.join('/'), file_test: () => true, FileTest: {IS_EXECUTABLE: 1}},
  PopupMenu: {
    PopupMenuItem: class {constructor(text) {this.label = {}; this.text = text;} connect() {}},
    PopupSeparatorMenuItem: class {},
  },
});
const src = fs.readFileSync('extension.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export default class', 'class');
vm.runInContext(src + '\nglobalThis.Indicator = KeyJuiceIndicator; globalThis.Smoother = BatterySmoother;', context);
function indicator(devices = []) {
  const obj = Object.create(context.Indicator.prototype);
  Object.assign(obj, {
    _extPath: '/mock', _kb24gInfo: null, _querying24g: false,
    _upowerProxy: null, _upowerSignalId: 0, _timerId: 0,
    _deviceProxies: new Map(devices), _smoothers: new Map(), _sampleTokens: new Map(), _sampleValues: new Map(), _cancellable: {cancel() {}},
    menu: {items: [], rebuilds: 0, removeAll() {this.items = []; this.rebuilds++;}, addMenuItem(x) {this.items.push(x);}},
  });
  for (const key of ['_kbEmoji','_kbLabel','_kbBox','_mouseEmoji','_mouseLabel','_mouseBox']) obj[key] = {};
  return obj;
}
function device(name, percentage, type = 6) {
  const props = {Model: name, NativePath: name, Type: type, Percentage: percentage, IsPresent: true, State: 2};
  return {props, proxy: {get_cached_property: k => ({unpack: () => props[k]})}, signalId: 0};
}
function result(name, data) {console.log(JSON.stringify({name, ...data}));}

const d = device('keyboard A', 40), a = indicator([['/a', d]]);
a._updateDisplay();
d.props.Percentage = 60;
const repeat = [];
for (let i = 0; i < 3; i++) {a._updateDisplay(); repeat.push(a._kbLabel.text);}
assert.deepEqual(repeat, ['40%', '40%', '40%']);
result('repaint_does_not_resample', {labels: repeat, menuRebuilds: a.menu.rebuilds});

const b = indicator([['/a', device('keyboard A', 80)], ['/b', device('keyboard B', 20)]]);
b._updateDisplay(); const initial = b._kbLabel.text;
b._updateDisplay(); const again = b._kbLabel.text;
assert.equal(initial, '80%'); assert.equal(again, '80%');
result('keyboard_filters_are_independent', {initial, again});

const zero = indicator([['/a', device('keyboard A', 0)]]);
zero._updateDisplay();
assert.equal(zero._kbLabel.text, '0%');
assert(zero.menu.items.some(i => i.text?.includes('0%')));
result('present_zero_battery_visible', {label: zero._kbLabel.text});
const hidzero = indicator(); hidzero._kb24gInfo = {online: true, percentage: 0}; hidzero._updateDisplay();
assert(hidzero.menu.items.some(i => i.text?.includes('0%')));
result('hid_zero_battery_visible', {label: hidzero._kbLabel.text});

const stale = indicator(); stale._kb24gInfo = {online: true, percentage: 73};
stale._query24GKeyboard(); pending({get_successful: () => true, communicate_utf8_finish: () => [true, '', '']}, {});
assert.equal(stale._kb24gInfo, null);
result('empty_stdout_clears_cache', {cached: stale._kb24gInfo});

const off = indicator(); let afterDestroy = false;
off._updateDisplay = () => {afterDestroy = off.destroyed === true;};
off._query24GKeyboard(); off.destroy();
pending({get_successful: () => true, communicate_utf8_finish: () => [true, '{"online":true,"percentage":64}', '']}, {});
assert.equal(afterDestroy, false);
result('destroyed_indicator_ignores_callback', {afterDestroy});

async function checkFallback() {
const fail = indicator(); let fallbackCalls = 0;
fail._query24GKeyboard = () => {fallbackCalls++;};
await fail._refresh();
fail._upowerProxy = {call_sync() {throw new Error('unavailable');}};
await fail._refresh();
assert.equal(fallbackCalls, 2);
result('upower_failure_uses_hid_fallback', {fallbackCalls});
}
checkFallback().catch(e => {console.error(e); process.exitCode = 1;});

const healthy = new context.Smoother(); healthy.reset(80);
assert.equal(healthy.update(40, true), 40);
result('charging_updates_immediately_baseline', {passed: true});
