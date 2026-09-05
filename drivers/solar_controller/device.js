'use strict';

const Homey = require('homey');
const { SolarControllerApiClient } = require('../../lib/sc_api_client');
const { sleep, normalizeBaseUrl } = require('../../lib/sc_utils');
const { SolarControllerPoller } = require('../../lib/sc_poller');
const mappers = require('../../lib/sc_mappers');

const STATUS_CAPABILITY_DEFAULTS = {
  sc_control_mode: 'unknown',
  sc_sun_mode: 'unknown',
  sc_relay_manual_on: false,
  sc_legionella_manual: false,
  sc_max_out_pct_control: 0,
  sc_legionella_status: 'unknown',
  sc_mc_role: 'unknown',
  sc_mc_fallback_active: false,
  sc_mc_group_pwm: 0,
  sc_mc_peers_online: 0,
  sc_mc_peers_healthy: 0,
  sc_mc_tcp_realtime: false,
  sc_temp_gate_blocked: false,
};

const CONTROL_CAPABILITY_OPTIONS = {
  sc_force_heat: {
    title: { en: 'Force heat', nl: 'Force heat' },
    uiComponent: 'toggle',
  },
  sc_relay_manual_on: {
    title: { en: 'Manual relay', nl: 'Handmatig relais' },
    uiComponent: 'toggle',
  },
  sc_sun_mode: {
    title: { en: 'Sun schedule', nl: 'Zonregeling' },
    uiComponent: 'picker',
  },
  sc_max_out_pct: {
    title: { en: 'PWM limit', nl: 'PWM-limiet' },
    uiComponent: 'sensor',
    units: { en: '%', nl: '%' },
    decimals: 0,
  },
  sc_max_out_pct_control: {
    title: { en: 'Set PWM limit', nl: 'PWM-limiet instellen' },
    uiComponent: 'slider',
    decimals: 0,
    min: 0,
    max: 100,
    step: 1,
  },
  sc_legionella_manual: {
    title: { en: 'Legionella cycle', nl: 'Legionella-cyclus' },
    uiComponent: 'toggle',
  },
};


class SolarControllerDevice extends Homey.Device {

  async onInit() {
    this.log('SolarControllerDevice init (v1.0.1)');

    // Polling loop helper (timer + overlap protection + generation guard)
    this._poller = new SolarControllerPoller({
      getIntervalMs: () => this._pollIntervalMs(),
      pollFn: (gen) => this._pollOnce(gen),
      onError: (err) => this._handlePollError(err),
    });

    // IMPORTANT:
    // Homey calls onSettings() before the new settings are committed.
    // During onSettings(), this.getSetting('host') can still return the OLD value.
    // This can otherwise require the Host setting to be applied twice before polling uses the new value.
    // We solve this by caching the new (pending) settings in-memory and using them
    // immediately for the polling loop.
    this._settingsCache = {
      host: this.getSetting('host'),
      poll_interval: this.getSetting('poll_interval'),
      timeout_ms: this.getSetting('timeout_ms'),
    };

    this._lastHeatCompareMs = 0;
    this._connectionFailures = 0;
    this._lastUnavailableMessage = '';

    // Trigger throttling (helps Homey Pro 2016)
    this._triggerLastMs = {};
    this._lastAnyTriggerMs = 0;

    // API client (lazy baseUrl/timeout so settings changes apply immediately)
    this._api = new SolarControllerApiClient(() => this._baseUrl(), () => this._timeoutMs(), () => this._maxConcurrentRequests());


    // Ensure the Force heat toggle is visible immediately in the UI.
    // Homey sometimes hides boolean toggles when the value is still null.
    if (this.hasCapability('sc_force_heat')) {
      const cur = this.getCapabilityValue('sc_force_heat');
      if (cur === null || cur === undefined) {
        await this.setCapabilityValue('sc_force_heat', false).catch(() => {});
      }
    }

    // Last values for trigger crossing detection
    this._lastPower = null;
    this._lastPwm = null;
    this._lastTemp = null;

    // Capability listener for Force heat toggle
    if (this.hasCapability('sc_force_heat')) {
      this.registerCapabilityListener('sc_force_heat', async (value) => {
        // User toggled Force heat in the UI
        await this._flowForceHeat(!!value);
      });
    }


    // Capability migration summary (avoid log spam)
    const _addedCaps = [];
    // Ensure Legionella tile exists + is visible in Homey UI.
    // Rationale:
    // - Homey can keep an existing device's capability-set cached even after app updates.
    // - Enum/boolean capabilities may be hidden until a first value is set.
    // By adding the capability at runtime (if missing) and setting a default value,
    // the tile becomes visible and usable in Flows without requiring a re-pair.
    try {
      if (!this.hasCapability('sc_legionella_active')) {
        await this.addCapability('sc_legionella_active');
        _addedCaps.push('sc_legionella_active');
      }
      const cur = this.getCapabilityValue('sc_legionella_active');
      if (cur === null || typeof cur === 'undefined') {
        await this.setCapabilityValue('sc_legionella_active', 'off');
      }
    } catch (e) {
      this.error('Failed to ensure sc_legionella_active capability', e);
    }


    // Ensure Price/Advice tiles exist + are visible in Homey UI (runtime addCapability).
    // Data comes from /api/heat_compare on the Solar Controller.
    try {
      if (!this.hasCapability('sc_elec_price_now')) {
        await this.addCapability('sc_elec_price_now');
        _addedCaps.push('sc_elec_price_now');
      }
      if (!this.hasCapability('sc_gas_price_today')) {
        await this.addCapability('sc_gas_price_today');
        _addedCaps.push('sc_gas_price_today');
      }
      if (!this.hasCapability('sc_advice')) {
        await this.addCapability('sc_advice');
        _addedCaps.push('sc_advice');
      }
      const curAdvice = this.getCapabilityValue('sc_advice');
      if (curAdvice === null || typeof curAdvice === 'undefined') {
        await this.setCapabilityValue('sc_advice', 'unknown').catch(() => {});
      }
    } catch (e) {
      this.error('Failed to ensure price/advice capabilities', e);
    }

    // Add firmware v2026.04.x status capabilities to existing paired devices.
    // Existing capability ids stay untouched, so older users do not need to re-pair.
    try {
      if (this.hasCapability('sc_fw_version')) {
        await this.removeCapability('sc_fw_version');
      }
      if (this.hasCapability('sc_max_out_pct_tile')) {
        await this.removeCapability('sc_max_out_pct_tile');
      }
      for (const [cap, defaultValue] of Object.entries(STATUS_CAPABILITY_DEFAULTS)) {
        if (!this.hasCapability(cap)) {
          await this.addCapability(cap);
          _addedCaps.push(cap);
        }
        const cur = this.getCapabilityValue(cap);
        if (cur === null || typeof cur === 'undefined') {
          await this.setCapabilityValue(cap, defaultValue).catch(() => {});
        }
      }
    } catch (e) {
      this.error('Failed to ensure firmware status capabilities', e);
    }

    if (this.hasCapability('sc_relay_manual_on')) {
      this.registerCapabilityListener('sc_relay_manual_on', async (value) => {
        await this._flowRelay(!!value);
      });
    }

    if (this.hasCapability('sc_sun_mode')) {
      this.registerCapabilityListener('sc_sun_mode', async (value) => {
        await this._flowSetSunScheduleMode(value);
      });
    }

    if (this.hasCapability('sc_max_out_pct_control')) {
      this.registerCapabilityListener('sc_max_out_pct_control', async (value) => {
        const result = await this._flowSetMaxOutPct(value, { fromCapability: true });
        const normalized = this._normalizeMaxOutPct(value, true);
        if (normalized !== Number(value)) {
          await this.setCapabilityValue('sc_max_out_pct_control', normalized).catch(() => {});
        }
        return result;
      });
    }

    if (this.hasCapability('sc_legionella_manual')) {
      this.registerCapabilityListener('sc_legionella_manual', async (value) => {
        await this._flowLegionellaManual(!!value);
      });
    }

    if (_addedCaps.length) {
      this.log(`Capability migration: added ${_addedCaps.join(', ')}`);
    }

    await this._applyControlCapabilityOptions();

    // All custom triggers are device trigger cards. app.js registers their
    // run listeners; this Device only fires the event for this specific ESP.
    this._trgPowerCrossDev = this.homey.flow.getDeviceTriggerCard('power_crossed_above');
    this._trgPwmChangedDev = this.homey.flow.getDeviceTriggerCard('pwm_changed');
    this._trgTempCrossDev = this.homey.flow.getDeviceTriggerCard('temp_crossed_above');

    // Additional triggers for the extra temperature probes
    this._trgTemp2Changed = this.homey.flow.getDeviceTriggerCard('temp2_changed');
    this._trgTemp3Changed = this.homey.flow.getDeviceTriggerCard('temp3_changed');
    this._trgTemp4Changed = this.homey.flow.getDeviceTriggerCard('temp4_changed');

    await this._startPolling();
  }

  async onUninit() {
    this._stopPolling();
  }

  async onSettings({ changedKeys, newSettings }) {
    // Cache the new settings so polling uses them immediately.
    if (newSettings && typeof newSettings === 'object') {
      this._settingsCache = {
        ...this._settingsCache,
        ...newSettings,
      };
    }

    const pollingKeys = [
      'host', 'performance_mode', 'show_advanced', 'poll_interval', 'adaptive_polling',
      'poll_active_interval', 'poll_idle_interval', 'max_concurrent_requests', 'timeout_ms',
      'enable_heat_compare_poll', 'heat_compare_interval', 'enable_extra_temps',
    ];
    if (changedKeys.some(key => pollingKeys.includes(key))) {
      this._stopPolling();
      await sleep(200);
      await this._startPolling();
    }

    if (changedKeys.includes('debug_logging')) {
      this.log(`Detailed logging ${newSettings.debug_logging ? 'enabled' : 'disabled'}`);
    }
  }
  _stopPolling() {
    if (this._poller) this._poller.stop();
  }

  async _applyControlCapabilityOptions() {
    if (typeof this.setCapabilityOptions !== 'function') return;

    for (const [capabilityId, options] of Object.entries(CONTROL_CAPABILITY_OPTIONS)) {
      if (!this.hasCapability(capabilityId)) continue;
      await this.setCapabilityOptions(capabilityId, options).catch((e) => {
        this.error(`Failed to update capability options for ${capabilityId}`, e);
      });
    }
  }

  _debug(...args) {
    if (this.getSetting('debug_logging')) this.log('[debug]', ...args);
  }

  _translated(key, fallback) {
    try {
      const value = this.homey.__(key);
      return value && value !== key ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  _handlePollError(err) {
    this._connectionFailures = (this._connectionFailures || 0) + 1;
    const message = err && err.message ? err.message : String(err || 'Connection error');
    if (this._connectionFailures === 1) {
      this.error('Solar Controller connection error:', message);
    } else {
      this._debug(`Connection still unavailable (${this._connectionFailures} failed polls):`, message);
    }
  }

  _baseUrl() {
    const host = (this._settingsCache && this._settingsCache.host !== undefined)
      ? this._settingsCache.host
      : this.getSetting('host');
    return normalizeBaseUrl(host);
  }

  _perfMode() {
    return String(this.getSetting('performance_mode') || 'auto').toLowerCase();
  }

  _showAdvanced() {
    return !!this.getSetting('show_advanced');
  }

  _effectiveNumberSetting(id, fallback) {
    const v = this.getSetting(id);
    if (v === null || typeof v === 'undefined' || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  _shouldTrigger(key) {
    // Debounce: block bursts of triggers across different cards.
    const mode = this._perfMode();
    const adv = this._showAdvanced();

    const debounceMs = adv
      ? this._effectiveNumberSetting('trigger_debounce_ms', 250)
      : (mode === 'legacy' ? 750 : 250);

    const minIntervalS = adv
      ? this._effectiveNumberSetting('trigger_min_interval_s', 2)
      : (mode === 'legacy' ? 8 : 2);

    const now = Date.now();
    if (debounceMs > 0 && (now - (this._lastAnyTriggerMs || 0)) < debounceMs) return false;

    const last = Number(this._triggerLastMs && this._triggerLastMs[key]) || 0;
    if (minIntervalS > 0 && (now - last) < (minIntervalS * 1000)) return false;

    if (!this._triggerLastMs) this._triggerLastMs = {};
    this._triggerLastMs[key] = now;
    this._lastAnyTriggerMs = now;
    return true;
  }

  _pollIntervalMs() {
    const mode = this._perfMode();
    const adv = this._showAdvanced();

    // Legacy defaults for Homey Pro 2016 (when advanced is hidden)
    const legacyBaseS = 25;
    const normalBaseS = 5;

    let baseS;
    const v = (this._settingsCache && this._settingsCache.poll_interval !== undefined)
      ? this._settingsCache.poll_interval
      : this.getSetting('poll_interval');
    const configured = Number(v || normalBaseS);
    // For Legacy we apply safer defaults unless the user explicitly enables advanced.
    baseS = (!adv && mode === 'legacy') ? legacyBaseS : configured;

    // Adaptive polling (optional)
    const adaptive = adv ? !!this.getSetting('adaptive_polling') : (mode === 'legacy');
    if (adaptive) {
      const activeS = adv ? this._effectiveNumberSetting('poll_active_interval', 10) : 15;
      const idleS = adv ? this._effectiveNumberSetting('poll_idle_interval', 30) : 45;

      const force = !!this.getCapabilityValue('sc_force_heat');
      const pwm = Number(this.getCapabilityValue('sc_pwm'));
      const active = force || (Number.isFinite(pwm) && pwm > 0);
      baseS = active ? activeS : idleS;
    }

    const clamped = Number.isFinite(baseS) ? Math.max(2, Math.min(600, Math.round(baseS))) : normalBaseS;
    return clamped * 1000;
  }

  _timeoutMs() {
    const mode = this._perfMode();
    const adv = this._showAdvanced();

    const legacyDefault = 6000;
    const normalDefault = 2500;

    const v = (this._settingsCache && this._settingsCache.timeout_ms !== undefined)
      ? this._settingsCache.timeout_ms
      : this.getSetting('timeout_ms');

    const base = adv
      ? Number(v || normalDefault)
      : (mode === 'legacy' ? legacyDefault : Number(v || normalDefault));

    const clamped = Number.isFinite(base) ? Math.max(500, Math.min(20000, Math.round(base))) : normalDefault;
    return clamped;
  }


  _maxConcurrentRequests() {
    const mode = this._perfMode();
    const adv = this._showAdvanced();

    const legacyDefault = 1;
    const normalDefault = 2;

    const v = (this._settingsCache && this._settingsCache.max_concurrent_requests !== undefined)
      ? this._settingsCache.max_concurrent_requests
      : this.getSetting('max_concurrent_requests');

    const base = adv
      ? Number(v || normalDefault)
      : (mode === 'legacy' ? legacyDefault : Number(v || normalDefault));

    const clamped = Number.isFinite(base) ? Math.max(1, Math.min(5, Math.floor(base))) : normalDefault;
    return clamped;
  }
  _pwmSetEndpoint() {
    const ep = String(this.getSetting('pwm_set_endpoint') || '/api/pwm').trim();
    return ep.startsWith('/') ? ep : `/${ep}`;
  }

  _requireControllerAddress() {
    if (!this._baseUrl()) {
      throw new Error(this._translated('errors.host_required', 'Set the controller address in device settings.'));
    }
  }

  async _getJson(path) {
    this._requireControllerAddress();
    return this._api.getJson(path);
  }

  async _postJson(path, body) {
    this._requireControllerAddress();
    return this._api.postJson(path, body);
  }

  async _startPolling() {
    const base = this._baseUrl();
    if (!base) {
      const message = this._translated('errors.host_required', 'Set the controller address in device settings.');
      this._lastUnavailableMessage = message;
      await this.setUnavailable(message).catch(() => {});
      return;
    }

    this._debug('Starting polling for', base, `interval=${this._pollIntervalMs()}ms`, `timeout=${this._timeoutMs()}ms`);
    this._poller.start(50);
  }

  async _pollOnce(gen) {
    try {
      // Temps in /api/status_light
      const statusLight = await this._getJson('/api/status_light');
      const mode = String(this.getSetting('performance_mode') || 'auto').toLowerCase();
      const showAdv = !!this.getSetting('show_advanced');
      const enableExtraTemps = showAdv ? !!this.getSetting('enable_extra_temps') : (mode === 'legacy' ? false : true);
      const temp0 = await mappers.applyStatusLight(this, statusLight, { enableExtraTemps });
// Power + PWM in /api/live
      const live = await this._getJson('/api/live');
      const { power, pwm } = await mappers.applyLive(this, live);

      // Max output limit (% safety) in /api/status
      if (this.hasCapability('sc_max_out_pct')) {
        try {
          const status = await this._getJson('/api/status');
          await mappers.applyStatus(this, status);

          // Prices + advice in /api/heat_compare (optional + throttled for older Homeys)
          try {
            const mode = String(this.getSetting('performance_mode') || 'auto').toLowerCase();
            const showAdv = !!this.getSetting('show_advanced');

            // Defaults: normal keeps current behaviour; legacy reduces load
            const legacyDefaultEnabled = false;
            const legacyDefaultIntervalS = 180;

            const enabled = showAdv ? !!this.getSetting('enable_heat_compare_poll') : (mode === 'legacy' ? legacyDefaultEnabled : true);
            const intervalS = showAdv ? Number(this.getSetting('heat_compare_interval') || 60) : (mode === 'legacy' ? legacyDefaultIntervalS : 60);

            if (enabled) {
              const now = Date.now();
              const due = (now - (this._lastHeatCompareMs || 0)) >= Math.max(10, intervalS) * 1000;
              if (due) {
                const hc = await this._getJson('/api/heat_compare');
                await mappers.applyHeatCompare(this, hc);
                this._lastHeatCompareMs = now;
              }
            }
          } catch (e) {
            // Ignore: keep last known values
          }
} catch (e) {
          // Ignore: keep last known value
        }
      }

      // Flow triggers. For threshold cards we pass previous/current values in
      // state; app.js compares them with the threshold configured in each Flow.
      const lastPower = this._lastPower;
      const lastPwm = this._lastPwm;
      const lastTemp = this._lastTemp;

      if (Number.isFinite(power) && Number.isFinite(lastPower) && power !== lastPower) {
        await this._trgPowerCrossDev.trigger(
          this,
          { power },
          { previous: lastPower, current: power, power, pwm, temperature: temp0 },
        ).catch((e) => this._debug('Flow trigger power_crossed_above failed:', e && (e.message || e)));
      }

      if (Number.isFinite(pwm) && Number.isFinite(lastPwm) && pwm !== lastPwm) {
        await this._trgPwmChangedDev.trigger(
          this,
          { pwm },
          { previous: lastPwm, current: pwm, power, pwm, temperature: temp0 },
        ).catch((e) => this._debug('Flow trigger pwm_changed failed:', e && (e.message || e)));
      }

      if (Number.isFinite(temp0) && Number.isFinite(lastTemp) && temp0 !== lastTemp) {
        await this._trgTempCrossDev.trigger(
          this,
          { temperature: temp0 },
          { previous: lastTemp, current: temp0, power, pwm, temperature: temp0 },
        ).catch((e) => this._debug('Flow trigger temp_crossed_above failed:', e && (e.message || e)));
      }

      // Update last values for conditions state
      this._lastPower = Number.isFinite(power) ? power : this._lastPower;
      this._lastPwm = Number.isFinite(pwm) ? pwm : this._lastPwm;
      this._lastTemp = Number.isFinite(temp0) ? temp0 : this._lastTemp;

      const recovered = (this._connectionFailures || 0) > 0;
      this._connectionFailures = 0;
      this._lastUnavailableMessage = '';
      await this.setAvailable().catch(() => {});
      if (recovered) this.log('Solar Controller connection restored');
    } catch (e) {
      const rawMessage = e && e.message ? e.message : '';
      const message = rawMessage === 'Request timeout'
        ? this._translated('errors.request_timeout', 'The Solar Controller did not respond in time.')
        : this._translated('errors.connection_error', 'Cannot reach the Solar Controller.');
      if (message !== this._lastUnavailableMessage) {
        this._lastUnavailableMessage = message;
        await this.setUnavailable(message).catch(() => {});
      }
      throw e;
    }
  }

  // ===== Flow Action helpers =====
  async _flowForceHeat(on) {
    // Best-effort endpoint used in firmware
    return this._postJson('/api/force_heat', { on: !!on });
  }

  async _flowSetPwm(percent) {
    const p = Math.max(0, Math.min(100, Math.round(Number(percent))));
    const endpoint = this._pwmSetEndpoint();

    // Try multiple payload keys (firmware variations)
    try {
      return await this._postJson(endpoint, { duty_percent: p, pwm_percent: p, pwm: p });
    } catch (e) {
      // fallback: some firmwares may expect { duty: p }
      try {
        return await this._postJson(endpoint, { duty: p });
      } catch (directError) {
        return this._flowSetPwmViaForceHeat(p, directError);
      }
    }
  }

  async _flowSetPwmViaForceHeat(percent, originalError) {
    const p = Math.max(0, Math.min(100, Math.round(Number(percent))));

    // Newer firmware no longer exposes a direct /api/pwm route. Emulate the
    // legacy action with max_output_percent + Force Heat and restore on PWM 0.
    if (p <= 0) {
      await this._flowForceHeat(false);
      const wasEmulated = !!this.getStoreValue('pwm_emulation_active');
      const prevMax = Number(this.getStoreValue('pwm_emulation_prev_max_out'));
      if (wasEmulated && Number.isFinite(prevMax)) {
        await this._flowSetMaxOutPct(prevMax).catch(() => {});
      }
      await this.setStoreValue('pwm_emulation_active', false).catch(() => {});
      await this.setStoreValue('pwm_emulation_prev_max_out', null).catch(() => {});
      return { ok: true, emulated: true };
    }

    const capMaxRaw = this.getCapabilityValue('sc_max_out_pct');
    let previousMax = (capMaxRaw === null || typeof capMaxRaw === 'undefined' || capMaxRaw === '')
      ? NaN
      : Number(capMaxRaw);
    try {
      const status = await this._getJson('/api/status');
      const fromStatus = Number(status?.max_output_percent);
      if (Number.isFinite(fromStatus)) previousMax = fromStatus;
    } catch (_) {}

    if (!Number.isFinite(previousMax) && originalError) throw originalError;

    if (!this.getStoreValue('pwm_emulation_active')) {
      await this.setStoreValue('pwm_emulation_prev_max_out', previousMax).catch(() => {});
    }
    await this._flowSetMaxOutPct(p);
    await this._flowForceHeat(true);
    await this.setStoreValue('pwm_emulation_active', true).catch(() => {});
    return { ok: true, emulated: true };
  }

  async _flowSetMaxOutPct(percent, opts = {}) {
    const p = this._normalizeMaxOutPct(percent, opts.fromCapability === true);
    // Firmware: POST /api/config { "max_out_pct": <float> }
    return this._postJson('/api/config', { max_out_pct: p });
  }

  _normalizeMaxOutPct(percent, fromCapability = false) {
    let p = Number(percent);
    if (!Number.isFinite(p)) throw new Error(this._translated('errors.invalid_max_output', 'Invalid maximum output percentage.'));
    // Homey sliders without explicit min/max can report 70% as 0.7.
    // Keep flow actions as literal percentages, but correct legacy slider values.
    if (fromCapability && p > 0 && p < 1) p *= 100;
    if (fromCapability) p = Math.round(p);
    return Math.max(0, Math.min(100, p));
  }

  async _flowSetSunScheduleMode(mode) {
    const s = String(mode || '').trim().toLowerCase();
    const map = {
      always: 0,
      manual: 1,
      cheapest_daylight: 2,
      off: 3,
    };
    if (!Object.prototype.hasOwnProperty.call(map, s)) throw new Error(this._translated('errors.invalid_sun_mode', 'Invalid sun schedule mode.'));
    return this._postJson('/api/config', { sun_s_mode: map[s] });
  }

  async _flowRelay(on) {
    try {
      return await this._postJson('/api/relay', { on: !!on });
    } catch (e) {
      return this._postJson(on ? '/api/relay/on' : '/api/relay/off', {});
    }
  }

  async _flowLegionellaRunNow() {
    return this._postJson('/api/legionella/run_now', { start: true });
  }

  async _flowLegionellaCancel() {
    return this._postJson('/api/legionella/cancel', {});
  }

  async _flowLegionellaManual(on) {
    return on ? this._flowLegionellaRunNow() : this._flowLegionellaCancel();
  }

}

module.exports = SolarControllerDevice;
