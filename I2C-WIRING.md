# PCA9685 bus wiring

The ESP8266 NodeMCU board has a faulty fixed OLED. OLED initialization is disabled.
The external PCA9685 now uses a separate pin pair:

| PCA9685 signal | NodeMCU pin | GPIO |
| --- | --- | --- |
| SDA | D2 | 4 |
| SCL | D1 | 5 |

Power off before moving the PCA9685 SDA/SCL wires from the old GPIO12/14 pair.
Keep the existing power and common-ground connections. Upload the updated
firmware; a filesystem upload is not required for this pin change.

The old OLED pins remain unused by default. GPIO assignments and OLED enable
are constants in src/main.cpp. Startup logs report the active external bus pins.
Recovery checks run at startup and before retrying unavailable servos. A held-low
line on the new bus still requires checking that bus's wiring, pull-ups and power;
isolating the old pin pair cannot fix a board-wide supply fault.
