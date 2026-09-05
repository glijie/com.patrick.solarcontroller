'use strict';

// Helper: prefer the SDK v3 Device Trigger Card and use an App Trigger Card only as a legacy fallback.
// Never fire both variants for the same state change.
async function triggerCardAny(device, id, tokens = {}, state = {}) {
  // These cards are defined with a device argument, so prefer a Device Trigger
  // Card. Only fall back to an App Trigger Card for older/manual builds where
  // the card might have been generated differently. Never fire both.
  try {
    const dev = device.homey.flow.getDeviceTriggerCard(id);
    if (dev) {
      await dev.trigger(device, tokens, state).catch(() => {});
      return;
    }
  } catch (_) {}

  try {
    const app = device.homey.flow.getTriggerCard(id);
    if (app) await app.trigger(tokens, { device, ...state }).catch(() => {});
  } catch (_) {}
}

function _hasValue(v) {
  return v !== null && typeof v !== 'undefined' && v !== '';
}

function _numberOrNaN(v) {
  if (!_hasValue(v)) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function _numberSetting(device, id, fallback) {
  const raw = device.getSetting(id);
  if (!_hasValue(raw)) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function _changedByThreshold(previous, next, threshold) {
  if (!Number.isFinite(previous)) return true;
  const delta = Math.abs(next - previous);
  const minimum = Number.isFinite(threshold) ? Math.max(0, threshold) : 0;
  return delta > 0 && delta >= minimum;
}

function _boolValue(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'aan' || s === 'yes';
}

function normalizeSunMode(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (raw === 0 || s === '0' || s === 'always' || s === 'altijd') return 'always';
  if (raw === 1 || s === '1' || s === 'manual' || s === 'handmatig') return 'manual';
  if (raw === 2 || s === '2' || s === 'cheapest' || s === 'cheapest daylight' || s.includes('daylight')) return 'cheapest_daylight';
  if (raw === 3 || s === '3' || s === 'off' || s === 'uit') return 'off';
  return 'unknown';
}

function normalizeRole(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'master') return 'master';
  if (s === 'slave') return 'slave';
  if (s === 'standalone' || s === 'local' || s === '') return 'standalone';
  return 'unknown';
}

function controlModeLabel(device, raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  const keys = {
    NORMAL_OFF: 'control_modes.normal_off',
    NORMAL_BLOCKED: 'control_modes.normal_blocked',
    NORMAL: 'control_modes.normal',
    FORCE_HEAT: 'control_modes.force_heat',
    PRICE_BOOST: 'control_modes.price_boost',
    LEGIONELLA: 'control_modes.legionella',
  };
  if (keys[s]) {
    try { return device.homey.__(keys[s]); } catch (_) {}
  }
  if (raw !== null && typeof raw !== 'undefined' && String(raw).trim()) return String(raw);
  try { return device.homey.__('common.unknown'); } catch (_) { return 'Unknown'; }
}

function normalizeLegionellaStatus(status) {
  const raw = status?.leg_status ?? status?.legionella_state;
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'disabled') return 'disabled';
  if (s === 'running') return 'running';
  if (s === 'ok') return 'ok';
  if (s === 'due') return 'due';
  if (s === 'no_sensor' || s === 'no sensor') return 'no_sensor';
  if (s === 'idle') return 'idle';
  if (status?.legionella_running === true) return 'running';
  if (status?.legionella_running === false) return 'idle';
  return 'unknown';
}

function legionellaIsActive(status) {
  const raw =
    status?.legionella_active ??
    status?.legionella ??
    status?.legionella_running ??
    status?.legionellaRunning ??
    status?.legionellaActief ??
    status?.legio ??
    status?.legio_active;

  if (raw !== null && typeof raw !== 'undefined') {
    const s = String(raw).trim().toLowerCase();
    if (s === 'running' || s === 'active' || s === 'actief') return true;
    if (s === 'idle' || s === 'disabled' || s === 'off' || s === 'uit') return false;
    return _boolValue(raw);
  }

  const statusValue = normalizeLegionellaStatus(status);
  if (statusValue === 'running') return true;
  if (statusValue === 'disabled' || statusValue === 'idle' || statusValue === 'ok' || statusValue === 'due' || statusValue === 'no_sensor') return false;
  return null;
}

function anyTemperatureGateBlocked(status) {
  const arrays = [
    Array.isArray(status?.mc_peer_outputs) ? status.mc_peer_outputs : [],
    Array.isArray(status?.mc_local_pwm) ? status.mc_local_pwm : [],
  ];

  for (const arr of arrays) {
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const enabled = _boolValue(item.temp_gate_enabled);
      const releasedRaw = item.temp_released;
      const releasedKnown = releasedRaw !== null && typeof releasedRaw !== 'undefined';
      if (enabled && releasedKnown && !_boolValue(releasedRaw)) return true;
    }
  }
  return false;
}

async function setCapabilityIfChanged(device, cap, value, opts = {}) {
  if (!device.hasCapability(cap)) return false;
  if (value === null || typeof value === 'undefined') return false;

  const prev = device.getCapabilityValue(cap);
  if (prev === value) return false;

  await device.setCapabilityValue(cap, value).catch(() => {});

  const hadPrevious = prev !== null && typeof prev !== 'undefined';
  if (hadPrevious && opts.trigger) {
    const canTrig = typeof device._shouldTrigger === 'function';
    if (!canTrig || device._shouldTrigger(opts.trigger)) {
      const tokenName = opts.token || 'value';
      triggerCardAny(device, opts.trigger, { [tokenName]: value }, { [tokenName]: value }).catch?.(() => {});
    }
  }
  if (hadPrevious && opts.triggerOnTrue && value === true) {
    const canTrig = typeof device._shouldTrigger === 'function';
    if (!canTrig || device._shouldTrigger(opts.triggerOnTrue)) {
      triggerCardAny(device, opts.triggerOnTrue).catch?.(() => {});
    }
  }
  if (hadPrevious && opts.triggerOnFalse && value === false) {
    const canTrig = typeof device._shouldTrigger === 'function';
    if (!canTrig || device._shouldTrigger(opts.triggerOnFalse)) {
      triggerCardAny(device, opts.triggerOnFalse).catch?.(() => {});
    }
  }
  return true;
}

async function applyCommonStatus(device, status) {
  if (!status || typeof status !== 'object') return;

  if (_hasValue(status.fw)) {
    await device.setStoreValue('firmware_version', String(status.fw)).catch(() => {});
  }

  if (_hasValue(status.control_mode)) {
    const rawMode = String(status.control_mode);
    const label = controlModeLabel(device, rawMode);
    await device.setStoreValue('control_mode_raw', rawMode).catch(() => {});
    await setCapabilityIfChanged(device, 'sc_control_mode', label, {
      trigger: 'control_mode_changed',
      token: 'mode',
    });
  }

  if (_hasValue(status.sun_sched_mode)) {
    await setCapabilityIfChanged(device, 'sc_sun_mode', normalizeSunMode(status.sun_sched_mode), {
      trigger: 'sun_mode_changed',
      token: 'mode',
    });
  }

  if (_hasValue(status.relay_manual_on)) {
    await setCapabilityIfChanged(device, 'sc_relay_manual_on', _boolValue(status.relay_manual_on), {
      triggerOnTrue: 'relay_turned_on',
      triggerOnFalse: 'relay_turned_off',
    });
  }

  if (_hasValue(status.mc_role)) {
    await setCapabilityIfChanged(device, 'sc_mc_role', normalizeRole(status.mc_role), {
      trigger: 'mc_role_changed',
      token: 'role',
    });
  }

  if (_hasValue(status.mc_fallback_active)) {
    await setCapabilityIfChanged(device, 'sc_mc_fallback_active', _boolValue(status.mc_fallback_active), {
      triggerOnTrue: 'mc_fallback_activated',
      triggerOnFalse: 'mc_fallback_cleared',
    });
  }

  const peersOnline = Number(status.mc_peers_online ?? status.mc_network_slots_online ?? NaN);
  if (Number.isFinite(peersOnline)) {
    await setCapabilityIfChanged(device, 'sc_mc_peers_online', peersOnline);
  }

  const peersHealthy = Number(status.mc_peers_healthy ?? status.mc_network_slots_healthy ?? NaN);
  if (Number.isFinite(peersHealthy)) {
    await setCapabilityIfChanged(device, 'sc_mc_peers_healthy', peersHealthy);
  }

  if (_hasValue(status.mc_tcp_realtime)) {
    await setCapabilityIfChanged(device, 'sc_mc_tcp_realtime', _boolValue(status.mc_tcp_realtime));
  }

  const groupPwm = Number(status.mc_group_pwm_assigned_pct ?? NaN);
  if (Number.isFinite(groupPwm)) {
    await setCapabilityIfChanged(device, 'sc_mc_group_pwm', groupPwm);
  }

  if (Array.isArray(status?.mc_peer_outputs) || Array.isArray(status?.mc_local_pwm)) {
    const tempGateBlocked = anyTemperatureGateBlocked(status);
    await setCapabilityIfChanged(device, 'sc_temp_gate_blocked', tempGateBlocked, {
      triggerOnTrue: 'temp_gate_blocked',
      triggerOnFalse: 'temp_gate_released',
    });
  }
}

/**
 * Solar Controller — Homey App (SDK3)
 * Mappers: translate Solar Controller JSON responses -> Homey capabilities + flow triggers.
 *
 * NOTE: These helpers are intentionally side-effectful: they receive a device instance and
 * perform setCapabilityValue / flow trigger calls on it.
 * Keeping these mappings central makes device.js stay readable as the project grows.
 */

/**
 * Apply /api/status_light payload (temps + control_mode).
 * @param {import('homey').Device} device
 * @param {any} statusLight
 * @returns {Promise<number>} temp0 (primary temperature) or NaN if unavailable
 */
async function applyStatusLight(device, statusLight, cfg = {}) {
  // Performance settings (used to reduce load on Homey Pro 2016)
  const mode = String(device.getSetting('performance_mode') || 'auto').toLowerCase();
  const adv = !!device.getSetting('show_advanced');
  const updateOnly = adv ? !!device.getSetting('update_only_on_change') : true;
  const thTemp = adv ? _numberSetting(device, 'threshold_temp_c', 0.1) : (mode === 'legacy' ? 0.3 : 0.1);

  const enableExtraTemps = (cfg && Object.prototype.hasOwnProperty.call(cfg, 'enableExtraTemps'))
    ? !!cfg.enableExtraTemps
    : true;

  const temps = Array.isArray(statusLight?.temps) ? statusLight.temps : [];
  const cm = String(statusLight?.control_mode || '').toLowerCase();
  const forceOn = cm.includes('force');

  await applyCommonStatus(device, statusLight);

  // Keep Force heat toggle in sync with the controller state
  if (device.hasCapability('sc_force_heat')) {
    const prev = device.getCapabilityValue('sc_force_heat');
    if (prev !== forceOn) {
      await device.setCapabilityValue('sc_force_heat', forceOn).catch(() => {});
      if (prev !== null && typeof prev !== 'undefined') {
        const triggerId = forceOn ? 'force_heat_on' : 'force_heat_off';
        const canTrig = typeof device._shouldTrigger === 'function';
        if (!canTrig || device._shouldTrigger(triggerId)) {
          await triggerCardAny(device, triggerId, {}, { active: forceOn });
        }
      }
    }
  }

  const mappings = [
    { idx: 0, cap: 'measure_temperature' },
    { idx: 1, cap: 'measure_temperature.2' },
    { idx: 2, cap: 'measure_temperature.3' },
    { idx: 3, cap: 'measure_temperature.4' },
  ];

  let temp0 = NaN;

  for (const m of mappings) {
    if (m.idx > 0 && !enableExtraTemps) continue;
    const tObj = temps[m.idx];
    const tVal = (tObj && typeof tObj === 'object') ? Number(tObj.t ?? NaN) : Number(tObj ?? NaN);
    if (!Number.isFinite(tVal)) continue;

    if (m.idx === 0) temp0 = tVal;

    if (device.hasCapability(m.cap)) {
      const prev = device.getCapabilityValue(m.cap);
      const prevNum = _numberOrNaN(prev);
      const hadPrevious = Number.isFinite(prevNum);
      const changed = (!updateOnly) || _changedByThreshold(prevNum, tVal, thTemp);
      if (changed) {
        await device.setCapabilityValue(m.cap, tVal).catch(() => {});

        // Do not fire change Flows on the first value after pairing; from the
        // second valid value onward, fire only for a real update.
        const canTrig = typeof device._shouldTrigger === 'function';
        if (hadPrevious && m.cap === 'measure_temperature.2' && device._trgTemp2Changed) {
          if (!canTrig || device._shouldTrigger('temp2_changed')) {
            await device._trgTemp2Changed.trigger(device, { temperature: tVal }, { temperature: tVal }).catch(() => {});
          }
        } else if (hadPrevious && m.cap === 'measure_temperature.3' && device._trgTemp3Changed) {
          if (!canTrig || device._shouldTrigger('temp3_changed')) {
            await device._trgTemp3Changed.trigger(device, { temperature: tVal }, { temperature: tVal }).catch(() => {});
          }
        } else if (hadPrevious && m.cap === 'measure_temperature.4' && device._trgTemp4Changed) {
          if (!canTrig || device._shouldTrigger('temp4_changed')) {
            await device._trgTemp4Changed.trigger(device, { temperature: tVal }, { temperature: tVal }).catch(() => {});
          }
        }
      }
    }
  }

  return temp0;
}

/**
 * Apply /api/live payload (net_power_w + duty_percent).
 * @param {import('homey').Device} device
 * @param {any} live
 * @returns {Promise<{ power: number, pwm: number }>} values (NaN if unavailable)
 */
async function applyLive(device, live) {
  const mode = String(device.getSetting('performance_mode') || 'auto').toLowerCase();
  const adv = !!device.getSetting('show_advanced');
  const updateOnly = adv ? !!device.getSetting('update_only_on_change') : true;
  const thPower = adv ? _numberSetting(device, 'threshold_power_w', 5) : (mode === 'legacy' ? 20 : 5);
  const thPwm = adv ? _numberSetting(device, 'threshold_pwm_pct', 1) : (mode === 'legacy' ? 3 : 1);

  await applyCommonStatus(device, live);

  const power = Number(live?.net_power_w ?? NaN);
  if (Number.isFinite(power)) {
    const prev = _numberOrNaN(device.getCapabilityValue('measure_power'));
    const changed = (!updateOnly) || _changedByThreshold(prev, power, thPower);
    if (changed) await device.setCapabilityValue('measure_power', power).catch(() => {});
  }

  const duty = Number(live?.duty_percent ?? NaN);
  const pwm = Number.isFinite(duty) ? Math.max(0, Math.min(100, Math.round(duty))) : NaN;
  if (Number.isFinite(pwm)) {
    const prev = _numberOrNaN(device.getCapabilityValue('sc_pwm'));
    const changed = (!updateOnly) || _changedByThreshold(prev, pwm, thPwm);
    if (changed) await device.setCapabilityValue('sc_pwm', pwm).catch(() => {});
  }

  return { power, pwm };
}

/**
 * Apply /api/status payload (max_output_percent + legionella_active).
 * @param {import('homey').Device} device
 * @param {any} status
 */
async function applyStatus(device, status) {
  const mode = String(device.getSetting('performance_mode') || 'auto').toLowerCase();
  const adv = !!device.getSetting('show_advanced');
  const updateOnly = adv ? !!device.getSetting('update_only_on_change') : true;

  await applyCommonStatus(device, status);

  // Max output limit (% safety)
  const maxOut = Number(status?.max_output_percent ?? NaN);
  if (device.hasCapability('sc_max_out_pct')) {
    if (Number.isFinite(maxOut)) {
      const prev = _numberOrNaN(device.getCapabilityValue('sc_max_out_pct'));
      const changed = (!updateOnly) || (!Number.isFinite(prev)) || (Math.abs(maxOut - prev) >= 1);
      if (changed) await device.setCapabilityValue('sc_max_out_pct', Math.round(maxOut)).catch(() => {});
    }
  }

  if (device.hasCapability('sc_max_out_pct_control')) {
    if (Number.isFinite(maxOut)) {
      const prev = _numberOrNaN(device.getCapabilityValue('sc_max_out_pct_control'));
      const changed = (!updateOnly) || (!Number.isFinite(prev)) || (Math.abs(maxOut - prev) >= 1);
      if (changed) await device.setCapabilityValue('sc_max_out_pct_control', Math.round(maxOut)).catch(() => {});
    }
  }

  // Legionella active status (optional): accept various keys from firmware
  const legionellaOn = legionellaIsActive(status);
  if (legionellaOn !== null && device.hasCapability('sc_legionella_active')) {
    const prev = device.getCapabilityValue('sc_legionella_active');
    const next = legionellaOn ? 'on' : 'off';

    await device.setCapabilityValue('sc_legionella_active', next).catch(() => {});

    // Trigger flow cards on state change (throttled)
    if (prev !== next) {
      const tokens = {
        active: next === 'on',
        state: next === 'on' ? device.homey.__('common.on') : device.homey.__('common.off'),
      };
      const canTrig = typeof device._shouldTrigger === 'function';
      if (next === 'on') {
        if (!canTrig || device._shouldTrigger('legionella_turned_on')) {
          await triggerCardAny(device, 'legionella_turned_on', tokens, { active: true });
        }
      } else {
        if (!canTrig || device._shouldTrigger('legionella_turned_off')) {
          await triggerCardAny(device, 'legionella_turned_off', tokens, { active: false });
        }
      }
    }
  }

  if (legionellaOn !== null && device.hasCapability('sc_legionella_manual')) {
    await setCapabilityIfChanged(device, 'sc_legionella_manual', legionellaOn);
  }

  if (device.hasCapability('sc_legionella_status')) {
    await setCapabilityIfChanged(device, 'sc_legionella_status', normalizeLegionellaStatus(status));
  }
}

/**
 * Apply /api/heat_compare payload (prices + advice + triggers).
 * @param {import('homey').Device} device
 * @param {any} hc
 */
async function applyHeatCompare(device, hc) {
  const mode = String(device.getSetting('performance_mode') || 'auto').toLowerCase();
  const adv = !!device.getSetting('show_advanced');
  const updateOnly = adv ? !!device.getSetting('update_only_on_change') : true;
  const thPrice = adv ? _numberSetting(device, 'threshold_price', 0.001) : (mode === 'legacy' ? 0.005 : 0.001);

  // Electricity price now: cent/kWh -> €/kWh
  const elecCt = Number(hc?.elec_ct_kwh_now ?? NaN);
  if (Number.isFinite(elecCt) && device.hasCapability('sc_elec_price_now')) {
    const val = elecCt / 100;
    const prev = _numberOrNaN(device.getCapabilityValue('sc_elec_price_now'));
    const changed = (!updateOnly) || _changedByThreshold(prev, val, thPrice);
    if (changed) await device.setCapabilityValue('sc_elec_price_now', val).catch(() => {});
  }

  // Gas price now: €/m³
  const gasEur = Number(hc?.gas_eur_m3_now ?? NaN);
  if (Number.isFinite(gasEur) && device.hasCapability('sc_gas_price_today')) {
    const prev = _numberOrNaN(device.getCapabilityValue('sc_gas_price_today'));
    const changed = (!updateOnly) || _changedByThreshold(prev, gasEur, thPrice);
    if (changed) await device.setCapabilityValue('sc_gas_price_today', gasEur).catch(() => {});
  }

  // Heating advice: recommend = 'gas' | 'elec'
  if (device.hasCapability('sc_advice') && hc?.recommend !== null && typeof hc?.recommend !== 'undefined') {
    const rec = String(hc.recommend).trim().toLowerCase();
    const next = (rec === 'gas') ? 'gas' : (rec === 'elec' ? 'elec' : 'unknown');
    await device.setCapabilityValue('sc_advice', next).catch(() => {});
  }

  // Trigger flows on meaningful changes (avoid spam)
  const prevElec = device.getStoreValue('prev_elec_price_now');
  const prevGas = device.getStoreValue('prev_gas_price_today');
  const prevAdvice = device.getStoreValue('prev_advice');

  const elecNow = Number.isFinite(elecCt) ? (elecCt / 100) : null;
  const gasNow = Number.isFinite(gasEur) ? gasEur : null;

  if (elecNow !== null) {
    const canTrig = typeof device._shouldTrigger === 'function';
    if (typeof prevElec === 'number' && _changedByThreshold(prevElec, elecNow, thPrice)) {
      if (!canTrig || device._shouldTrigger('elec_price_updated')) {
        triggerCardAny(device, 'elec_price_updated', { elec_price_now: elecNow }, { elec_price_now: elecNow }).catch?.(() => {});
      }
    }
    device.setStoreValue('prev_elec_price_now', elecNow).catch(() => {});
  }

  if (gasNow !== null) {
    const canTrig = typeof device._shouldTrigger === 'function';
    if (typeof prevGas === 'number' && _changedByThreshold(prevGas, gasNow, thPrice)) {
      if (!canTrig || device._shouldTrigger('gas_price_updated')) {
        triggerCardAny(device, 'gas_price_updated', { gas_price_today: gasNow }, { gas_price_today: gasNow }).catch?.(() => {});
      }
    }
    device.setStoreValue('prev_gas_price_today', gasNow).catch(() => {});
  }

  // Advice trigger: only when we have a previous value (avoid trigger spam on first poll)
  if (device.hasCapability('sc_advice')) {
    const curAdvice = String(device.getCapabilityValue('sc_advice') || 'unknown');
    if (typeof prevAdvice === 'string' && curAdvice !== prevAdvice) {
      const canTrig = typeof device._shouldTrigger === 'function';
      const adviceText = (curAdvice === 'gas')
        ? device.homey.__('advice.gas')
        : (curAdvice === 'elec' ? device.homey.__('advice.elec') : device.homey.__('common.unknown'));
      if (!canTrig || device._shouldTrigger('advice_changed')) {
        triggerCardAny(device, 'advice_changed', {
          advice: adviceText,
          advice_id: curAdvice,
          elec_price_now: (elecNow !== null ? elecNow : Number(device.getCapabilityValue('sc_elec_price_now'))),
          gas_price_today: (gasNow !== null ? gasNow : Number(device.getCapabilityValue('sc_gas_price_today'))),
        }, { advice_id: curAdvice }).catch?.(() => {});
      }
    }
  }

  // Persist for next comparison
  device.setStoreValue('prev_advice', String(device.getCapabilityValue('sc_advice') || 'unknown')).catch(() => {});
}

module.exports = {
  applyStatusLight,
  applyLive,
  applyStatus,
  applyHeatCompare,
  normalizeSunMode,
};
