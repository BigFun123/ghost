#pragma once

#include <Arduino.h>

#include <Adafruit_SSD1306.h>
#include <Wire.h>

class OledDisplay {
 public:
  bool begin(uint8_t address = 0x3C);
  void showStatus(const char* status);
  void showIpAddress(const String& ipAddress);

 private:
  void showMessage(const char* heading, const String& message);

  Adafruit_SSD1306 display_{128, 64, &Wire, -1};
  bool initialized_ = false;
};
