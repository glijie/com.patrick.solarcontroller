# Solar Controller Homey v1.1.0

Certification update for the Homey App Store.

## Changes

- Added automatic Solar Controller discovery through Homey ManagerDiscovery and mDNS-SD.
- Added automatic pairing for Solar Controller firmware step309 and newer.
- Kept manual IP/hostname pairing as a fallback for older firmware and networks without mDNS.
- Added stable discovery identity based on the existing Solar Controller `SC-...` serial number.
- Improved support for multiple Solar Controllers.
- Replaced the app icon with transparent 960x960 vector line art according to Athom's icon guidelines.
- Replaced the device icon with lighter transparent vector line art for better readability on Homey tiles.
- Corrected the Dutch `Unknown` Flow option to `Onbekend`.
- Removed redundant generated driver manifest copies and kept Homey Compose as the editable source of truth.
