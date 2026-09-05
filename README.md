# Solar Controller - Homey App (SDK v3) v1.0.1

Solar Controller connects an ESP32-based Solar Controller to Homey. The ESP32 remains responsible for the actual solar-surplus control logic; Homey adds local monitoring, controls, device-specific Flows and support for multiple controllers.

## v1.0.1 — App Store metadata patch

This is the first public Homey App Store release of Solar Controller.

Highlights:

- Local communication with the ESP32 Solar Controller over the home network.
- Multiple Solar Controllers can be added as separate Homey devices.
- Manual pairing asks for an IP address or hostname and verifies the connection before the device is created.
- Stable Homey device identity remains independent of the configured IP/hostname.
- Live Solar Controller status, power, PWM, temperatures, energy prices, control modes and multi-controller state where supported by the ESP firmware.
- Homey Flow triggers, conditions and actions for Solar Controller automation.
- Correct threshold-crossing triggers for power and primary temperature.
- Force Heat, Legionella, relay, sun schedule and multi-controller Flow integration.
- Connection recovery and unavailable-state handling.
- Separate Homey app and device artwork using the Solar Controller visual identity.
- English and Dutch Store copy and interface translations.
- Local project validation and smoke tests without external npm dependencies.

Automatic LAN discovery/mDNS is intentionally not part of v1.0.1. Controllers are paired manually by IP address or hostname. A DHCP reservation/fixed IP is therefore recommended.

## Requirements

- A configured ESP32 running compatible Solar Controller firmware.
- Homey and the Solar Controller on the same local network.
- Homey firmware 7.4.0 or newer.
- A stable IP address/hostname for the current manual pairing workflow is recommended.

## Development / validation

Run the local project checks with:

```bash
npm test
```

Test the app on a Homey with:

```bash
homey app run
```

Before publishing, run Homey's publish-level validation:

```bash
homey app validate --level publish
```

## Source structure

- `package.json` and `.homeycompose/app.json` contain the app version and must match.
- `.homeycompose/capabilities/` contains custom capability definitions.
- `.homeycompose/flow/` contains Flow card definitions.
- `drivers/solar_controller/driver.compose.json` is the editable driver manifest/settings source.
- `drivers/solar_controller/pair/manual_address.html` is the manual pairing view.
- `npm run sync` generates `app.json`, `drivers/solar_controller/driver.json` and `drivers/solar_controller/settings.json`.
- `scripts/validate-project.js` performs static project/Store checks.
- `tests/smoke.js` covers HTTP/API behavior, pairing, Flow thresholds and mapper behavior.

## Upgrades from development builds

Existing devices from the earlier 0.7.x development builds can be upgraded without pairing again. Device identity and Host settings are retained; newly introduced capabilities/options are migrated where needed at app start.

## License

GPL-3.0
