#include "DistanceSensor.h"

#include <Wire.h>
#include "AppLog.h"

namespace {
constexpr uint8_t kAddress = 0x29;
constexpr unsigned long kRetryMs = 5000;
constexpr unsigned long kStaleMs = 500;
}

bool DistanceSensor::readRegisters(uint8_t reg, uint8_t* values, uint8_t count) {
  Wire.beginTransmission(kAddress);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(kAddress, count) != count) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (uint8_t i = 0; i < count; ++i) values[i] = Wire.read();
  return true;
}

void DistanceSensor::begin() {
  attempted_ = true;
  attemptedAt_ = millis();
  valid_ = false;
  sampled_ = false;
  rangeStatus_ = 255;
  // Wire is already configured for the PCA9685; never reinitialize the shared bus.
  uint8_t model = 0;
  if (!readRegisters(VL53L0X::IDENTIFICATION_MODEL_ID, &model, 1) || model != 0xEE) return;
  sensor_.setTimeout(100);
  if (!sensor_.init() || !sensor_.setMeasurementTimingBudget(33000)) return;
  sensor_.startContinuous(100);
  ready_ = sensor_.last_status == 0;
  activityAt_ = millis();
  if (ready_) AppLog::println("VL53L0X ready at 0x29 on the PCA9685 I2C bus.");
}

void DistanceSensor::disconnect() {
  ready_ = false;
  valid_ = false;
  attemptedAt_ = millis();
  AppLog::println("VL53L0X unavailable; retrying in 5 seconds.");
}

void DistanceSensor::update() {
  const unsigned long now = millis();
  if (!ready_) {
    if (!attempted_ || now - attemptedAt_ >= kRetryMs) begin();
    return;
  }
  if (now - polledAt_ < 20) return;
  polledAt_ = now;
  uint8_t interrupt = 0;
  if (!readRegisters(VL53L0X::RESULT_INTERRUPT_STATUS, &interrupt, 1)) {
    disconnect();
    return;
  }
  if (!(interrupt & 7)) {
    if (now - activityAt_ > kStaleMs) disconnect();
    return;
  }
  // Read only completed measurements, without waiting for the next range.
  uint8_t result[12];
  if (!readRegisters(VL53L0X::RESULT_RANGE_STATUS, result, sizeof(result))) {
    disconnect();
    return;
  }
  sensor_.writeReg(VL53L0X::SYSTEM_INTERRUPT_CLEAR, 1);
  if (sensor_.last_status != 0) { disconnect(); return; }
  activityAt_ = sampledAt_ = now;
  sampled_ = true;
  rangeStatus_ = (result[0] & 0x78) >> 3;
  distance_ = (static_cast<uint16_t>(result[10]) << 8) | result[11];
  // Device status 11 means a completed, valid range (ST's raw device status).
  valid_ = rangeStatus_ == 11 && distance_ < 8190;
}

void DistanceSensor::appendStatus(JsonObject status) const {
  const unsigned long age = millis() - sampledAt_;
  const bool valid = ready_ && valid_ && sampled_ && age <= kStaleMs;
  status["model"] = "VL53L0X";
  status["address"] = kAddress;
  status["ready"] = ready_;
  status["valid"] = valid;
  status["distanceMm"] = nullptr;
  if (valid) status["distanceMm"] = distance_;
  status["rangeStatus"] = nullptr;
  status["sampleAgeMs"] = nullptr;
  if (sampled_) {
    status["rangeStatus"] = rangeStatus_;
    status["sampleAgeMs"] = age;
  }
}
