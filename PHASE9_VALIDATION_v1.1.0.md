# Phase 9 validation — Homey ManagerDiscovery

Status: SOURCE TESTS PASSED; real Homey network test pending.

Implemented:
- Homey Compose mDNS-SD strategy `_solarcontroller._tcp`.
- `txt.model=solar-controller` filtering.
- `txt.id` as stable discovery result id.
- Discovery linked directly to driver.
- Automatic-first custom pairing backed by `Driver#getDiscoveryStrategy()`.
- REST validation before device creation.
- Manual address fallback retained.
- Legacy device matching by existing host or learned `discovery_id`.
- Automatic `host` setting update on discovery address changes.
- Existing REST poller is restarted after an address update.

Static/local checks:
- JavaScript syntax validation.
- JSON parse validation.
- Project validator.
- Smoke tests including automatic pairing, duplicate prevention, manual fallback, legacy migration and DHCP host update.

Pending:
- `homey app validate --level publish` on the user's Homey CLI environment.
- Actual ManagerDiscovery result from a running step309 ESP on the user's LAN.
- Mobile/desktop pairing UX.

## Homey CLI run manifest correction

During real Homey CLI testing it became clear that `homey app run` reads the root `app.json` before Homey Compose preprocessing. The root `app.json` is therefore retained as **generated output**, consistent with Athom example repositories. The duplicate generated files `drivers/solar_controller/driver.json` and `drivers/solar_controller/settings.json` remain removed. `driver.compose.json` and `.homeycompose/*` remain the editable source of truth.

`npm test` now regenerates `app.json` before validation and verifies that no duplicate per-driver generated manifests exist.
