'use strict';

const Homey = require('homey');
const { httpGetJson } = require('../../lib/http');
const { normalizeBaseUrl } = require('../../lib/sc_utils');

const DEFAULT_DEVICE_SETTINGS = Object.freeze({
  host: '',
  performance_mode: 'auto',
  show_advanced: false,
  poll_interval: 5,
  adaptive_polling: false,
  poll_active_interval: 10,
  poll_idle_interval: 30,
  enable_heat_compare_poll: true,
  heat_compare_interval: 60,
  update_only_on_change: true,
  threshold_power_w: 5,
  threshold_pwm_pct: 1,
  threshold_temp_c: 0.1,
  threshold_price: 0.001,
  trigger_debounce_ms: 250,
  trigger_min_interval_s: 2,
  max_concurrent_requests: 2,
  timeout_ms: 2500,
  enable_extra_temps: true,
  debug_logging: false,
  pwm_set_endpoint: '/api/pwm',
});

function createPairingId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `solar_controller_${Date.now().toString(36)}_${rand}`;
}

function sanitizeHostInput(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

class SolarControllerDriver extends Homey.Driver {
  async onInit() {
    this.log('SolarControllerDriver init (v1.0.1)');
  }

  async onPair(session) {
    session.setHandler('validate_controller', async (payload = {}) => {
      const host = sanitizeHostInput(payload.host);
      const name = String(payload.name || '').trim() || this.homey.__('pair.default_name');

      if (!host) {
        throw new Error(this.homey.__('pair.address_required'));
      }

      const baseUrl = normalizeBaseUrl(host);
      if (!baseUrl) {
        throw new Error(this.homey.__('pair.address_invalid'));
      }

      // Prevent accidental duplicate pairing of the same manually configured endpoint.
      const duplicate = this.getDevices().some((device) => {
        try {
          const existing = sanitizeHostInput(device.getSetting('host'));
          return existing && normalizeBaseUrl(existing).toLowerCase() === baseUrl.toLowerCase();
        } catch (_) {
          return false;
        }
      });
      if (duplicate) {
        throw new Error(this.homey.__('pair.address_already_paired'));
      }

      // The current working Solar Controller firmware exposes /api/status_light.
      // Verify the endpoint before Homey creates the device, so a typo does not
      // result in a permanently unavailable device immediately after pairing.
      try {
        await httpGetJson(`${baseUrl}/api/status_light`, { timeoutMs: 4000 });
      } catch (err) {
        this.log(`Pairing test failed for ${baseUrl}:`, err && (err.message || err));
        throw new Error(this.homey.__('pair.connection_failed'));
      }

      return {
        device: {
          name,
          data: { id: createPairingId() },
          settings: {
            ...DEFAULT_DEVICE_SETTINGS,
            host,
          },
        },
      };
    });
  }
}

module.exports = SolarControllerDriver;
module.exports.DEFAULT_DEVICE_SETTINGS = DEFAULT_DEVICE_SETTINGS;
module.exports.createPairingId = createPairingId;
module.exports.sanitizeHostInput = sanitizeHostInput;
