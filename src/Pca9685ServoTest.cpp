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
}  // namespace

bool Pca9685ServoTest::begin(uint8_t address,
                             uint8_t channel,
                             uint16_t minimumPulseMicroseconds,
                             uint16_t maximumPulseMicroseconds) {
  if (channel > 15 || minimumPulseMicroseconds < 500 ||
      maximumPulseMicroseconds > 2500 ||
      minimumPulseMicroseconds >= maximumPulseMicroseconds) {
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
  if (!setPulseMicroseconds(minimumPulseMicroseconds_)) {
    initialized_ = false;
    return false;
  }
  angle_ = 0;
  AppLog::printf("PCA9685 0x%02X channel %u ready (%u-%u us).\n",
                 address_, channel_ + 1, minimumPulseMicroseconds_,
                 maximumPulseMicroseconds_);
  return true;
}

bool Pca9685ServoTest::setAngle(uint8_t angle) {
  if (!initialized_ || angle > 180) {
    return false;
  }
  const uint16_t pulseMicroseconds = static_cast<uint16_t>(
      minimumPulseMicroseconds_ +
      (static_cast<uint32_t>(angle) *
       (maximumPulseMicroseconds_ - minimumPulseMicroseconds_)) /
          180);
  if (setPulseMicroseconds(pulseMicroseconds)) {
    angle_ = angle;
    AppLog::printf("Servo channel %u commanded to %u degrees (%u us).\n",
                   channel_ + 1, angle_, pulseMicroseconds_);
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

bool Pca9685ServoTest::isEnabled() const {
  return enabled_;
}

uint8_t Pca9685ServoTest::angle() const {
  return angle_;
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

  AppLog::printf("PCA9685 I2C write failed (status %u).\n", result);
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
  Wire.write(enabled_ ? static_cast<uint8_t>(offCount & 0xFF) : 0x00);
  Wire.write(enabled_ ? static_cast<uint8_t>(offCount >> 8) : 0x10);
  const uint8_t result = Wire.endTransmission();
  if (result == 0) {
    pulseMicroseconds_ = pulseMicroseconds;
    return true;
  }

  AppLog::printf("PCA9685 servo output write failed (status %u).\n", result);
  return false;
}
