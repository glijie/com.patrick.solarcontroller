'use strict';

const assert = require('assert');
const http = require('http');
const Module = require('module');

class FakeApp { log() {} error() {} }
class FakeDriver { log() {} error() {}; getDevices() { return []; } }
class FakeDevice { log() {} error() {} }
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'homey') return { App: FakeApp, Driver: FakeDriver, Device: FakeDevice };
  return originalLoad.call(this, request, parent, isMain);
};

const { normalizeBaseUrl } = require('../lib/sc_utils');
const { httpGetJson, httpPostJson } = require('../lib/http');
const { SolarControllerApiClient } = require('../lib/sc_api_client');
const SolarControllerApp = require('../app');
const SolarControllerDriver = require('../drivers/solar_controller/driver');
const { DEFAULT_DEVICE_SETTINGS } = SolarControllerDriver;
const driverCompose = require('../drivers/solar_controller/driver.compose.json');
const mappers = require('../lib/sc_mappers');

function listen(server) {
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', err => err ? reject(err) : resolve(server.address().port)));
}
function close(server) { return new Promise(resolve => server.close(resolve)); }

async function testUtilsAndHttp() {
  assert.strictEqual(normalizeBaseUrl(' 192.168.1.10/ '), 'http://192.168.1.10');
  assert.strictEqual(normalizeBaseUrl('https://boiler.local/'), 'https://boiler.local');
  assert.strictEqual(normalizeBaseUrl(''), '');

  let active = 0;
  let maxActive = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/slow') return setTimeout(() => { res.end('{}'); }, 120);
    if (req.url === '/hold') {
      active += 1; maxActive = Math.max(maxActive, active);
      return setTimeout(() => { active -= 1; res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); }, 40);
    }
    if (req.url === '/bad') return res.end('not-json');
    if (req.method === 'POST') {
      let body = ''; req.on('data', c => body += c); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(body || '{}'); });
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  assert.deepStrictEqual(await httpGetJson(`${base}/ok`, { timeoutMs: 500 }), { ok: true });
  assert.deepStrictEqual(await httpPostJson(`${base}/post`, { hello: 'world' }, { timeoutMs: 500 }), { hello: 'world' });
  await assert.rejects(() => httpGetJson(`${base}/bad`, { timeoutMs: 500 }), /Invalid JSON/);
  await assert.rejects(() => httpGetJson(`${base}/slow`, { timeoutMs: 20 }), /Request timeout/);

  const api = new SolarControllerApiClient(() => base, () => 500, () => 1);
  await Promise.all([api.getJson('/hold'), api.getJson('/hold'), api.getJson('/hold')]);
  assert.strictEqual(maxActive, 1, 'API request semaphore must enforce concurrency limit');
  await close(server);
}

function makeCard() {
  return {
    listener: null,
    registerRunListener(fn) { this.listener = fn; return this; },
    async trigger() { return true; },
  };
}

async function testFlowRegistration() {
  const triggers = new Map();
  const conditions = new Map();
  const actions = new Map();
  const card = (map, id) => { if (!map.has(id)) map.set(id, makeCard()); return map.get(id); };
  const app = new SolarControllerApp();
  app.homey = {
    __: key => key,
    flow: {
      getDeviceTriggerCard: id => card(triggers, id),
      getConditionCard: id => card(conditions, id),
      getActionCard: id => card(actions, id),
    },
  };
  await app.onInit();
  const power = triggers.get('power_crossed_above').listener;
  const temp = triggers.get('temp_crossed_above').listener;
  assert.strictEqual(await power({ threshold: 150 }, { previous: 100, current: 151 }), true);
  assert.strictEqual(await power({ threshold: 150 }, { previous: 151, current: 170 }), false);
  assert.strictEqual(await power({ threshold: 150 }, { previous: 170, current: 149 }), false);
  assert.strictEqual(await temp({ threshold: 60 }, { previous: 59.9, current: 60.1 }), true);
  assert.strictEqual(await temp({ threshold: 60 }, { previous: 60.1, current: 61 }), false);

  // Missing capability values must not be interpreted as numeric zero by Flow conditions.
  const noValueDevice = {
    getCapabilityValue: () => null,
    getStoreValue: () => null,
  };
  assert.strictEqual(await conditions.get('power_above').listener({ device: noValueDevice, threshold: -1 }), false);
  assert.strictEqual(await conditions.get('pwm_above').listener({ device: noValueDevice, threshold: -1 }), false);
  assert.strictEqual(await conditions.get('temp_above').listener({ device: noValueDevice, threshold: -1 }), false);
  assert.strictEqual(await conditions.get('elec_price_below').listener({ device: noValueDevice, threshold: 1 }), false);
  assert.strictEqual(await conditions.get('gas_price_below').listener({ device: noValueDevice, threshold: 1 }), false);

  let called = null;
  const fakeDevice = { _flowSetPwm: async p => { called = p; return true; } };
  await actions.get('set_pwm_percent').listener({ device: fakeDevice, percent: 37 });
  assert.strictEqual(called, 37);
}

function testDefaultSettingsParity() {
  const composeDefaults = Object.fromEntries((driverCompose.settings || []).map(setting => [setting.id, setting.value]));
  assert.deepStrictEqual(
    Object.keys(DEFAULT_DEVICE_SETTINGS).sort(),
    Object.keys(composeDefaults).sort(),
    'Manual pairing defaults must cover exactly the driver settings',
  );
  for (const [id, value] of Object.entries(composeDefaults)) {
    assert.deepStrictEqual(DEFAULT_DEVICE_SETTINGS[id], value, `Pairing default mismatch for setting ${id}`);
  }
}

async function testPairing() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/status_light') {
      res.setHeader('content-type', 'application/json');
      return res.end('{"fw":"test","temps":[{"t":55.5}]}');
    }
    res.statusCode = 404; res.end('{}');
  });
  const port = await listen(server);
  const driver = new SolarControllerDriver();
  driver.homey = { __: key => ({
    'pair.default_name': 'Solar Controller',
    'pair.address_required': 'required',
    'pair.address_invalid': 'invalid',
    'pair.address_already_paired': 'duplicate',
    'pair.connection_failed': 'failed',
  }[key] || key) };
  driver.getDevices = () => [];
  const handlers = {};
  await driver.onPair({ setHandler(name, fn) { handlers[name] = fn; } });
  assert.strictEqual(typeof handlers.validate_controller, 'function');
  const host = `127.0.0.1:${port}`;
  const result = await handlers.validate_controller({ host, name: 'Boiler' });
  assert.strictEqual(result.device.name, 'Boiler');
  assert.strictEqual(result.device.settings.host, host);
  assert.match(result.device.data.id, /^solar_controller_/);
  assert.strictEqual(result.device.settings.performance_mode, 'auto');

  driver.getDevices = () => [{ getSetting: key => key === 'host' ? host : null }];
  await assert.rejects(() => handlers.validate_controller({ host }), /duplicate/);
  await assert.rejects(() => handlers.validate_controller({ host: '' }), /required/);
  driver.getDevices = () => [];
  await assert.rejects(() => handlers.validate_controller({ host: '127.0.0.1:1' }), /failed/);
  await close(server);
}

class MapperDevice {
  constructor() {
    this.caps = new Map([
      ['measure_power', 0], ['measure_temperature', null], ['measure_temperature.2', null], ['measure_temperature.3', null], ['measure_temperature.4', null],
      ['sc_pwm', 0], ['sc_force_heat', false], ['sc_relay_manual_on', false], ['sc_sun_mode', 'unknown'], ['sc_control_mode', 'unknown'],
      ['sc_mc_role', 'standalone'], ['sc_mc_fallback_active', false], ['sc_mc_peers_online', 0], ['sc_mc_peers_healthy', 0], ['sc_mc_tcp_realtime', false],
      ['sc_mc_group_pwm', 0], ['sc_temp_gate_blocked', false], ['sc_max_out_pct', 0], ['sc_max_out_pct_control', 0], ['sc_legionella_active', 'off'],
      ['sc_legionella_manual', false], ['sc_legionella_status', 'unknown'], ['sc_elec_price_now', 0], ['sc_gas_price_today', 0], ['sc_advice', 'unknown'],
    ]);
    this.store = new Map();
    this.settings = { performance_mode: 'auto', show_advanced: false };
    this.events = [];
    this.writeCounts = new Map();
    const flow = { getDeviceTriggerCard: id => ({ trigger: async (device, tokens, state) => { this.events.push({ id, tokens, state }); } }) };
    this.homey = { __: key => key, flow };
    this._shouldTrigger = () => true;
    this._trgTemp2Changed = flow.getDeviceTriggerCard('temp2_changed');
    this._trgTemp3Changed = flow.getDeviceTriggerCard('temp3_changed');
    this._trgTemp4Changed = flow.getDeviceTriggerCard('temp4_changed');
  }
  getSetting(k) { return this.settings[k]; }
  hasCapability(k) { return this.caps.has(k); }
  getCapabilityValue(k) { return this.caps.get(k); }
  async setCapabilityValue(k, v) {
    this.caps.set(k, v);
    this.writeCounts.set(k, (this.writeCounts.get(k) || 0) + 1);
  }
  getStoreValue(k) { return this.store.get(k); }
  async setStoreValue(k, v) { this.store.set(k, v); }
}

async function testMappers() {
  const d = new MapperDevice();
  const temp = await mappers.applyStatusLight(d, {
    fw: 'v-test', control_mode: 'FORCE_HEAT', sun_sched_mode: 0, relay_manual_on: 1,
    temps: [{ t: 50 }, { t: 40 }, { t: 30 }, { t: 20 }], mc_role: 'master', mc_fallback_active: 1,
    mc_peers_online: 2, mc_peers_healthy: 2, mc_tcp_realtime: 1, mc_group_pwm_assigned_pct: 65,
  }, { enableExtraTemps: true });
  assert.strictEqual(temp, 50);
  assert.strictEqual(d.caps.get('sc_force_heat'), true);
  assert.strictEqual(d.caps.get('measure_temperature.4'), 20);
  assert.strictEqual(d.store.get('firmware_version'), 'v-test');
  assert.strictEqual(d.events.filter(e => e.id === 'temp2_changed').length, 0, 'First extra-temperature value must not fire a change Flow');
  await mappers.applyStatusLight(d, { control_mode: 'FORCE_HEAT', temps: [{ t: 50 }, { t: 41 }, { t: 30 }, { t: 20 }] }, { enableExtraTemps: true });
  assert.strictEqual(d.events.filter(e => e.id === 'temp2_changed').length, 1, 'A later real extra-temperature change must fire once');

  const live = await mappers.applyLive(d, { net_power_w: 1234, duty_percent: 42 });
  assert.deepStrictEqual(live, { power: 1234, pwm: 42 });
  assert.strictEqual(d.caps.get('measure_power'), 1234);

  await mappers.applyStatus(d, { max_output_percent: 80, legionella_active: true });
  assert.strictEqual(d.caps.get('sc_max_out_pct'), 80);
  assert.strictEqual(d.caps.get('sc_legionella_active'), 'on');

  await mappers.applyHeatCompare(d, { elec_ct_kwh_now: 20, gas_eur_m3_now: 1.25, recommend: 'elec' });
  assert.strictEqual(d.caps.get('sc_elec_price_now'), 0.2);
  assert.strictEqual(d.caps.get('sc_gas_price_today'), 1.25);
  assert.strictEqual(d.caps.get('sc_advice'), 'elec');

  // Regression: a first valid value of exactly zero must not be treated as
  // "missing" merely because Number(null) would otherwise become 0.
  const z = new MapperDevice();
  z.caps.set('measure_power', null);
  z.caps.set('sc_pwm', null);
  z.caps.set('measure_temperature', null);
  z.caps.set('sc_max_out_pct', null);
  z.caps.set('sc_max_out_pct_control', null);
  z.caps.set('sc_elec_price_now', null);
  z.caps.set('sc_gas_price_today', null);
  await mappers.applyStatusLight(z, { temps: [{ t: 0 }], control_mode: 'NORMAL' }, { enableExtraTemps: true });
  await mappers.applyLive(z, { net_power_w: 0, duty_percent: 0 });
  await mappers.applyStatus(z, { max_output_percent: 0 });
  await mappers.applyHeatCompare(z, { elec_ct_kwh_now: 0, gas_eur_m3_now: 0, recommend: 'elec' });
  assert.strictEqual(z.caps.get('measure_temperature'), 0);
  assert.strictEqual(z.caps.get('measure_power'), 0);
  assert.strictEqual(z.caps.get('sc_pwm'), 0);
  assert.strictEqual(z.caps.get('sc_max_out_pct'), 0);
  assert.strictEqual(z.caps.get('sc_max_out_pct_control'), 0);
  assert.strictEqual(z.caps.get('sc_elec_price_now'), 0);
  assert.strictEqual(z.caps.get('sc_gas_price_today'), 0);

  // With advanced thresholds set to 0, identical values still are not real changes.
  z.settings = {
    performance_mode: 'auto', show_advanced: true, update_only_on_change: true,
    threshold_power_w: 0, threshold_pwm_pct: 0, threshold_temp_c: 0, threshold_price: 0,
  };
  const beforePowerWrites = z.writeCounts.get('measure_power') || 0;
  const beforePwmWrites = z.writeCounts.get('sc_pwm') || 0;
  const beforeTempWrites = z.writeCounts.get('measure_temperature') || 0;
  const beforeElecWrites = z.writeCounts.get('sc_elec_price_now') || 0;
  await mappers.applyStatusLight(z, { temps: [{ t: 0 }], control_mode: 'NORMAL' }, { enableExtraTemps: true });
  await mappers.applyLive(z, { net_power_w: 0, duty_percent: 0 });
  await mappers.applyHeatCompare(z, { elec_ct_kwh_now: 0, gas_eur_m3_now: 0, recommend: 'elec' });
  assert.strictEqual(z.writeCounts.get('measure_power') || 0, beforePowerWrites);
  assert.strictEqual(z.writeCounts.get('sc_pwm') || 0, beforePwmWrites);
  assert.strictEqual(z.writeCounts.get('measure_temperature') || 0, beforeTempWrites);
  assert.strictEqual(z.writeCounts.get('sc_elec_price_now') || 0, beforeElecWrites);
}

(async () => {
  await testUtilsAndHttp();
  await testFlowRegistration();
  testDefaultSettingsParity();
  await testPairing();
  await testMappers();
  console.log('Smoke tests OK');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
