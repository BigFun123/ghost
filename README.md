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
