# Discovery test matrix — v1.1.0

Run after both firmware mDNS and Homey ManagerDiscovery implementation are complete.

| Test | Expected result |
|---|---|
| One ESP online | Appears automatically in pairing |
| Two ESPs online | Both appear with unique IDs |
| Three ESPs online | All three appear; no duplicate identities |
| Already paired device | Filtered/not offered as duplicate |
| ESP reboot | Same Homey device reconnects |
| Router reboot, same IP | Same Homey device reconnects |
| DHCP changes ESP IP | Same Homey device updates host automatically |
| Legacy v1.0.2 device | Existing Homey device and Flows remain intact |
| Legacy device first discovery | Stable discovery ID is learned and stored |
| mDNS blocked | Manual IP/hostname fallback remains usable |
| Wrong manual IP | Pairing validation rejects it cleanly |
| REST API unavailable but mDNS present | Homey reports API failure cleanly; no app crash |
| Homey restart | Discovery and polling resume automatically |
| Home Assistant active | No regression |
| MQTT active | No regression |
| Multi Controller master/slave | No regression |
| Legionella / Force Heat / relay | No regression |
| Homey publish validation | Passes `homey app validate --level publish` |
