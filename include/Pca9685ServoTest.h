#pragma once

#include <Arduino.h>

class Pca9685ServoTest {
 public:
  bool begin(uint8_t address = 0x40,
             uint8_t channel = 0,
             uint16_t minimumPulseMicroseconds = 500,
             uint16_t maximumPulseMicroseconds = 2500);
  bool setAngle(uint8_t angle);
  bool setEnabled(bool enabled);
  bool isReady() const;
  bool isEnabled() const;
  uint8_t angle() const;
  uint16_t pulseMicroseconds() const;

 private:
  bool writeRegister(uint8_t reg, uint8_t value);
  bool setPulseMicroseconds(uint16_t pulseMicroseconds);

  uint8_t address_ = 0x40;
  uint8_t channel_ = 0;
  uint8_t angle_ = 0;
  uint16_t minimumPulseMicroseconds_ = 500;
  uint16_t maximumPulseMicroseconds_ = 2500;
  uint16_t pulseMicroseconds_ = 1000;
  bool enabled_ = true;
  bool initialized_ = false;
};
