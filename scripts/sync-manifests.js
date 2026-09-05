'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const driverId = 'solar_controller';
const driverDir = path.join(root, 'drivers', driverId);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJsonFiles(dirPath) {
  return fs.readdirSync(dirPath)
    .filter(name => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({
      name,
      id: path.basename(name, '.json'),
      json: readJson(path.join(dirPath, name)),
    }));
}

function flowIds(kind) {
  return readJsonFiles(path.join(root, '.homeycompose', 'flow', kind))
    .map(file => {
      if (!file.json.id) throw new Error(`Missing id in flow ${kind}/${file.name}`);
      return { id: file.json.id };
    });
}

function capabilityDefinitions() {
  const caps = {};
  for (const file of readJsonFiles(path.join(root, '.homeycompose', 'capabilities'))) {
    caps[file.id] = file.json;
  }
  return caps;
}

function rootDriverFromCompose(driverCompose) {
  const driver = JSON.parse(JSON.stringify(driverCompose));
  driver.id = driverId;
  driver.images = driver.images || {
    small: `/drivers/${driverId}/assets/images/small.png`,
    large: `/drivers/${driverId}/assets/images/large.png`,
    xlarge: `/drivers/${driverId}/assets/images/xlarge.png`,
  };
  driver.icon = `/drivers/${driverId}/assets/icon.svg`;
  return driver;
}

function validateDriverCapabilities(driverCompose, caps) {
  const missing = [];
  for (const cap of driverCompose.capabilities || []) {
    if (cap.startsWith('sc_') && !caps[cap]) missing.push(cap);
  }
  if (missing.length) {
    throw new Error(`Missing capability definition(s): ${missing.join(', ')}`);
  }
}

function main() {
  const packageJsonPath = path.join(root, 'package.json');
  const composeAppPath = path.join(root, '.homeycompose', 'app.json');
  const appJsonPath = path.join(root, 'app.json');
  const driverComposePath = path.join(driverDir, 'driver.compose.json');
  const driverJsonPath = path.join(driverDir, 'driver.json');
  const settingsJsonPath = path.join(driverDir, 'settings.json');

  const packageJson = readJson(packageJsonPath);
  const composeApp = readJson(composeAppPath);
  const driverCompose = readJson(driverComposePath);
  const caps = capabilityDefinitions();

  if (packageJson.version !== composeApp.version) {
    throw new Error(`Version mismatch: package.json=${packageJson.version}, .homeycompose/app.json=${composeApp.version}`);
  }

  validateDriverCapabilities(driverCompose, caps);

  const generatedFlow = {
    triggers: flowIds('triggers'),
    conditions: flowIds('conditions'),
    actions: flowIds('actions'),
  };

  const generatedComposeApp = {
    ...composeApp,
    drivers: [rootDriverFromCompose(driverCompose)],
    flow: generatedFlow,
    capabilities: caps,
  };

  // app.json is generated output. Keep .homeycompose/app.json as the editable source.
  writeJson(appJsonPath, generatedComposeApp);
  writeJson(driverJsonPath, driverCompose);
  writeJson(settingsJsonPath, driverCompose.settings || []);

  console.log(`Synced Homey manifests for ${packageJson.name} v${packageJson.version}`);
  console.log(`Capabilities: ${Object.keys(caps).length}`);
  console.log(`Flow cards: ${generatedFlow.triggers.length} triggers, ${generatedFlow.conditions.length} conditions, ${generatedFlow.actions.length} actions`);
}

main();
