#pragma once

#include <Arduino.h>

class BoardRgbLed {
 public:
  void begin();
  void setColor(uint8_t red, uint8_t green, uint8_t blue);
  void off();
};
