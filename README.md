# Ghost Controller

## ESP32-S3

The default PlatformIO environment is `esp32-s3-devkitc-1`, targeting the
ESP32-S3-DevKitC-1 with an ESP32-S3-WROOM-1 N16R8 module: 16 MB quad-SPI flash
and 8 MB octal PSRAM. The base PlatformIO board name may still display N8;
the project overrides its flash size and memory mode for N16R8. PSRAM is enabled
with `qio_opi` and `BOARD_HAS_PSRAM`; it does not increase persistent storage.

`partitions_esp32s3_16mb.csv` reserves two 2 MiB firmware slots for OTA updates
and 12,517,376 bytes (11.9375 MiB / 12.52 MB) for LittleFS. The partition named
`spiffs` uses the ESP32 Arduino filesystem partition convention; its contents
are LittleFS, selected by `board_build.filesystem`.

The external PCA9685 uses **SDA GPIO4 and SCL GPIO5** on both targets. Connect
to those GPIO numbers on the S3, with a shared ground and 3.3 V I2C pull-ups.
The onboard OLED remains disabled. The existing servo configuration is retained.

`BoardRgbLed` controls the onboard addressable LED and starts it blue at a
brightness of 64/255. It provides `setColor(red, green, blue)` and `off()`.
The default follows the Arduino board's `PIN_RGB_LED` (GPIO48). For a DevKitC-1
v1.1 with its LED on GPIO38, add `-DCONTROLLER_RGB_LED_PIN=38` to the S3
environment's `build_flags`. On ESP8266 the class does nothing.

Build firmware and filesystem:

```powershell
pio run -e esp32-s3-devkitc-1
pio run -e esp32-s3-devkitc-1 -t buildfs
```

The first installation on the S3 requires USB, including the new partition table
and filesystem. Back up config and sequences from the old controller first;
the LittleFS images and firmware for the two chips are not interchangeable.
When ready to install, connect the S3 and use:

```powershell
pio run -e esp32-s3-devkitc-1 -t upload
pio run -e esp32-s3-devkitc-1 -t uploadfs
```

The existing native USB CDC flags are retained. Use the USB port appropriate to
your board; an explicit `--upload-port COMx` can select it when needed.

Passing an IP address to `--upload-port` automatically selects OTA, even with
the base environment. For the initial installation use a serial port, for example:

```powershell
pio run -e esp32-s3-devkitc-1 -t upload --upload-port COM10
pio run -e esp32-s3-devkitc-1 -t uploadfs --upload-port COM10
```

Replace COM10 with the board's actual port (`pio device list`). If the uploader
cannot connect, hold BOOT, press and release RESET, then release BOOT and retry.

Subsequent updates can use `esp32-s3-devkitc-1_ota` at
`ghost-controller.local`, with `OTA_PASSWORD` set for the uploader. Wi-Fi and
device OTA credentials are supplied through the existing private
`include/WifiCredentials.h`. `upload_html.ps1` now defaults to the S3 OTA
filesystem target. A filesystem upload replaces saved files with `data/`.

For an OTA firmware update to a specific IP, use the OTA environment so its
authentication flags are included:

```powershell
pio run -e esp32-s3-devkitc-1_ota -t upload --upload-port 192.168.3.36
```

`No response from the ESP` means no OTA invitation response arrived. Confirm
the S3 is already running this firmware, its current IP is correct, and its
serial log reports `OTA ready`. This firmware disables OTA when its configured
OTA password is empty. For an already initialized device, also check local
firewall/network access to UDP 3232 and the uploader's return TCP connection.

The original `nodemcuv2` and `nodemcuv2_ota` environments remain available for
the ESP8266. Use `./upload_html.ps1 -Environment nodemcuv2_ota` for its filesystem.

## Robot folders

The mixer motion button cycles through immediate (`-`), smooth (`S`, with
acceleration/deceleration), and linear (`/`, constant angular command speed).
Low/medium/high speeds apply to manual timed moves. In a sequence, linear moves
use the step duration regardless of distance or selected speed, including the
first step. A 10° to 90° linear move in a 2000 ms step takes 2000 ms at 1× playback;
at 2× it takes 1000 ms. Smooth step moves retain their selected speed.
Sequence steps save the mode; older immediate/smooth steps retain their meaning.
The servo settings initial motion mode also accepts `linear`.
Step playback sends one servo batch to the controller. Offline playback sets
every target with a shared start time before rendering, so one servo cannot
delay another while the canvas is redrawn. This requires matching firmware
and frontend versions.
Color steps can be selected to apply their RGB value immediately without moving
servos. The ESP32 model shows the current RGB color with a glowing LED; live
status refreshes report the controller's current color. Black switches the glow off.

The **Robot** entry is a physical ESP32-style board in the 3D hierarchy. Select it
to edit robot name/folder settings and its position/rotation. Drag components
onto the board to attach them, or onto **Scene** to detach them. New components
attach to Robot by default. Legacy configs gain a board at the origin when
opened; existing root components attach to it, with their poses preserved.
Use Save robot to persist the added board. It consumes no servo output channel.

Each robot is stored in `data/robots/<robot name>/` with `config.json` and
`sequence_a.json` through `sequence_j.json`. Missing slots start empty. The
folder name is the robot name; `data/robots.json` records the available folders
and the selected robot. The same layout is used in the controller's LittleFS.
Saved live servo positions are also kept inside that robot's folder.

In Setup, use **New robot**, enter its **Robot name**, then **Save robot** to
create the folder. Choose an existing **Robot folder** and click **Load robot**
to load its configuration and sequence slots. Edit **Robot name** and click
**Save robot** to rename its folder; its config and sequences move together.
Existing folder names cannot be overwritten. **Import config** imports an older
standalone JSON config into a new robot; Save robot creates its named folder.
Changing an existing folder's topology still requires reviewing its sequences.

The local server migrates legacy root-level config and compatible sequence files
to the `Robot` folder on first use, retaining the originals as backups. Sequences
whose servo count does not match remain only in the legacy backup location.
The included `Walker` folder contains the imported walker config and an empty A slot.

Selecting a different robot on the controller turns off the current PWM outputs
and blocks servo commands until restart. Editing and sequences use offline
simulation until then. Click **Reboot** after saving to apply the selected robot
to hardware. These changes require both firmware and filesystem uploads;
building them locally does not update the controller.

## Hardware components

### Adding a 3D component

Each file in `data/components/` owns its drawing and registers with
`componentRegistry` from `registry.js`. The same draw function supplies visible
geometry, physics shapes and sensor-hit surfaces. Optional `drawOverlay` owns
effects such as the ESP32 LED glow and the VL53L0X beam.

To add a passive component, create its file with a draw function and registration:

```javascript
function drawExample({ box, label }) {
  box([0, 0, 0], [20, 2, 40], "#aebbc5", false);
  label([0, 8, 0]);
}
componentRegistry.register({
  objectType: "Example panel",
  order: 110,
  defaults: {},
  draw: drawExample
});
```

Add its script to `data/index.html` after `registry.js` and before `app.js`.
The picker, loaded-config validation, drawing and physics discover it through
the registry; no `app.js` changes are needed. Servo variants additionally register
`model`, `choice`, `label` and their model/type `defaults`; Robot is non-selectable
because the robot root is created automatically. Draw contexts include `node`,
`purpose` (`render`/`physics`) and shared `state` where applicable.

Restart the local server to regenerate `data/components/catalog.json`, or run
`node devserver/component-registry.js` before a filesystem build. Firmware uses
that catalog for type/model validation and serves model scripts generically.
Deploy the updated files together; this registry migration also requires the
updated firmware once. Subsequent passive models need only a filesystem update.

Setup also includes aluminium panels sized 50×50×2 mm and 50×100×2 mm,
a solid 50 mm box, and a stylized slotted 20×20×100 mm aluminium extrusion.
Panels lie in local X/Z; the extrusion runs along local Y. They attach like other
components, participate in physics and simulated sensor ray hits, and consume
no servo outputs. Dimensions are illustrative rather than manufacturing models.

## Distance sensor component

In Setup, select **VL53L0X V2 Time of Flight Sensor** under Add component,
then position, rotate and parent it before saving the configuration. The
preview uses a stylized board with its sensing direction along local +Z.
It participates in preview physics as a fixed attachment and uses no servo channel.

The 3D view draws a dotted beam along the sensor's local +Z direction and labels
the nearest simulated surface distance in millimetres. The floor at world Y=0 is
solid, including when physics is disabled or the grid is hidden. The display ray
extends up to 2000 mm; this is a visualization limit, not a hardware specification.
Sensor distance labels remain visible when component name labels are disabled.
The firmware supports one physical VL53L0X at I2C address `0x29` on the
PCA9685 pass-through I2C header. Connect SDA to SDA (controller GPIO4), SCL to
SCL (GPIO5), and GND to the common ground. Use a supply supported by your
breakout and keep SDA/SCL pull-ups at 3.3 V; the PCA9685 servo V+ rail is not
the sensor supply. The header shares the controller bus, so no additional
GPIO or PCA9685 servo channel is needed. Multiple sensors at the default
address require separate XSHUT wiring/address assignment, which is not supported.

Firmware starts continuous ranging at 100 ms intervals, polls completed results
without waiting for a measurement, and retries unavailable sensors every five
seconds. `GET /api/sensors` returns a `vl53l0x` object; `GET /api/status` includes
the same object under `sensors.vl53l0x`. Example:

```json
{"vl53l0x":{"model":"VL53L0X","address":41,"ready":true,"valid":true,"distanceMm":325,"rangeStatus":11,"sampleAgeMs":42}}
```

`ready` indicates initialization, while `valid` indicates a current successful
measurement. `distanceMm` is null for missing, invalid, or stale readings (over
500 ms). `rangeStatus` is the raw device status (11 means range complete), and
`sampleAgeMs` is the age of the latest completed sample; both are null before
any sample. API handlers return cached telemetry and do not initiate I2C reads.
The editor beam and labels still show simulated geometry, not API telemetry.
The driver uses the [Pololu VL53L0X library](https://github.com/pololu/vl53l0x-arduino).
These changes require a firmware upload to take effect on the controller.

For the 30 cm walking task, distance change to a fixed reference surface can estimate
forward displacement while the sensor keeps the same heading. One range
measurement does not determine full position or sideways drift.

## GY-801 component

In Setup, click **+**, choose **Sensors**, select **GY-801**, then click
**Add component**. It supports placement, rotation, parenting, robot saving,
physics geometry and simulated range-sensor hits without using a servo output.

The stylized blue board has a 25.8 x 16.8 mm outline, based on the
[GY-801 module datasheet](https://okystar.com/wp-content/uploads/2017/07/OKY3062-5.pdf).
It represents the gyro, accelerometer, compass and barometer packages; chip layout
and mounting details are illustrative. This adds the scene component only;
hardware sensor drivers and live IMU/pressure telemetry are not implemented.

GY-801 scene output is available in **Metrics**. The **Units** selector switches
between rotation (degrees), gyro (degrees/second), acceleration (metres/second
squared), altitude (metres) and pressure (hPa). All GY-801 traces are marked
**(sim)** and derive from the mounted board's world pose, including parent and
physics motion. Acceleration includes gravity; pressure uses an approximate
standard atmosphere with scene Y=0 as sea level. These are simulated outputs,
including when connected to a controller, rather than live sensor telemetry.
Derivative readings start after sufficient samples and reset after long gaps.

The full simulated GY-801 output includes gyro X/Y/Z (degrees/second),
accelerometer X/Y/Z (m/s²), magnetometer X/Y/Z (microtesla), compass heading
(degrees), barometric pressure (hPa) and temperature (degrees Celsius), plus
scene orientation and altitude. Select **µT** for the compass field axes and
**°C** for temperature. The compass uses a synthetic uniform world field
`[0, -20, 40] µT`, with north along +Z and up along +Y, rather than a local
Earth-field estimate. Heading follows the board's horizontal +Z direction and
is unavailable when that axis is vertical. Temperature follows the simulated
atmosphere's lapse rate; it is not a live chip-temperature measurement.

## Component mass

Every component's Setup parameters include **Physics > Mass (g)**. Enter a
positive total mass in grams and use **Save robot** to persist it. Clear the
input to return to the legacy geometry-density estimate. Mass is stored as
`massGrams` and loaded by both the local editor and controller configuration.

The physics adapter converts grams to kilograms, divides the mass across the
component's collider volumes (including servo body/shaft shapes), and sums
attached component masses into welded bodies. Null components can carry mass
without visible geometry. Changing mass rebuilds the running physics assembly
at its configured pose, as other topology changes do.

## Component power estimates

Every component model in data/components/ registers a getPower() method returning
{ min, max } in watts. Edit that method to set the model's power defaults.
Powered models other than TD-7120 use provisional 0.1-1 W placeholders; passive models
use 0 W. Replace the placeholders with measured or datasheet values.

Each component can override its model defaults with minPowerWatts and
maxPowerWatts in config.json. Edit them in Setup under Estimated power, or in
Servo Settings. A complete nonnegative range overrides the model; blank/null
or incomplete ranges use getPower() defaults. Explicit 0/0 is a valid override.

Servo meters and Power metrics share the same estimates, interpolating between
minimum and maximum using movement activity. Off/muted outputs show zero.
Controller and sensor estimates use their minimum as an idle baseline. The
master meter sums all component estimates, including model defaults.
These are estimates, not live electrical measurements.

Configure electrical ratings in Setup or Servo Settings using powerVoltageVolts,
idleCurrentAmps, runningCurrentAmps and peakCurrentAmps. Watts are calculated as
voltage times current; convert mA to A by dividing by 1000. Editing electrical
inputs clears direct watt overrides. Complete watt overrides still take priority
if entered afterwards. Normal movement interpolates toward running power; peak
power is shown in the tooltip and is not treated as a measured stall.
Meter segments use normal-running power as their full scale.

TD-7120 defaults now use the supplied ratings: idle 0.040 A; no-load running
0.210 A at 4.8 V to 0.260 A at 7.2 V; peak 2.1 A at 4.8 V, 2.7 A at 7.2 V,
and 3.3 A at 8.4 V. Intermediate currents are linearly interpolated estimates.
Its assumed supply is 4.8 V unless overridden; set the actual supply voltage.
The 0.040 A idle value is an upper estimate for the quoted less-than-40 mA figure.
