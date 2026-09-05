'use strict';

const Homey = require('homey');

class SolarControllerApp extends Homey.App {

  async onInit() {
    this.log('Solar Controller app started (v1.0.2)');

    this._registerTriggerCards();
    this._registerConditionCards();
    this._registerActionCards();
  }

  _error(key) {
    return new Error(this.homey.__(key));
  }

  _requireDevice(args) {
    if (!args || !args.device) throw this._error('errors.no_device');
    return args.device;
  }

  _numberOrNaN(value) {
    if (value === null || typeof value === 'undefined' || value === '') return NaN;
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
  }

  _registerTriggerCards() {
    // Every custom trigger has a device argument. Homey requires a run listener
    // for triggers with arguments so each configured Flow can validate its state.
    const alwaysIds = [
      'advice_changed',
      'control_mode_changed',
      'elec_price_updated',
      'force_heat_off',
      'force_heat_on',
      'gas_price_updated',
      'legionella_turned_off',
      'legionella_turned_on',
      'mc_fallback_activated',
      'mc_fallback_cleared',
      'mc_role_changed',
      'pwm_changed',
      'relay_turned_off',
      'relay_turned_on',
      'sun_mode_changed',
      'temp_gate_blocked',
      'temp_gate_released',
      'temp2_changed',
      'temp3_changed',
      'temp4_changed',
    ];

    for (const id of alwaysIds) {
      this.homey.flow.getDeviceTriggerCard(id).registerRunListener(async () => true);
    }

    this.homey.flow.getDeviceTriggerCard('power_crossed_above')
      .registerRunListener(async (args, state) => {
        const threshold = Number(args && args.threshold);
        const previous = Number(state && state.previous);
        const current = Number(state && state.current);
        if (!Number.isFinite(threshold) || !Number.isFinite(previous) || !Number.isFinite(current)) return false;
        return previous <= threshold && current > threshold;
      });

    this.homey.flow.getDeviceTriggerCard('temp_crossed_above')
      .registerRunListener(async (args, state) => {
        const threshold = Number(args && args.threshold);
        const previous = Number(state && state.previous);
        const current = Number(state && state.current);
        if (!Number.isFinite(threshold) || !Number.isFinite(previous) || !Number.isFinite(current)) return false;
        return previous <= threshold && current > threshold;
      });
  }

  _registerConditionCards() {
    const condPowerAbove = this.homey.flow.getConditionCard('power_above');
    const condPwmAbove = this.homey.flow.getConditionCard('pwm_above');
    const condTempAbove = this.homey.flow.getConditionCard('temp_above');
    const condLegActive = this.homey.flow.getConditionCard('legionella_is_active');
    const condAdviceIs = this.homey.flow.getConditionCard('advice_is');
    const condElecBelow = this.homey.flow.getConditionCard('elec_price_below');
    const condGasBelow = this.homey.flow.getConditionCard('gas_price_below');
    const condSunScheduleIs = this.homey.flow.getConditionCard('sun_schedule_is');
    const condControlModeIs = this.homey.flow.getConditionCard('control_mode_is');
    const condMcRoleIs = this.homey.flow.getConditionCard('mc_role_is');
    const condMcFallbackActive = this.homey.flow.getConditionCard('mc_fallback_is_active');
    const condRelayOn = this.homey.flow.getConditionCard('relay_is_on');
    const condTempGateBlocked = this.homey.flow.getConditionCard('temp_gate_is_blocked');

    condPowerAbove.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      const threshold = this._numberOrNaN(args.threshold);
      const power = this._numberOrNaN(device.getCapabilityValue('measure_power'));
      return Number.isFinite(threshold) && Number.isFinite(power) && power > threshold;
    });

    condPwmAbove.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      const threshold = this._numberOrNaN(args.threshold);
      const pwmPercent = this._numberOrNaN(device.getCapabilityValue('sc_pwm'));
      return Number.isFinite(threshold) && Number.isFinite(pwmPercent) && pwmPercent > threshold;
    });

    condTempAbove.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      const threshold = this._numberOrNaN(args.threshold);
      const temperature = this._numberOrNaN(device.getCapabilityValue('measure_temperature'));
      return Number.isFinite(threshold) && Number.isFinite(temperature) && temperature > threshold;
    });

    condLegActive.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      const value = device.getCapabilityValue('sc_legionella_active');
      return value === 'on' || value === true || value === 1;
    });

    condAdviceIs.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      return String(device.getCapabilityValue('sc_advice') || 'unknown') === String(args.advice || 'unknown');
    });

    condElecBelow.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      const threshold = this._numberOrNaN(args.threshold);
      const value = this._numberOrNaN(device.getCapabilityValue('sc_elec_price_now'));
      return Number.isFinite(threshold) && Number.isFinite(value) && value < threshold;
    });

    condGasBelow.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      const threshold = this._numberOrNaN(args.threshold);
      const value = this._numberOrNaN(device.getCapabilityValue('sc_gas_price_today'));
      return Number.isFinite(threshold) && Number.isFinite(value) && value < threshold;
    });

    condSunScheduleIs.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      return String(device.getCapabilityValue('sc_sun_mode') || 'unknown') === String(args.mode || 'unknown');
    });

    condControlModeIs.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      const raw = String(device.getStoreValue('control_mode_raw') || '').toUpperCase();
      return raw === String(args.mode || '').toUpperCase();
    });

    condMcRoleIs.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      return String(device.getCapabilityValue('sc_mc_role') || 'unknown') === String(args.role || 'unknown');
    });

    condMcFallbackActive.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      return device.getCapabilityValue('sc_mc_fallback_active') === true;
    });

    condRelayOn.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      return device.getCapabilityValue('sc_relay_manual_on') === true;
    });

    condTempGateBlocked.registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      return device.getCapabilityValue('sc_temp_gate_blocked') === true;
    });
  }

  _registerActionCards() {
    const actions = {
      force_heat_on: (device) => device._flowForceHeat(true),
      force_heat_off: (device) => device._flowForceHeat(false),
      relay_on: (device) => device._flowRelay(true),
      relay_off: (device) => device._flowRelay(false),
      legionella_run_now: (device) => device._flowLegionellaRunNow(),
      legionella_cancel: (device) => device._flowLegionellaCancel(),
    };

    for (const [id, handler] of Object.entries(actions)) {
      this.homey.flow.getActionCard(id).registerRunListener(async (args) => handler(this._requireDevice(args)));
    }

    this.homey.flow.getActionCard('set_pwm_percent').registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      const percent = Number(args.percent);
      if (!Number.isFinite(percent)) throw this._error('errors.invalid_pwm');
      return device._flowSetPwm(percent);
    });

    this.homey.flow.getActionCard('set_max_output_pct').registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      const percent = Number(args.percent);
      if (!Number.isFinite(percent)) throw this._error('errors.invalid_max_output');
      return device._flowSetMaxOutPct(percent);
    });

    this.homey.flow.getActionCard('set_sun_schedule_mode').registerRunListener(async (args) => {
      const device = this._requireDevice(args);
      return device._flowSetSunScheduleMode(args.mode);
    });
  }
}

module.exports = SolarControllerApp;
