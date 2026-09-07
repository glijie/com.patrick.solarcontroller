# Solar Controller - Homey App

![Solar Controller Homey App](store_assets/01_solar_controller_hero.png)

Homey integration for the ESP32-based **Solar Controller**.

The Solar Controller itself remains responsible for the actual solar-surplus control logic.  
The Homey app adds local monitoring, control, device-specific Flow cards and support for multiple Solar Controllers in one Homey installation.

## Features

- Local communication with the ESP32 Solar Controller over your home network
- Add multiple Solar Controllers as separate Homey devices
- Manual pairing using an IP address or hostname
- Live Solar Controller status in Homey, including:
  - Power
  - PWM output
  - Temperatures
  - Energy prices
  - Control mode
  - Solar control status
  - Relay status
  - Legionella status
  - Multi Controller status
- Homey Flow triggers, conditions and actions
- Control of supported Solar Controller functions from Homey
- Support for additional temperature sensors when available
- Separate Homey device identity for every connected Solar Controller
- English and Dutch Homey interface translations

## Requirements

To use this Homey app you need:

- A configured ESP32 running compatible **Solar Controller firmware**
- A Homey connected to the same local network
- Homey firmware **7.4.0 or newer**
- A fixed or reserved IP address for the Solar Controller is strongly recommended

## Installation

Install the **Solar Controller** app on Homey.

After installation:

1. Open **Devices** in Homey.
2. Choose **Add device**.
3. Select **Solar Controller**.
4. Enter the IP address or hostname of your Solar Controller.
5. Homey will check the connection.
6. If the Solar Controller is reachable, the device can be added.

Repeat these steps if you want to add more than one Solar Controller.

## Network recommendation

It is strongly recommended to give every Solar Controller a **fixed IP address** or a **DHCP reservation** in your router.

This prevents the controller from receiving a different IP address after a router restart or reconnect, which could cause Homey to temporarily lose the connection.

## Homey Flows

The app includes Flow cards for supported Solar Controller functions.

Depending on the firmware version and configuration, you can use Homey Flows for actions and conditions such as:

- Monitoring Solar Controller values
- Reacting to changes in power or temperature
- Controlling supported operating modes
- Switching supported functions
- Using relay and Legionella status
- Working with Multi Controller information

Available Flow cards may depend on the firmware and enabled features of your Solar Controller.

## Multiple Solar Controllers

You can add multiple Solar Controllers to the same Homey installation.

Each controller is added as its own Homey device and keeps its own:

- IP address or hostname
- Measurements
- Status values
- Controls
- Flow cards

## Firmware

The Homey app communicates directly with the Solar Controller over the local network.

For Solar Controller firmware, installation instructions, hardware information and documentation, visit:

https://github.com/glijie/solar-controller-firmware

## Support

For questions, bugs or feature requests related to the Homey app, use the GitHub Issues page of this repository.

When reporting a problem, it is useful to include:

- Homey model
- Homey firmware version
- Homey app version
- Solar Controller firmware version
- Whether the Solar Controller is reachable directly through its IP address
- A short description of what happens

## License

GPL-3.0
