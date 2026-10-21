#include "Pca9685ServoTest.h"

#include "AppLog.h"

#include <Wire.h>

namespace {
constexpr uint8_t kMode1Register = 0x00;
constexpr uint8_t kPrescaleRegister = 0xFE;
constexpr uint8_t kFirstLedRegister = 0x06;
constexpr uint16_t kServoFrameMicroseconds = 20000;
constexpr uint8_t kPwmFrequencyHz = 50;
constexpr float kOscillatorFrequencyHz = 25000000.0f;
constexpr uint16_t kMinimumMotionMilliseconds = 50;
constexpr uint16_t kFullRangeMotionMilliseconds = 1000;
constexpr float kSmoothstepPeakSpeedMultiplier = 1.5f;
}  // namespace

bool Pca9685ServoTest::begin(uint8_t address,
                             uint8_t channel,
                             uint16_t minimumPulseMicroseconds,
                             uint16_t maximumPulseMicroseconds,
                             uint8_t initialAngle) {
  initialized_ = false;
  motionRunning_ = false;
  if (channel > 15 || minimumPulseMicroseconds < 500 ||
      maximumPulseMicroseconds > 2500 ||
      minimumPulseMicroseconds >= maximumPulseMicroseconds ||
      initialAngle > 180) {
    AppLog::printf("Invalid PCA9685 servo configuration (channel %u).\n",
                   channel);
    return false;
  }
  address_ = address;
  channel_ = channel;
  minimumPulseMicroseconds_ = minimumPulseMicroseconds;
  maximumPulseMicroseconds_ = maximumPulseMicroseconds;

  const uint8_t prescale = static_cast<uint8_t>(
      (kOscillatorFrequencyHz / (4096.0f * kPwmFrequencyHz)) + 0.5f) -
      1;

  if (!writeRegister(kMode1Register, 0x10) ||
      !writeRegister(kPrescaleRegister, prescale) ||
      !writeRegister(kMode1Register, 0x20)) {
    AppLog::println("PCA9685 initialization failed; check I2C wiring and address.");
    return false;
  }

  delay(5);
  if (!writeRegister(kMode1Register, 0xA0)) {
    AppLog::println("PCA9685 restart failed.");
    return false;
  }

  initialized_ = true;
  angle_ = initialAngle;
  motionPosition_ = static_cast<float>(initialAngle);
  motionStartPosition_ = motionPosition_;
  motionTargetAngle_ = initialAngle;
  motionRunning_ = false;
  const uint16_t initialPulseMicroseconds = static_cast<uint16_t>(
      minimumPulseMicroseconds_ +
      (static_cast<uint32_t>(initialAngle) *
       (maximumPulseMicroseconds_ - minimumPulseMicroseconds_)) /
          180);
  if (!setPulseMicroseconds(initialPulseMicroseconds)) {
    initialized_ = false;
    return false;
  }
  AppLog::printf("PCA9685 0x%02X channel %u ready (%u-%u us).\n",
                 address_, channel_ + 1, minimumPulseMicroseconds_,
                 maximumPulseMicroseconds_);
  return true;
}

bool Pca9685ServoTest::setAngle(uint8_t angle) {
  if (!initialized_ || angle > 180) {
    return false;
  }
  if (!writeAngle(angle, true)) {
    return false;
  }
  motionPosition_ = static_cast<float>(angle);
  motionStartPosition_ = motionPosition_;
  motionTargetAngle_ = angle;
  motionRunning_ = false;
  return true;
}

bool Pca9685ServoTest::setTargetAngle(uint8_t angle,
                                      bool smooth,
                                      ServoMotionSpeed speed,
                                      float playbackRate) {
  if (!smooth) {
    return setAngle(angle);
  }
  if (!initialized_ || angle > 180) {
    return false;
  }

  motionStartPosition_ = motionPosition_;
  motionTargetAngle_ = angle;
  motionStartedAt_ = millis();
  const float targetPosition = static_cast<float>(angle);
  const float distance = targetPosition > motionStartPosition_
      ? targetPosition - motionStartPosition_
      : motionStartPosition_ - targetPosition;
  uint16_t speedMultiplier = 1;
  switch (speed) {
    case ServoMotionSpeed::Low:
      speedMultiplier = 4;
      break;
    case ServoMotionSpeed::Medium:
      speedMultiplier = 2;
      break;
    case ServoMotionSpeed::High:
      break;
  }
  const float motionDuration = distance * kFullRangeMotionMilliseconds *
      speedMultiplier * kSmoothstepPeakSpeedMultiplier / (180.0f * playbackRate);
  motionDurationMilliseconds_ = static_cast<uint32_t>(motionDuration + 0.999f);
  if (motionDurationMilliseconds_ < kMinimumMotionMilliseconds) {
    motionDurationMilliseconds_ = kMinimumMotionMilliseconds;
  }
  motionRunning_ = distance > 0.0f;
  if (!motionRunning_) {
    motionPosition_ = targetPosition;
  }
  AppLog::printf("Servo channel %u moving smoothly to %u degrees at %s speed.\n",
                 channel_ + 1, angle,
                 speed == ServoMotionSpeed::Low ? "low" :
                 speed == ServoMotionSpeed::Medium ? "medium" : "high");
  return true;
}

bool Pca9685ServoTest::updateMotion() {
  if (!initialized_ || !motionRunning_) {
    return true;
  }

  const unsigned long elapsed = millis() - motionStartedAt_;
  const float progress = elapsed >= motionDurationMilliseconds_
      ? 1.0f
      : static_cast<float>(elapsed) / motionDurationMilliseconds_;
  const float easedProgress = progress * progress * (3.0f - 2.0f * progress);
  const float position = motionStartPosition_ +
      (static_cast<float>(motionTargetAngle_) - motionStartPosition_) *
          easedProgress;
  const uint8_t nextAngle = progress >= 1.0f
      ? motionTargetAngle_
      : static_cast<uint8_t>(position + 0.5f);
  if (nextAngle != angle_ && !writeAngle(nextAngle, false)) {
    motionRunning_ = false;
    return false;
  }
  motionPosition_ = position;
  if (progress >= 1.0f) {
    motionPosition_ = static_cast<float>(motionTargetAngle_);
    motionRunning_ = false;
    AppLog::printf("Servo channel %u reached %u degrees.\n",
                   channel_ + 1, motionTargetAngle_);
  }
  return true;
}

bool Pca9685ServoTest::writeAngle(uint8_t angle, bool logCommand) {
  const uint16_t pulseMicroseconds = static_cast<uint16_t>(
      minimumPulseMicroseconds_ +
      (static_cast<uint32_t>(angle) *
       (maximumPulseMicroseconds_ - minimumPulseMicroseconds_)) /
          180);
  if (setPulseMicroseconds(pulseMicroseconds)) {
    angle_ = angle;
    if (logCommand) {
      AppLog::printf("Servo channel %u commanded to %u degrees (%u us).\n",
                     channel_ + 1, angle_, pulseMicroseconds_);
    }
    return true;
  }
  initialized_ = false;
  return false;
}

bool Pca9685ServoTest::setEnabled(bool enabled) {
  if (!initialized_) {
    return false;
  }
  if (enabled_ == enabled) {
    return true;
  }

  enabled_ = enabled;
  if (setPulseMicroseconds(pulseMicroseconds_)) {
    AppLog::printf("Servo channel %u %s.\n", channel_ + 1,
                   enabled_ ? "unmuted" : "muted");
    return true;
  }
  enabled_ = !enabled;
  initialized_ = false;
  return false;
}

bool Pca9685ServoTest::isReady() const {
  return initialized_;
}

bool Pca9685ServoTest::setOutputEnabled(bool enabled) {
  if (!initialized_) return false;
  const bool previous = outputEnabled_;
  outputEnabled_ = enabled;
  if (!setPulseMicroseconds(pulseMicroseconds_)) {
    outputEnabled_ = previous;
    return false;
  }
  if (!enabled) {
    motionRunning_ = false;
    motionTargetAngle_ = angle_;
    motionPosition_ = static_cast<float>(angle_);
  }
  return true;
}

bool Pca9685ServoTest::isOutputEnabled() const {
  return outputEnabled_;
}

bool Pca9685ServoTest::isEnabled() const {
  return enabled_;
}

bool Pca9685ServoTest::isMotionRunning() const {
  return motionRunning_;
}

uint8_t Pca9685ServoTest::angle() const {
  return angle_;
}

uint8_t Pca9685ServoTest::targetAngle() const {
  return motionTargetAngle_;
}

uint16_t Pca9685ServoTest::pulseMicroseconds() const {
  return pulseMicroseconds_;
}

bool Pca9685ServoTest::writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(address_);
  Wire.write(reg);
  Wire.write(value);
  const uint8_t result = Wire.endTransmission();
  if (result == 0) {
    return true;
  }

  AppLog::printf("PCA9685 0x%02X register 0x%02X I2C write failed (status %u%s).\n",
                 address_, reg, result, result == 4 ? "; bus busy" : "");
  return false;
}

bool Pca9685ServoTest::setPulseMicroseconds(uint16_t pulseMicroseconds) {
  const uint16_t offCount = static_cast<uint16_t>(
      (static_cast<uint32_t>(pulseMicroseconds) * 4096 +
       kServoFrameMicroseconds / 2) /
      kServoFrameMicroseconds);

  Wire.beginTransmission(address_);
  Wire.write(static_cast<uint8_t>(kFirstLedRegister + channel_ * 4));
  Wire.write(0x00);
  Wire.write(0x00);
  Wire.write(enabled_ && outputEnabled_ ? static_cast<uint8_t>(offCount & 0xFF) : 0x00);
  Wire.write(enabled_ && outputEnabled_ ? static_cast<uint8_t>(offCount >> 8) : 0x10);
  const uint8_t result = Wire.endTransmission();
  if (result == 0) {
    pulseMicroseconds_ = pulseMicroseconds;
    return true;
  }

  AppLog::printf("PCA9685 servo output write failed (status %u).\n", result);
  return false;
}
