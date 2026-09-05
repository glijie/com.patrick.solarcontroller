'use strict';

const { httpGetJson, httpPostJson } = require('./http');


class _Semaphore {
  constructor() {
    this._active = 0;
    this._queue = [];
  }

  async acquire(limit) {
    const lim = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : Infinity;
    if (this._active < lim) {
      this._active += 1;
      return;
    }
    await new Promise(resolve => this._queue.push(resolve));
    this._active += 1;
  }

  release() {
    this._active = Math.max(0, this._active - 1);
    const next = this._queue.shift();
    if (next) next();
  }
}

/**
 * Solar Controller API client
 * --------------------------
 * Minimal wrapper around lib/http.js that:
 *  - Resolves base URL and timeout lazily (so settings changes apply immediately)
 *  - Keeps the "Set Host in device settings" error message consistent
 *
 * IMPORTANT: This is a pure refactor (no functional changes intended).
 */
class SolarControllerApiClient {
  /**
   * @param {() => (string|null|undefined)} getBaseUrl
   * @param {() => number} getTimeoutMs
   */
  constructor(getBaseUrl, getTimeoutMs, getMaxConcurrent) {
    this._getBaseUrl = getBaseUrl;
    this._getTimeoutMs = getTimeoutMs;
  
        this._getMaxConcurrent = typeof getMaxConcurrent === 'function'
      ? getMaxConcurrent
      : (() => Infinity);
    this._sem = new _Semaphore();
}

  _base() {
    const base = this._getBaseUrl && this._getBaseUrl();
    if (!base) throw new Error('Set Host in device settings');
    return base;
  }

  async _withLimit(fn) {
    const limit = Number(this._getMaxConcurrent());
    await this._sem.acquire(limit);
    try {
      return await fn();
    } finally {
      this._sem.release();
    }
  }

  async getJson(path) {
    return this._withLimit(() => httpGetJson(this._base() + path, { timeoutMs: this._getTimeoutMs() }));
  }

  async postJson(path, body) {
    return this._withLimit(() => httpPostJson(this._base() + path, body, { timeoutMs: this._getTimeoutMs() }));
  }
}

module.exports = { SolarControllerApiClient };