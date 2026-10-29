#pragma once

#include <Arduino.h>

class BoardRgbLed {
 public:
  void begin();
  void setColor(uint8_t red, uint8_t green, uint8_t blue);
  void off();
  uint8_t red() const { return red_; }
  uint8_t green() const { return green_; }
  uint8_t blue() const { return blue_; }
 private:
  uint8_t red_ = 0, green_ = 0, blue_ = 0;
};
