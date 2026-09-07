# Solar Controller v1.1.0 — Certification response

This release addresses all feedback from the previous Homey App Store certification review.

## 1. App icon
Resolved.

- Replaced the previous filled/gradient illustration with clean transparent vector line art.
- App icon uses a 960x960 SVG canvas.
- No background color, gradients, raster image, or filled illustration is used.
- App and driver icons are separate designs.

## 2. Automatic LAN discovery
Resolved.

- Added Homey ManagerDiscovery using mDNS-SD.
- Solar Controller firmware step309 advertises `_solarcontroller._tcp`.
- The existing stable Solar Controller serial number (`SC-...`) is published as the discovery identity.
- Pairing lists automatically discovered Solar Controllers first.
- Manual IP/hostname entry remains available only as a fallback for older firmware or networks where mDNS is unavailable.
- Multiple Solar Controllers have been tested successfully.

## 3. Dutch `advice_is` translation
Resolved.

- English `Unknown` now maps to Dutch `Onbekend`.
- The `Elektriciteit is beter` value remains only on the actual electricity-better option.

## 4. Driver manifest duplication
Resolved.

- `drivers/solar_controller/driver.compose.json` is the editable driver source of truth.
- Redundant `drivers/solar_controller/driver.json` and `drivers/solar_controller/settings.json` were removed.
- Root `app.json` is retained only as the generated Homey app manifest required by the CLI/runtime workflow.

## Compatibility

- Controllers running step309 or newer can be discovered automatically.
- Older Solar Controller firmware can still be paired through the manual IP/hostname fallback.
