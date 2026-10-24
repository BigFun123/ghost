# Project guidance

## Project layout

- This Arduino project defaults to PlatformIO `esp32-s3-devkitc-1`, configured for N16R8 (16 MB flash, 8 MB octal PSRAM); the original ESP8266 `nodemcuv2` target remains supported.
- ESP32-S3 uses `partitions_esp32s3_16mb.csv` for two OTA slots and LittleFS. Confirm flash capacity before changing partitions.
- Firmware lives in `src/`, with headers in `include/`.
- The controller frontend lives in `data/index.html`, `data/app.js`, and `data/style.css`. LittleFS serves these assets and `data/config.json`.
- `src/WebStatusServer.cpp` implements the frontend API. Check its request and response formats before changing frontend commands.
- Servo configuration supports up to 20 servos. Use the configured count rather than hardcoding a channel count.
- KiCad hardware files live in `kicad/`; change them only when the task concerns hardware.

## Making changes

- Inspect existing changes before editing and preserve work unrelated to the current request. The working tree may already contain substantial uncommitted work.
- Follow the existing plain JavaScript, HTML, CSS, and C++ conventions. Keep changes focused; avoid introducing a frontend framework or build pipeline for small UI changes.
- Preserve servo mute, solo, motion mode, speed, and sequencer behavior when modifying controls.
- For commands that turn servos off, account for running macros, sequence playback, queued commands, and requests already in flight so motion cannot inadvertently re-enable outputs.
- Never print or commit credentials from `.env`, `include/WifiCredentials.h`, or environment variables. OTA authentication uses `OTA_PASSWORD`.
- Do not edit generated `.pio/` output or installed dependencies.

## Validation

- For frontend JavaScript changes, run `node --check data/app.js`.
- For firmware changes, run `pio run -e esp32-s3-devkitc-1` and `pio run -e nodemcuv2` using the available PlatformIO executable.
- When validating filesystem packaging, use `pio run -e esp32-s3-devkitc-1 -t buildfs` (or the corresponding ESP8266 target).
- Run `git diff --check` and distinguish issues introduced by the current change from pre-existing issues.
- Use targeted behavior checks when changes affect servo commands or playback. Report when hardware behavior has not been tested.

## Uploads

- Local edits and builds do not update the physical controller. State clearly whether changes have been uploaded.
- Upload only when the user requests or has authorized deployment to the device.
- Frontend assets require a filesystem upload; firmware requires a firmware upload.
- Both OTA environments target `ghost-controller.local`. `upload_html.ps1` defaults to `esp32-s3-devkitc-1_ota` and accepts `-Environment nodemcuv2_ota` for the old board. It uses a machine-specific PlatformIO path; inspect it before use.
