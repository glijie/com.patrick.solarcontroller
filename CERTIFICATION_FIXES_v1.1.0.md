# Certification fixes — Solar Controller Homey v1.1.0

Baseline: v1.0.2 (confirmed working release submitted to Athom).

Reviewer issues to resolve:

1. Replace the app SVG icon with clean transparent line art that remains recognizable at small sizes.
2. Add automatic LAN discovery using Homey ManagerDiscovery; manual IP/hostname may remain as fallback.
3. Correct the Dutch `advice_is` value for `unknown` from `Elektriciteit is beter` to `Onbekend`, and audit comparable EN/NL dropdown values.
4. Remove duplicated driver-manifest maintenance and keep a single generated/source-of-truth path through Homey Compose.

Firmware rule:

- Do not modify Solar Controller firmware until the user uploads/confirms the latest working Solar Controller firmware package.
- Implement discovery changes only on that latest confirmed firmware baseline.


## Uitvoeringsstatus

- Fase 2 — App-icoon: ✅ afgerond. Transparant monochroom line-art SVG zonder gradients of gevulde illustratie. Getest op 32/48/64 px en op Homey brandColor.
- Fase 3 — Flow-vertaling: ✅ afgerond.
- Fase 4 — Homey Compose: ✅ afgerond.
- Fase 5 — Discovery-ontwerp: ✅ afgerond volgens Athom ManagerDiscovery + mDNS-SD.
- Discovery/ESP-firmware implementatie: ⏸ gestopt tot nieuwste Solar Controller firmware is aangeleverd.

## Phase 3 — Flow translation

Status: COMPLETE

- `advice_is` Dutch `unknown` value corrected from `Elektriciteit is beter` to `Onbekend`.
- Dutch electricity value normalized from `Elek beter` to `Elektriciteit is beter`.
- All other Flow/settings dropdown EN/NL values audited; no semantic mismatches found.


## Phase 4 — Homey Compose source of truth

Status: COMPLETE

- `drivers/solar_controller/driver.compose.json` is now the single editable driver manifest/settings source.
- Removed duplicate `drivers/solar_controller/driver.json` and `drivers/solar_controller/settings.json`.
- Removed the custom `scripts/sync-manifests.js` generator.
- `app.json` is no longer maintained in source; Homey Compose/Homey CLI generates it during preprocessing as documented by Athom.
- Local project validation now reads Compose sources directly and rejects reintroduced duplicate driver/settings manifests.
- Pre-cleanup parity was verified: the prior generated app driver (excluding Homey's generated `id` and `icon`) matched `driver.compose.json` exactly; the duplicate `driver.json` and `settings.json` were exact copies of the Compose source.
- No runtime/API/MQTT/Home Assistant code was changed in this phase.


## Phase 5 — Discovery design

Status: COMPLETE

- Homey ManagerDiscovery/mDNS-SD selected as the discovery mechanism.
- Service contract fixed as `_solarcontroller._tcp.local`.
- Stable MAC-derived controller identity defined.
- Automatic-first pairing with manual IP/hostname fallback designed.
- Existing paired devices will be preserved using `Device#onDiscoveryResult()` rather than attempting to mutate immutable `data.id`.
- DHCP address changes will be handled through Homey discovery callbacks and the existing REST poller will be repointed automatically.
- No Solar Controller firmware was modified in this phase.
- Hard stop reached: latest working Solar Controller firmware package must be supplied before implementation.

## Phase 9 — Homey ManagerDiscovery implementation

Status: IMPLEMENTED

- Added `.homeycompose/discovery/solarcontroller.json` using mDNS-SD `_solarcontroller._tcp`.
- Linked discovery strategy directly to the Solar Controller driver.
- Automatic discovery is now the primary pairing route.
- Manual IP/hostname remains available only as fallback.
- New devices use the stable discovered `SC-...` serial (Homey-normalized lowercase) as `data.id`.
- Legacy manually paired devices can migrate by matching their existing configured host and storing `discovery_id`.
- `onDiscoveryAddressChanged()` updates the existing `host` setting and restarts the current REST poller.
- REST/API remains the controller data path; discovery only locates and tracks the address.
