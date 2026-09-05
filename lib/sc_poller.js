'use strict';

/**
 * Solar Controller — Poller helper
 * ===============================
 *
 * Doel:
 *   Houd drivers/../device.js klein door de generieke polling-loop
 *   (timer + overlap protection + generation guard) in een helper te plaatsen.
 *
 * Belangrijk:
 *   - Geen overlap: als een poll nog loopt, plannen we netjes de volgende.
 *   - Generation guard: start/stop/restart maakt oude timers onschadelijk.
 *   - Deze helper doet GEEN business logic en kent geen endpoints.
 */

class SolarControllerPoller {
  /**
   * @param {object} opts
   * @param {() => number} opts.getIntervalMs  Poll interval in ms
   * @param {(gen:number) => Promise<void>} opts.pollFn  The actual poll work
   * @param {(err:any) => void} [opts.onError] Optional error handler
   */
  constructor({ getIntervalMs, pollFn, onError }) {
    if (typeof getIntervalMs !== 'function') throw new Error('getIntervalMs is required');
    if (typeof pollFn !== 'function') throw new Error('pollFn is required');

    this._getIntervalMs = getIntervalMs;
    this._pollFn = pollFn;
    this._onError = typeof onError === 'function' ? onError : () => {};

    this._timer = null;
    this._inFlight = false;
    this._gen = 0;
    this._stopped = true;
  }

  start(initialDelayMs = 50) {
    // Idempotent start: voorkomen dat meerdere start() calls dubbele loops maken.
    // Als de poller al draait, doen we niets en geven we de huidige generation terug.
    if (!this._stopped) return this._gen;

    this._stopped = false;
    const gen = ++this._gen;
    this._schedule(initialDelayMs, gen);
    return gen;
  }

  stop() {
    this._stopped = true;
    this._gen += 1;
    this._clearTimer();
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _schedule(delayMs, gen) {
    this._clearTimer();
    this._timer = setTimeout(() => {
      void this._tick(gen);
    }, delayMs);
  }

  async _tick(gen) {
    // Ignore timers from previous generations or when stopped.
    if (this._stopped || gen !== this._gen) return;

    // Never overlap polls.
    if (this._inFlight) {
      this._schedule(this._getIntervalMs(), gen);
      return;
    }

    this._inFlight = true;
    try {
      await this._pollFn(gen);
    } catch (err) {
      try {
        this._onError(err);
      } catch (_) {}
    } finally {
      this._inFlight = false;
      if (!this._stopped && gen === this._gen) {
        this._schedule(this._getIntervalMs(), gen);
      }
    }
  }
}

module.exports = { SolarControllerPoller };
