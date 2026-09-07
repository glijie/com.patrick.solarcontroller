# Discovery design — Solar Controller Homey v1.1.0

Status: IMPLEMENTED — Solar Controller step309 advertises the service and Homey v1.1.0 consumes it with ManagerDiscovery.

## Goal

Implement LAN discovery in the Homey-supported way requested by Athom:

- Homey ManagerDiscovery
- mDNS-SD
- Discovery linked directly to the Solar Controller driver
- Stable device identity independent of IP address
- Automatic address updates after DHCP changes
- Manual IP/hostname remains available only as fallback

## 1. mDNS-SD service contract

The Solar Controller firmware will advertise one DNS-SD service when STA Wi-Fi is connected and the HTTP API is available.

Service type:

```text
_solarcontroller._tcp.local
```

Service definition for Homey:

```json
{
  "type": "mdns-sd",
  "mdns-sd": {
    "name": "solarcontroller",
    "protocol": "tcp"
  },
  "id": "{{txt.id}}",
  "conditions": [
    [
      {
        "field": "txt.model",
        "match": {
          "type": "string",
          "value": "solar-controller"
        }
      }
    ]
  ]
}
```

Planned Homey source path:

```text
.homeycompose/discovery/solarcontroller.json
```

Planned driver link:

```json
"discovery": "solarcontroller"
```

## 2. TXT records advertised by the ESP32

Minimum required records:

```text
id=SC-84F703A2B1C2
model=solar-controller
fw=2026.xx.xx
name=Solar Controller
api=1
```

Rules:

- `id` is stable for the lifetime of the physical ESP32.
- Firmware publishes the existing uppercase `SC-...` serial. Homey lowercases mDNS TXT values, so the discovery result ID is normalized to lowercase internally.
- The ID source is the existing Solar Controller serial derived from the ESP32 eFuse MAC; no second identity is introduced.
- `model` is fixed to `solar-controller` so Homey can filter unrelated services.
- `fw` is informational and can be displayed/logged during pairing.
- `api` can later be used for API compatibility checks.
- The advertised TCP port is the actual local HTTP API port, normally 80.

Example stable ID:

```text
sc-84f703a2b1c2
```

## 3. Firmware lifecycle

mDNS must follow the existing Wi-Fi lifecycle instead of creating a second connection manager.

Planned behavior:

1. Existing STA Wi-Fi connection succeeds.
2. Existing web/API server is ready.
3. Start/restart mDNS responder.
4. Advertise `_solarcontroller._tcp`.
5. Publish stable TXT metadata.
6. After Wi-Fi reconnect or network reconfiguration, ensure mDNS is advertised again.
7. Do not alter PWM, P1, MQTT, Home Assistant, Legionella, relay, temperature or Multi Controller logic.

No new reboot/watchdog behavior will be introduced solely for discovery.

## 4. Homey pairing design

Automatic discovery is the primary path.

The existing custom pairing screen will be evolved into an automatic-first screen so manual input can remain as fallback without creating a second driver.

Primary section:

```text
Solar Controllers found

Solar Controller A2B1C2
192.168.1.41
Firmware v2026.xx.xx

Solar Controller 7D8E9F
192.168.1.42
Firmware v2026.xx.xx
```

The list is populated from:

```js
this.getDiscoveryStrategy().getDiscoveryResults()
```

Selecting a discovered controller creates a Homey device with:

```js
{
  name: discoveredName,
  data: {
    id: discoveryResult.id
  },
  settings: {
    host: discoveryAddress
  },
  store: {
    discovery_id: discoveryResult.id,
    discovery_managed: true
  }
}
```

Before creating the device, Homey will still validate the existing Solar Controller REST endpoint so a stale or incorrect discovery entry is not paired.

## 5. Manual fallback

Manual pairing remains available under a secondary option such as:

```text
Controller not found? Add manually
```

The current address validation and REST connectivity test remain in use.

Manual fallback is intended for:

- VLANs where multicast is blocked
- networks where mDNS forwarding is disabled
- unusual router configurations
- diagnostics

Automatic discovery must be the default and most prominent route.

## 6. New device identity

For newly discovered devices:

```text
Homey Device data.id = mDNS discovery id
```

Example:

```text
sc-84f703a2b1c2
```

The IP address is never used as the Homey identity.

This allows:

```text
192.168.1.41 -> 192.168.1.87
```

without creating a new Homey device.

## 7. Existing v1.0.2/v1.1.0 devices

Important Homey constraint: a paired device's `data` object cannot be changed after pairing.

Existing devices currently have a generated legacy ID such as:

```text
solar_controller_<timestamp>_<random>
```

Therefore v1.1.0 will NOT try to replace their `data.id`.

Instead Device#onDiscoveryResult() will be overridden.

Planned matching order:

1. New device: `getData().id === discoveryResult.id`
2. Migrated legacy device: stored `discovery_id === discoveryResult.id`
3. First legacy match: current configured host matches the discovery result address

When a legacy device is matched for the first time, `onDiscoveryAvailable()` stores:

```text
discovery_id=<stable discovered id>
discovery_managed=true
```

From that point onward the device can be matched by stable discovery ID even after its IP address changes.

This avoids breaking existing Homey devices and Flows.

Caveat:

- A legacy device must normally be discovered once while its existing configured address is still correct before it can learn the stable ID automatically.
- Manual fallback remains available if a network prevents mDNS entirely.

## 8. Address change handling

Homey will link the discovery strategy directly to the driver.

The Device class will implement:

```text
onDiscoveryResult()
onDiscoveryAvailable()
onDiscoveryAddressChanged()
onDiscoveryLastSeenChanged()
```

When Homey reports an address change:

1. Build the new REST base address from discovery `address` + advertised port.
2. Update the in-memory host cache immediately.
3. Persist the new `host` setting.
4. Restart/repoint the existing poller.
5. Do not require re-pairing.

The existing REST polling code remains the actual data path.

Discovery only locates and tracks the controller; it does not replace the Solar Controller REST API.

## 9. Availability

Homey discovery linked to a Driver can manage discovery availability automatically.

The current REST poller also has API-health availability checks. During implementation these two mechanisms will be tested together.

Design rule:

- mDNS presence means the controller is present on LAN.
- successful REST polling means the controller API is actually usable.
- existing REST failure handling is not removed until practical tests confirm that doing so is safe.

## 10. Multi-ESP

Every physical Solar Controller publishes its own unique `id`.

Example:

```text
sc-84f703a2b1c2 -> 192.168.1.41
sc-ccdb12345678 -> 192.168.1.42
sc-aabb11223344 -> 192.168.1.43
```

Homey will therefore list and track each ESP separately.

No Multi Controller master/slave logic is changed by discovery.

## 11. Security and network scope

Discovery remains LAN-only.

No cloud service is introduced.
No external account is introduced.
No telemetry is introduced.
No internet dependency is introduced.

The existing Homey driver remains:

```json
"platforms": ["local"],
"connectivity": ["lan"]
```

## 12. Firmware implementation rule

Before any firmware implementation:

STOP and request the latest working Solar Controller firmware package from the user.

Only that uploaded/confirmed version may be used as the firmware baseline.

The firmware diff must be kept isolated to discovery/network advertisement wherever possible.

## 13. Acceptance criteria

Phase implementation is complete only when all of the following work:

- Homey automatically lists a Solar Controller without manual IP input.
- Two and three ESP32 controllers appear as separate devices.
- Already-paired devices are not duplicated.
- A DHCP IP change is recovered without re-pairing.
- Existing v1.0.2 device and Flows remain intact after upgrade.
- Manual address pairing still works as fallback.
- Home Assistant remains functional.
- MQTT remains functional.
- Existing REST API remains functional.
- Solar Controller regulation remains functionally unchanged.
- Homey `validate --level publish` succeeds.

