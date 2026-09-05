'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

function requestJson(method, urlString, { timeoutMs = 2500, body = null } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlString); } catch (e) { return reject(new Error(`Invalid URL: ${urlString}`)); }

    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { 'Accept': 'application/json' },
      timeout: timeoutMs,
    };

    if (payload) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = payload.length;
    }

    const req = lib.request(options, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try { resolve(data ? JSON.parse(data) : {}); }
        catch (e) { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); }
      });
    });

    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);

    if (payload) req.write(payload);
    req.end();
  });
}

async function httpGetJson(url, opts) { return requestJson('GET', url, opts); }
async function httpPostJson(url, body, opts) { return requestJson('POST', url, { ...opts, body }); }

module.exports = { httpGetJson, httpPostJson };
