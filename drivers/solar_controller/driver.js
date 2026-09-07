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

function normalizeDiscoveryId(value) {
  return String(value || '').trim().toLowerCase();
}

function serialForDisplay(value) {
  const id = normalizeDiscoveryId(value);
  return id ? id.toUpperCase() : '';
}

function capitalizeWords(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}


function normalizeHostname(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '');
}

function parseEndpoint(value) {
  const base = normalizeBaseUrl(value);
  if (!base) return null;
  try {
    const url = new URL(base);
    return {
      hostname: normalizeHostname(url.hostname),
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    };
  } catch (_) {
    return null;
  }
}

function hostAliases(value) {
  const host = normalizeHostname(value);
  if (!host) return new Set();
  const out = new Set([host]);
  if (host.endsWith('.local')) out.add(host.slice(0, -6));
  return out;
}

function configuredHostMatchesCandidate(configuredHost, candidate) {
  const configured = parseEndpoint(configuredHost);
  if (!configured || !candidate) return false;
  if (configured.port !== (Number(candidate.port) || 80)) return false;

  const configuredAliases = hostAliases(configured.hostname);
  for (const value of [candidate.address, candidate.mdnsHost]) {
    for (const alias of hostAliases(value)) {
      if (configuredAliases.has(alias)) return true;
    }
  }
  return false;
}

function formatDiscoveryHost(discoveryResult) {
  const address = String(discoveryResult && discoveryResult.address || '').trim();
  if (!address) return '';
  const port = Number(discoveryResult && discoveryResult.port) || 80;
  if (port === 80) return address;
  if (address.includes(':') && !/^\[.*\]$/.test(address)) return `[${address}]:${port}`;
  return `${address}:${port}`;
}

function discoveryResultToCandidate(discoveryResult) {
  if (!discoveryResult) return null;
  const txt = discoveryResult.txt || {};
  const id = normalizeDiscoveryId(discoveryResult.id || txt.id);
  const address = String(discoveryResult.address || '').trim();
  if (!id || !address) return null;

  const model = String(txt.model || '').trim().toLowerCase();
  if (model && model !== 'solar-controller') return null;

  const serial = serialForDisplay(txt.id || id);
  const suffix = serial.replace(/^SC-/, '').slice(-6) || serial.slice(-6);
  const advertisedName = String(txt.name || '').trim();
  const isDefaultName = !advertisedName || advertisedName.toLowerCase() === 'solar controller';
  const name = isDefaultName
    ? `Solar Controller ${suffix}`.trim()
    : capitalizeWords(advertisedName);

  return {
    id,
    serial,
    name,
    address,
    port: Number(discoveryResult.port) || 80,
    host: formatDiscoveryHost(discoveryResult),
    mdnsHost: String(discoveryResult.host || '').replace(/\.$/, ''),
    firmware: String(txt.fw || '').trim(),
    api: String(txt.api || '').trim(),
  };
}

function getResultFromStrategy(strategy, id) {
  const wanted = normalizeDiscoveryId(id);
  if (!strategy || !wanted) return null;

  if (typeof strategy.getDiscoveryResult === 'function') {
    try {
      const direct = strategy.getDiscoveryResult(wanted);
      if (direct) return direct;
    } catch (_) {
      // Fall back to scanning currently known results.
    }
  }

  const results = typeof strategy.getDiscoveryResults === 'function'
    ? strategy.getDiscoveryResults()
    : {};
  return Object.values(results || {}).find(result => normalizeDiscoveryId(result && result.id) === wanted) || null;
}

class SolarControllerDriver extends Homey.Driver {
  async onInit() {
    this.log('SolarControllerDriver init (v1.1.0)');
  }

  _isAlreadyPaired(candidate) {
    if (!candidate) return false;
    const candidateId = normalizeDiscoveryId(candidate.id);
    const candidateUrl = normalizeBaseUrl(candidate.host).toLowerCase();

    return this.getDevices().some((device) => {
      try {
        const data = typeof device.getData === 'function' ? (device.getData() || {}) : {};
        const dataId = normalizeDiscoveryId(data.id);
        if (dataId && dataId === candidateId) return true;

        const storedId = normalizeDiscoveryId(device.getStoreValue && device.getStoreValue('discovery_id'));
        if (storedId && storedId === candidateId) return true;

        const existing = sanitizeHostInput(device.getSetting('host'));
        if (existing && normalizeBaseUrl(existing).toLowerCase() === candidateUrl) return true;
        return configuredHostMatchesCandidate(existing, candidate);
      } catch (_) {
        return false;
      }
    });
  }

  async _verifyController(host) {
    const baseUrl = normalizeBaseUrl(host);
    if (!baseUrl) throw new Error(this.homey.__('pair.address_invalid'));
    try {
      await httpGetJson(`${baseUrl}/api/status_light`, { timeoutMs: 4000 });
    } catch (err) {
      this.log(`Pairing test failed for ${baseUrl}:`, err && (err.message || err));
      throw new Error(this.homey.__('pair.connection_failed'));
    }
  }

  _getDiscoveredCandidates() {
    const strategy = this.getDiscoveryStrategy();
    const results = strategy && typeof strategy.getDiscoveryResults === 'function'
      ? strategy.getDiscoveryResults()
      : {};

    return Object.values(results || {})
      .map(discoveryResultToCandidate)
      .filter(Boolean)
      .map(candidate => ({
        ...candidate,
        alreadyPaired: this._isAlreadyPaired(candidate),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.serial.localeCompare(b.serial));
  }

  async onPair(session) {
    // Automatic pairing is the primary route. It is driven by Homey's
    // ManagerDiscovery strategy linked to this Driver in driver.compose.json.
    session.setHandler('get_discovered_controllers', async () => {
      try {
        return this._getDiscoveredCandidates();
      } catch (err) {
        this.error('Failed to read Solar Controller discovery results', err);
        return [];
      }
    });

    session.setHandler('pair_discovered_controller', async (payload = {}) => {
      const id = normalizeDiscoveryId(payload.id);
      if (!id) throw new Error(this.homey.__('pair.discovery_missing'));

      const strategy = this.getDiscoveryStrategy();
      const discoveryResult = getResultFromStrategy(strategy, id);
      const candidate = discoveryResultToCandidate(discoveryResult);
      if (!candidate) throw new Error(this.homey.__('pair.discovery_missing'));
      if (this._isAlreadyPaired(candidate)) throw new Error(this.homey.__('pair.discovery_already_paired'));

      // Discovery locates the controller; the existing REST API remains the
      // actual data path. Validate it before the device is created.
      await this._verifyController(candidate.host);

      return {
        device: {
          name: candidate.name,
          data: { id: candidate.id },
          settings: {
            ...DEFAULT_DEVICE_SETTINGS,
            host: candidate.host,
          },
          store: {
            discovery_id: candidate.id,
            discovery_managed: true,
            discovery_fw: candidate.firmware || '',
          },
        },
      };
    });

    // Manual address entry remains available as a secondary fallback for
    // networks where mDNS/multicast is intentionally blocked (e.g. VLANs).
    session.setHandler('validate_controller', async (payload = {}) => {
      const host = sanitizeHostInput(payload.host);
      const name = String(payload.name || '').trim() || this.homey.__('pair.default_name');

      if (!host) throw new Error(this.homey.__('pair.address_required'));

      const baseUrl = normalizeBaseUrl(host);
      if (!baseUrl) throw new Error(this.homey.__('pair.address_invalid'));

      const duplicate = this.getDevices().some((device) => {
        try {
          const existing = sanitizeHostInput(device.getSetting('host'));
          return existing && normalizeBaseUrl(existing).toLowerCase() === baseUrl.toLowerCase();
        } catch (_) {
          return false;
        }
      });
      if (duplicate) throw new Error(this.homey.__('pair.address_already_paired'));

      await this._verifyController(host);

      return {
        device: {
          name,
          data: { id: createPairingId() },
          settings: {
            ...DEFAULT_DEVICE_SETTINGS,
            host,
          },
          store: {
            discovery_managed: false,
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
module.exports.normalizeDiscoveryId = normalizeDiscoveryId;
module.exports.discoveryResultToCandidate = discoveryResultToCandidate;
module.exports.formatDiscoveryHost = formatDiscoveryHost;
module.exports.getResultFromStrategy = getResultFromStrategy;
