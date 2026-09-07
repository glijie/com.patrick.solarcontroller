'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const driverId = 'solar_controller';

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function writeJson(rel, value) {
  fs.writeFileSync(path.join(root, rel), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJsonFiles(relDir) {
  const dir = path.join(root, relDir);
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({
      id: path.basename(name, '.json'),
      json: JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')),
    }));
}

function flowRefs(kind) {
  return readJsonFiles(path.join('.homeycompose', 'flow', kind)).map(({ json }) => {
    if (!json.id) throw new Error(`Flow ${kind} entry is missing id`);
    return { id: json.id };
  });
}

function capabilities() {
  const result = {};
  for (const { id, json } of readJsonFiles(path.join('.homeycompose', 'capabilities'))) {
    result[id] = json;
  }
  return result;
}

function discoveries() {
  const rel = path.join('.homeycompose', 'discovery');
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return undefined;
  const result = {};
  for (const { id, json } of readJsonFiles(rel)) result[id] = json;
  return result;
}

function main() {
  const pkg = readJson('package.json');
  const composeApp = readJson('.homeycompose/app.json');
  const driverCompose = readJson(`drivers/${driverId}/driver.compose.json`);

  if (pkg.version !== composeApp.version) {
    throw new Error(`Version mismatch: package.json=${pkg.version}, .homeycompose/app.json=${composeApp.version}`);
  }

  const driver = JSON.parse(JSON.stringify(driverCompose));
  driver.id = driverId;
  driver.icon = `/drivers/${driverId}/assets/icon.svg`;

  const manifest = {
    _comment: 'This file is generated. Edit .homeycompose/app.json, drivers/*/driver.compose.json and .homeycompose/* instead.',
    ...composeApp,
    drivers: [driver],
    flow: {
      triggers: flowRefs('triggers'),
      conditions: flowRefs('conditions'),
      actions: flowRefs('actions'),
    },
    capabilities: capabilities(),
  };

  const discovery = discoveries();
  if (discovery && Object.keys(discovery).length) manifest.discovery = discovery;

  writeJson('app.json', manifest);
  console.log(`Generated app.json for ${pkg.name} v${pkg.version}`);
}

main();
