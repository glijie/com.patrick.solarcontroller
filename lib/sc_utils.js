'use strict';

/**
 * Shared small helpers for the Solar Controller Homey app.
 * Keep these stateless so they can be reused by device/driver logic.
 */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url);
}

/**
 * Normalize a user-entered host/url to a base URL.
 * Accepts:
 *  - "192.168.1.10"
 *  - "192.168.1.10:8080"
 *  - "http://192.168.1.10"
 *  - "https://solarcontroller.local"
 *
 * Returns: "http(s)://host[:port]"
 */
function normalizeBaseUrl(hostOrUrl) {
  const s = String(hostOrUrl || '').trim();
  if (!s) return '';

  // If it already contains a scheme, keep it.
  if (isHttpUrl(s)) {
    // Remove trailing slash for consistent concatenation.
    return s.replace(/\/+$/, '');
  }

  // Otherwise assume http.
  return ('http://' + s).replace(/\/+$/, '');
}

module.exports = { sleep, isHttpUrl, normalizeBaseUrl };
