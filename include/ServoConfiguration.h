#pragma once

#include <Arduino.h>

struct ServoConfiguration {
  String name;
  uint8_t address = 0x40;
  uint8_t channel = 0;
  uint8_t startupAngle = 0;
  bool continuous = false;
  uint16_t minimumPulseMicroseconds = 500;
  uint16_t maximumPulseMicroseconds = 2500;
};

constexpr uint8_t kMaximumServoCount = 20;

bool loadServoConfigurations(ServoConfiguration* configurations,
                             uint8_t capacity,
                             uint8_t& configurationCount);
