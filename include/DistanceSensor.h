#pragma once

#include <ArduinoJson.h>
#include <VL53L0X.h>

class DistanceSensor {
 public:
  void begin();
  void update();
  void appendStatus(JsonObject status) const;

 private:
  bool readRegisters(uint8_t reg, uint8_t* values, uint8_t count);
  void disconnect();
  VL53L0X sensor_;
  bool ready_ = false;
  bool valid_ = false;
  bool attempted_ = false;
  bool sampled_ = false;
  uint16_t distance_ = 0;
  uint8_t rangeStatus_ = 255;
  unsigned long attemptedAt_ = 0;
  unsigned long polledAt_ = 0;
  unsigned long sampledAt_ = 0;
  unsigned long activityAt_ = 0;
};
