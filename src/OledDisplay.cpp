#include "OledDisplay.h"

#include "AppLog.h"

#include <Wire.h>

bool OledDisplay::begin(uint8_t address) {
  bool displayStarted = display_.begin(SSD1306_SWITCHCAPVCC, address);
  if (!displayStarted && address == 0x3C) {
    displayStarted = display_.begin(SSD1306_SWITCHCAPVCC, 0x3D);
    if (displayStarted) {
      AppLog::println("OLED found at fallback I2C address 0x3D.");
    }
  }

  if (!displayStarted) {
    AppLog::printf("OLED initialization failed at I2C address 0x%02X.\n",
                   address);
    return false;
  }

  initialized_ = true;
  display_.setTextColor(SSD1306_WHITE);
  display_.setTextSize(1);
  display_.clearDisplay();
  display_.setCursor(0, 0);
  display_.setTextSize(2);
  display_.println("Hello!");
  display_.setTextSize(1);
  display_.println();
  display_.println("Lamp Controller");
  display_.display();
  AppLog::println("OLED initialized; displaying startup greeting.");
  return true;
}

void OledDisplay::showStatus(const char* status) {
  showMessage("Lamp Controller", String(status));
}

void OledDisplay::showIpAddress(const String& ipAddress) {
  showMessage("WiFi connected", ipAddress);
}

void OledDisplay::showMessage(const char* heading, const String& message) {
  if (!initialized_) {
    return;
  }

  display_.clearDisplay();
  display_.setCursor(0, 0);
  display_.println(heading);
  display_.println();
  display_.println(message);
  display_.display();
}
