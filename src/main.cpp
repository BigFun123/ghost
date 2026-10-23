#include <Arduino.h>

#include <ArduinoOTA.h>
#include <Wire.h>
#include <ESP8266WiFi.h>
#include <LittleFS.h>

#include "AppLog.h"
#include "OledDisplay.h"
#include "Pca9685ServoTest.h"
#include "ServoConfiguration.h"
#include "WebStatusServer.h"

#if __has_include("WifiCredentials.h")
#include "WifiCredentials.h"
#define WIFI_CREDENTIALS_AVAILABLE 1
#else
#define WIFI_CREDENTIALS_AVAILABLE 0
#endif

OledDisplay oledDisplay;
Pca9685ServoTest servos[kMaximumServoCount];
ServoConfiguration servoConfigurations[kMaximumServoCount];
uint8_t servoCount = 0;
WebStatusServer webStatusServer;
bool filesystemReady = false;
bool otaReady = false;
bool webServerReady = false;
bool wifiConnectedPreviously = false;
unsigned long lastWiFiStatusLogAt = 0;
unsigned long lastServoControllerRetryAt = 0;
char otaHostname[32];
bool oledReady = false;
bool servoConfigurationsReady = false;

namespace {
constexpr unsigned long kServoControllerRetryIntervalMilliseconds = 5000;
constexpr bool kEnableOled = false;  // Onboard display is faulty; do not probe or initialize it.
constexpr uint8_t kI2cSdaPin = 4;   // NodeMCU D2: external PCA9685 SDA.
constexpr uint8_t kI2cSclPin = 5;   // NodeMCU D1: external PCA9685 SCL.
constexpr uint8_t kOledSdaPin = 12;
constexpr uint8_t kOledSclPin = 14;

bool ensureI2cBusReady(const char* phase, uint8_t sdaPin = kI2cSdaPin, uint8_t sclPin = kI2cSclPin) {
  const bool sdaWasLow = digitalRead(sdaPin) == LOW;
  const bool sclWasLow = digitalRead(sclPin) == LOW;
  // ESP8266 Wire.status() clocks a slave holding SDA low, with bounded waits.
  // Unlike endTransmission(), it can clear a transfer interrupted by reset.
  const uint8_t status = Wire.status();
  const bool sdaLow = digitalRead(sdaPin) == LOW;
  const bool sclLow = digitalRead(sclPin) == LOW;
  if (status != 0 || sdaLow || sclLow) {
    AppLog::printf("I2C bus blocked during %s: SDA GPIO%u=%s, SCL GPIO%u=%s, bus status %u.\n",
                   phase, sdaPin, sdaLow ? "LOW" : "HIGH",
                   sclPin, sclLow ? "LOW" : "HIGH", status);
    return false;
  }
  if (sdaWasLow || sclWasLow) {
    AppLog::printf("I2C bus recovered during %s.\n", phase);
  }
  return true;
}

bool initializeServo(uint8_t index, bool retry) {
  const ServoConfiguration& configuration = servoConfigurations[index];
  Pca9685ServoTest& servo = servos[index];
  if (servo.isReady()) {
    return true;
  }

  if (!servo.begin(configuration.address,
                   configuration.channel,
                   configuration.minimumPulseMicroseconds,
                   configuration.maximumPulseMicroseconds,
                   configuration.startupAngle)) {
    if (retry) {
      AppLog::printf("Servo channel %u is still unavailable; will retry.\n",
                     configuration.channel + 1);
    }
    return false;
  }

  if (retry) {
    AppLog::printf("Servo channel %u is available at its configured startup position.\n",
                   configuration.channel + 1);
  }
  return true;
}
}  // namespace

#if WIFI_CREDENTIALS_AVAILABLE
void beginOta() {
  snprintf(otaHostname, sizeof(otaHostname), "ghost-controller");
  ArduinoOTA.setHostname(otaHostname);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.onStart([]() {
    AppLog::println("OTA update started.");
  });
  ArduinoOTA.onEnd([]() {
    AppLog::println("\nOTA update complete; restarting.");
  });
  ArduinoOTA.onError([](ota_error_t error) {
    AppLog::printf("OTA update failed (error %u).\n",
                   static_cast<unsigned>(error));
  });
  ArduinoOTA.begin();
  otaReady = true;
  AppLog::printf("OTA ready: %s.local\n", otaHostname);
}
#endif

void printStartupInfo() {
  AppLog::println("ESP8266 device information");
  AppLog::printf("Chip ID: 0x%06X\n", ESP.getChipId());
  AppLog::printf("CPU frequency: %u MHz\n", ESP.getCpuFreqMHz());
  AppLog::printf("SDK version: %s\n", ESP.getSdkVersion());
  AppLog::printf("Arduino core version: %s\n", ESP.getCoreVersion().c_str());
  AppLog::printf("Reset reason: %s\n", ESP.getResetReason().c_str());

  AppLog::println("Memory:");
  AppLog::printf("  Free heap: %u bytes\n", ESP.getFreeHeap());
  AppLog::printf("  Largest free heap block: %u bytes\n",
                 ESP.getMaxFreeBlockSize());
  AppLog::printf("  Heap fragmentation: %u%%\n", ESP.getHeapFragmentation());
  AppLog::printf("  Sketch size: %u bytes\n", ESP.getSketchSize());
  AppLog::printf("  Free OTA sketch space: %u bytes\n",
                 ESP.getFreeSketchSpace());

  AppLog::println("Flash:");
  AppLog::printf("  Chip ID: 0x%06X\n", ESP.getFlashChipId());
  AppLog::printf("  Configured size: %u bytes\n", ESP.getFlashChipSize());
  AppLog::printf("  Detected size: %u bytes\n", ESP.getFlashChipRealSize());
  AppLog::printf("  Speed: %u Hz\n", ESP.getFlashChipSpeed());
  AppLog::printf("  Mode: %u\n", static_cast<unsigned>(ESP.getFlashChipMode()));
}

bool oledRespondsAt(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

bool initializeOledOnPins(int sdaPin, int sclPin) {
  Wire.begin(sdaPin, sclPin);
  Wire.setClock(100000);
  Wire.setClockStretchLimit(1000);
  if (!ensureI2cBusReady("OLED startup", sdaPin, sclPin)) return false;
  AppLog::printf("Checking OLED on SDA GPIO%d, SCL GPIO%d...\n",
                 sdaPin, sclPin);

  uint8_t address = 0;
  if (oledRespondsAt(0x3C)) {
    address = 0x3C;
  } else if (oledRespondsAt(0x3D)) {
    address = 0x3D;
  }

  if (address == 0) {
    AppLog::println("No OLED response on this pin pair.");
    return false;
  }

  AppLog::printf("OLED acknowledged at 0x%02X.\n", address);
  return oledDisplay.begin(address);
}

void setup() {
  Serial.begin(115200);
  AppLog::begin();
  delay(100);

  oledReady = kEnableOled && initializeOledOnPins(kOledSdaPin, kOledSclPin);
  // if (!oledReady) {
  //   AppLog::println("Trying alternate SDA/SCL GPIO assignment.");
  //   oledReady = initializeOledOnPins(kI2cSdaPin, kI2cSclPin);
  // }
  // if (!oledReady) {
  //   AppLog::println(
  //       "Trying common onboard OLED pins: SDA GPIO4, SCL GPIO5.");
  //   oledReady = initializeOledOnPins(4, 5);
  // }
  // if (!oledReady) {
  //   AppLog::println("Trying onboard OLED pins with swapped assignment.");
  //   oledReady = initializeOledOnPins(5, 4);
  // }

  AppLog::println();
  AppLog::println("Lamp Controller starting");
  printStartupInfo();

  if (!kEnableOled) {
    AppLog::println("OLED disabled; no display probing or initialization.");
  } else if (!oledReady) {
    AppLog::println("OLED unavailable; continuing without display.");
  }

  AppLog::printf("External servo I2C: SDA GPIO%u, SCL GPIO%u.\n", kI2cSdaPin, kI2cSclPin);
  Wire.begin(kI2cSdaPin, kI2cSclPin);  // External PCA9685 bus: SDA D2/GPIO4, SCL D1/GPIO5.
  Wire.setClock(100000);
  Wire.setClockStretchLimit(1000);
  const bool servoBusReady = ensureI2cBusReady("servo startup");
  filesystemReady = LittleFS.begin();
  if (!filesystemReady) {
    AppLog::println("LittleFS mount failed; cannot load config.json.");
  } else if (!loadServoConfigurations(servoConfigurations,
                                      kMaximumServoCount,
                                      servoCount)) {
    AppLog::println("No servo outputs initialized; fix data/config.json.");
  } else {
    servoConfigurationsReady = true;
    if (servoBusReady) {
      for (uint8_t index = 0; index < servoCount; ++index) {
        initializeServo(index, false);
      }
    }
  }

#if WIFI_CREDENTIALS_AVAILABLE
  if (WIFI_SSID[0] == '\0' || WIFI_PASSWORD[0] == '\0') {
    AppLog::println(
        "Wi-Fi and web status disabled: configure include/WifiCredentials.h.");
  } else {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    snprintf(otaHostname, sizeof(otaHostname), "ghost-controller");
    WiFi.hostname(otaHostname);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    AppLog::printf("Connecting to Wi-Fi '%s'...\n", WIFI_SSID);
    if (OTA_PASSWORD[0] == '\0') {
      AppLog::println("OTA disabled: set OTA_PASSWORD in WifiCredentials.h.");
    }
  }
#else
  AppLog::println(
      "OTA disabled: copy include/WifiCredentials.example.h to "
      "include/WifiCredentials.h and enter your credentials.");
#endif

}

void loop() {
  const unsigned long now = millis();
  if (servoConfigurationsReady &&
      now - lastServoControllerRetryAt >=
          kServoControllerRetryIntervalMilliseconds) {
    lastServoControllerRetryAt = now;
    bool retryNeeded = false;
    for (uint8_t index = 0; index < servoCount; ++index) {
      if (!servos[index].isReady()) retryNeeded = true;
    }
    if (retryNeeded && ensureI2cBusReady("servo retry")) {
      for (uint8_t index = 0; index < servoCount; ++index) {
        if (!servos[index].isReady()) initializeServo(index, true);
      }
    }
  }

#if WIFI_CREDENTIALS_AVAILABLE
  if (WIFI_SSID[0] != '\0' && WIFI_PASSWORD[0] != '\0') {
    if (WiFi.status() == WL_CONNECTED) {
      if (!wifiConnectedPreviously) {
        wifiConnectedPreviously = true;
        const String ipAddress = WiFi.localIP().toString();
        AppLog::printf("Wi-Fi connected; IP address: %s\n",
                       ipAddress.c_str());
        oledDisplay.showIpAddress(ipAddress);
        if (!webServerReady) {
          webStatusServer.begin(servos, servoConfigurations, servoCount,
                                filesystemReady);
          webServerReady = true;
          AppLog::printf("Device status page: http://%s/\n",
                         ipAddress.c_str());
        }
#if WIFI_CREDENTIALS_AVAILABLE
        if (OTA_PASSWORD[0] != '\0') {
          beginOta();
        }
#endif
      }
#if WIFI_CREDENTIALS_AVAILABLE
      if (otaReady) {
        ArduinoOTA.handle();
      }
#endif
    } else if (wifiConnectedPreviously) {
      wifiConnectedPreviously = false;
      otaReady = false;
      AppLog::println("Wi-Fi disconnected.");
      oledDisplay.showStatus("WiFi disconnected");
    }

    if (!wifiConnectedPreviously && now - lastWiFiStatusLogAt >= 10000) {
      lastWiFiStatusLogAt = now;
      AppLog::printf("Still connecting to Wi-Fi (status %d).\n",
                     static_cast<int>(WiFi.status()));
    }
  }
#endif

  if (webServerReady) {
    webStatusServer.handleClient();
  }

  for (uint8_t index = 0; index < servoCount; ++index) {
    servos[index].updateMotion();
  }
}