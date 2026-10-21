#pragma once

#include <Arduino.h>

enum class ServoMotionSpeed : uint8_t {
  Low,
  Medium,
  High
};

class Pca9685ServoTest {
 public:
  bool begin(uint8_t address = 0x40,
             uint8_t channel = 0,
             uint16_t minimumPulseMicroseconds = 500,
             uint16_t maximumPulseMicroseconds = 2500,
             uint8_t initialAngle = 0);
  bool setAngle(uint8_t angle);
  bool setTargetAngle(uint8_t angle, bool smooth, ServoMotionSpeed speed,
                      float playbackRate = 1.0f);
  bool updateMotion();
  bool setEnabled(bool enabled);
  bool setOutputEnabled(bool enabled);
  bool isOutputEnabled() const;
  bool isReady() const;
  bool isEnabled() const;
  bool isMotionRunning() const;
  uint8_t angle() const;
  uint8_t targetAngle() const;
  uint16_t pulseMicroseconds() const;

 private:
  bool writeRegister(uint8_t reg, uint8_t value);
  bool setPulseMicroseconds(uint16_t pulseMicroseconds);
  bool writeAngle(uint8_t angle, bool logCommand);

  uint8_t address_ = 0x40;
  uint8_t channel_ = 0;
  uint8_t angle_ = 0;
  uint8_t motionTargetAngle_ = 0;
  uint16_t minimumPulseMicroseconds_ = 500;
  uint16_t maximumPulseMicroseconds_ = 2500;
  uint16_t pulseMicroseconds_ = 1000;
  uint32_t motionDurationMilliseconds_ = 0;
  unsigned long motionStartedAt_ = 0;
  float motionStartPosition_ = 0.0f;
  float motionPosition_ = 0.0f;
  bool enabled_ = true;
  bool outputEnabled_ = true;
  bool initialized_ = false;
  bool motionRunning_ = false;
};
