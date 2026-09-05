'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const issues = [];
const notes = [];

function fail(msg) { issues.push(msg); }
function note(msg) { notes.push(msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function json(rel) { return JSON.parse(read(rel)); }
function exists(rel) { return fs.existsSync(path.join(root, rel)); }
function hash(rel) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex'); }
function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out);
    else out[full] = value;
  }
  return out;
}
function pngSize(rel) {
  const b = fs.readFileSync(path.join(root, rel));
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${rel} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
function assertPng(rel, expected) {
  if (!exists(rel)) return fail(`Missing image: ${rel}`);
  const actual = pngSize(rel);
  if (actual[0] !== expected[0] || actual[1] !== expected[1]) fail(`${rel} is ${actual.join('x')}, expected ${expected.join('x')}`);
}
function walkTranslations(value, where) {
  if (Array.isArray(value)) return value.forEach((v, i) => walkTranslations(v, `${where}[${i}]`));
  if (!value || typeof value !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(value, 'en') || Object.prototype.hasOwnProperty.call(value, 'nl')) {
    if (!Object.prototype.hasOwnProperty.call(value, 'en') || !Object.prototype.hasOwnProperty.call(value, 'nl')) {
      fail(`Incomplete en/nl translation at ${where}`);
    }
  }
  for (const [k, v] of Object.entries(value)) walkTranslations(v, `${where}.${k}`);
}

const pkg = json('package.json');
const compose = json('.homeycompose/app.json');
const generated = json('app.json');
const driver = json('drivers/solar_controller/driver.compose.json');

if (pkg.version !== compose.version || compose.version !== generated.version) fail(`Version mismatch package=${pkg.version}, compose=${compose.version}, app=${generated.version}`);
if (compose.sdk !== 3) fail('SDK must be 3');
if (compose.runtime !== 'nodejs') fail('Runtime must be nodejs');
if (!Array.isArray(compose.platforms) || compose.platforms.join(',') !== 'local') fail('App must target only local Homey');
if (compose.category !== 'energy') fail('Category must be energy');
if (!/^#[0-9A-Fa-f]{6}$/.test(compose.brandColor || '')) fail('brandColor must be a six-digit HEX color');
if (!/^https:\/\//.test(compose.homepage || '')) fail('homepage must be an https URL');
for (const key of ['support', 'source']) {
  if (compose[key] && !/^https:\/\//.test(compose[key])) fail(`${key} must be an https URL when provided`);
}
if (compose.bugs && !/^https:\/\//.test(compose.bugs.url || '')) fail('bugs.url must be an https URL when provided');

assertPng('assets/images/small.png', [250, 175]);
assertPng('assets/images/large.png', [500, 350]);
assertPng('assets/images/xlarge.png', [1000, 700]);
assertPng('drivers/solar_controller/assets/images/small.png', [75, 75]);
assertPng('drivers/solar_controller/assets/images/large.png', [500, 500]);
assertPng('drivers/solar_controller/assets/images/xlarge.png', [1000, 1000]);
if (hash('assets/images/large.png') === hash('drivers/solar_controller/assets/images/large.png')) fail('App and driver image may not be identical');
if (hash('assets/icon.svg') === hash('drivers/solar_controller/assets/icon.svg')) fail('App and driver icon may not be identical');
for (const rel of ['assets/icon.svg', 'drivers/solar_controller/assets/icon.svg']) {
  const svg = read(rel);
  if (!/<svg\b/.test(svg)) fail(`${rel} is not SVG`);
  if (/<text\b/i.test(svg)) fail(`${rel} contains text; Store icons should be pictorial`);
}

if (compose.compatibility !== '>=7.4.0') fail(`Compatibility must be >=7.4.0 for this release candidate, got ${compose.compatibility}`);
if (!exists('LICENSE')) fail('LICENSE is missing');
if (!exists('.homeychangelog.json')) fail('.homeychangelog.json is missing');
else {
  const changelog = json('.homeychangelog.json');
  const entry = changelog[compose.version];
  if (!entry || typeof entry.en !== 'string' || !entry.en.trim()) fail(`Changelog has no English entry for ${compose.version}`);
  if (!entry || typeof entry.nl !== 'string' || !entry.nl.trim()) fail(`Changelog has no Dutch entry for ${compose.version}`);
}

for (const rel of ['README.txt', 'README.nl.txt']) {
  if (!exists(rel)) { fail(`Missing ${rel}`); continue; }
  const text = read(rel).trim();
  const paras = text.split(/\n\s*\n/).filter(Boolean);
  if (paras.length < 1 || paras.length > 2) fail(`${rel} should contain one or two paragraphs`);
  if (/https?:\/\//i.test(text)) fail(`${rel} may not contain URLs`);
  if (/^\s*#{1,6}\s/m.test(text) || /\[[^\]]+\]\([^\)]+\)/.test(text) || /^\s*[-*+]\s+/m.test(text)) fail(`${rel} contains Markdown formatting`);
}

if (!Array.isArray(driver.connectivity) || !driver.connectivity.includes('lan')) fail('Driver connectivity must include lan');
if (!Array.isArray(driver.platforms) || !driver.platforms.includes('local')) fail('Driver must support local platform');
if (!Array.isArray(driver.pair) || driver.pair.length !== 1 || driver.pair[0].id !== 'manual_address') fail('Manual pairing view is not configured as expected');
if (!exists('drivers/solar_controller/pair/manual_address.html')) fail('Manual pairing HTML is missing');
else {
  const html = read('drivers/solar_controller/pair/manual_address.html');
  if (!/Homey\.emit\(['"]validate_controller/.test(html)) fail('Pairing view does not validate the controller');
  if (!/Homey\.createDevice\(/.test(html)) fail('Pairing view does not create the device');
  if (!/type=["']button["']/.test(html)) fail('Pairing action button must explicitly use type="button"');
}

const capDir = path.join(root, '.homeycompose', 'capabilities');
const customCaps = new Set(fs.readdirSync(capDir).filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json')));
for (const cap of driver.capabilities || []) if (cap.startsWith('sc_') && !customCaps.has(cap)) fail(`Missing custom capability definition: ${cap}`);
if (new Set(driver.capabilities || []).size !== (driver.capabilities || []).length) fail('Duplicate driver capability id');

const flowIdsByKind = {};
for (const kind of ['triggers', 'conditions', 'actions']) {
  const dir = path.join(root, '.homeycompose', 'flow', kind);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const ids = new Set();
  for (const file of files) {
    const card = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!card.id) fail(`Missing flow id in ${kind}/${file}`);
    if (ids.has(card.id)) fail(`Duplicate flow ${kind} id: ${card.id}`);
    ids.add(card.id);
    const devArg = (card.args || []).find(a => a.name === 'device' && a.type === 'device');
    if (!devArg) fail(`Flow ${kind}/${card.id} has no device argument`);
    walkTranslations(card, `flow.${kind}.${card.id}`);
  }
  flowIdsByKind[kind] = [...ids];
  note(`${kind}: ${files.length}`);
}

// Static wiring audit: every card must be represented in runtime code, and
// every trigger must have a firing path outside app.js's run-listener setup.
const appRuntime = read('app.js');
const triggerRuntime = `${read('drivers/solar_controller/device.js')}\n${read('lib/sc_mappers.js')}`;
function sourceMentionsId(source, id) {
  return source.includes(`'${id}'`) || source.includes(`"${id}"`) || source.includes(`${id}:`);
}
for (const id of flowIdsByKind.conditions || []) {
  if (!sourceMentionsId(appRuntime, id)) fail(`Condition ${id} is not registered in app.js`);
}
for (const id of flowIdsByKind.actions || []) {
  if (!sourceMentionsId(appRuntime, id)) fail(`Action ${id} is not registered in app.js`);
}
for (const id of flowIdsByKind.triggers || []) {
  if (!sourceMentionsId(appRuntime, id)) fail(`Trigger ${id} has no run-listener registration in app.js`);
  if (!sourceMentionsId(triggerRuntime, id)) fail(`Trigger ${id} has no firing path in device/mappers runtime code`);
}

walkTranslations(compose, 'app');
walkTranslations(driver, 'driver');
const en = flatten(json('locales/en.json'));
const nl = flatten(json('locales/nl.json'));
for (const key of Object.keys(en)) if (!(key in nl)) fail(`Locale key missing in nl: ${key}`);
for (const key of Object.keys(nl)) if (!(key in en)) fail(`Locale key missing in en: ${key}`);

const textFiles = [];
function collect(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git' || ent.name === 'node_modules') continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) collect(abs);
    else if (/\.(js|json|html|txt|md)$/.test(ent.name)) textFiles.push(abs);
  }
}
collect(root);
for (const abs of textFiles) {
  const rel = path.relative(root, abs);
  const text = fs.readFileSync(abs, 'utf8');
  if (rel !== 'scripts/validate-project.js' && /[ÃÂ]/.test(text) && rel !== 'TESTPLAN.md') fail(`Possible mojibake in ${rel}`);
  if (rel !== 'scripts/validate-project.js' && /GITHUB-LINK|example\.com|PLACEHOLDER_TODO/i.test(text)) fail(`Placeholder text in ${rel}`);
}

// Every explicit locale key referenced by production JS/HTML must exist in both locales.
const localeReferenceSources = [
  read('app.js'),
  read('drivers/solar_controller/device.js'),
  read('drivers/solar_controller/driver.js'),
  read('lib/sc_mappers.js'),
  read('drivers/solar_controller/pair/manual_address.html'),
].join('\n');
const localeRefs = new Set();
for (const match of localeReferenceSources.matchAll(/(?:homey\.__|Homey\.__)\(\s*['"]([^'"]+)['"]/g)) localeRefs.add(match[1]);
for (const match of localeReferenceSources.matchAll(/data-i18n=["']([^"']+)["']/g)) localeRefs.add(match[1]);
for (const key of localeRefs) {
  if (!(key in en)) fail(`Referenced locale key missing in en: ${key}`);
  if (!(key in nl)) fail(`Referenced locale key missing in nl: ${key}`);
}

if (issues.length) {
  console.error(`Project validation FAILED (${issues.length} issue${issues.length === 1 ? '' : 's'}):`);
  issues.forEach(i => console.error(`- ${i}`));
  process.exit(1);
}
console.log(`Project validation OK for ${compose.id} v${compose.version}`);
console.log(`Custom capabilities: ${customCaps.size}; ${notes.join('; ')}`);
