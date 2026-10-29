#include "ServoConfiguration.h"

#include "AppLog.h"
#include "RobotStorage.h"
#include "ComponentCatalog.h"

#include <ArduinoJson.h>
#include <LittleFS.h>
#include <stdlib.h>
#include <string.h>

namespace {
bool parseAddress(const String& text, uint8_t& address) {
  char* end = nullptr;
  const unsigned long value = strtoul(text.c_str(), &end, 0);
  if (text.length() == 0 || end == text.c_str() || *end != '\0' ||
      value < 0x40 || value > 0x77) {
    return false;
  }
  address = static_cast<uint8_t>(value);
  return true;
}

bool hasDuplicateChannel(const ServoConfiguration* configurations,
                         uint8_t count,
                         const ServoConfiguration& candidate) {
  for (uint8_t index = 0; index < count; ++index) {
    if (configurations[index].address == candidate.address &&
        configurations[index].channel == candidate.channel) {
      return true;
    }
  }
  return false;
}
}  // namespace

bool loadServoConfigurations(ServoConfiguration* configurations,
                             uint8_t capacity,
                             uint8_t& configurationCount) {
  configurationCount = 0;
  File file = LittleFS.open(RobotStorage::path("config.json"), "r");
  if (!file) {
    AppLog::println("Servo configuration missing: /config.json.");
    return false;
  }

  JsonDocument document;
  const DeserializationError error = deserializeJson(document, file);
  file.close();
  if (error) {
    AppLog::printf("Servo configuration JSON error: %s.\n", error.c_str());
    return false;
  }

  const JsonArrayConst servos = document["components"].as<JsonArrayConst>();
  if (servos.isNull() || servos.size() == 0 ||
      servos.size() > 60) {
    AppLog::println("Configuration must contain 1-60 components.");
    return false;
  }

  for (JsonObjectConst entry : servos) {
    const char* objectType = entry["objectType"] | "Servo";
    if (strcmp(objectType, "Servo") != 0 && supportedComponentType(objectType)) continue;
    if (strcmp(objectType, "Servo") != 0 || configurationCount >= capacity || configurationCount >= kMaximumServoCount) {
      AppLog::println("Invalid component type or too many servo components.");
      configurationCount = 0;
      return false;
    }
    ServoConfiguration candidate;
    const char* name = entry["name"] | "";
    const char* addressText = entry["address"] | "";
    const int channel = entry["channel"] | -1;
    const int startupAngle = entry["startupAngle"] | -1;
    const int minimumPulse = entry["minPulseMicroseconds"] | -1;
    const int maximumPulse = entry["maxPulseMicroseconds"] | -1;

    if (name[0] == '\0' || strlen(name) > 31 ||
        !parseAddress(String(addressText), candidate.address) ||
        channel < 0 || channel > 15 ||
        startupAngle < 0 || startupAngle > 180 ||
        minimumPulse < 500 || maximumPulse > 2500 ||
        minimumPulse >= maximumPulse) {
      AppLog::printf("Invalid servo configuration at entry %u.\n",
                     configurationCount + 1);
      configurationCount = 0;
      return false;
    }

    if (!entry["continuous"].isNull() && !entry["continuous"].is<bool>()) {
      AppLog::println("Servo continuous must be boolean.");
      configurationCount = 0;
      return false;
    }
    candidate.continuous = entry["continuous"] | false;
    if (!candidate.continuous) {
      const double minimumAngle = entry["minAngle"] | 0.0;
      const double maximumAngle = entry["maxAngle"] | 180.0;
      if ((!entry["minAngle"].isNull() && !entry["minAngle"].is<double>()) ||
          (!entry["maxAngle"].isNull() && !entry["maxAngle"].is<double>()) ||
          !isfinite(minimumAngle) || !isfinite(maximumAngle) || minimumAngle < 0 || minimumAngle > 180 ||
          minimumAngle > maximumAngle || ceil(minimumAngle) > floor(maximumAngle)) {
        AppLog::println("Invalid servo angle limits.");
        configurationCount = 0;
        return false;
      }
      candidate.minimumAngle = static_cast<uint8_t>(ceil(minimumAngle));
      candidate.maximumAngle = static_cast<uint8_t>(min(180.0, floor(maximumAngle)));
    }
    candidate.name = name;
    candidate.channel = static_cast<uint8_t>(channel);
    candidate.startupAngle = static_cast<uint8_t>(startupAngle);
    candidate.minimumPulseMicroseconds =
        static_cast<uint16_t>(minimumPulse);
    candidate.maximumPulseMicroseconds =
        static_cast<uint16_t>(maximumPulse);
    if (hasDuplicateChannel(configurations, configurationCount, candidate)) {
      AppLog::printf("Duplicate PCA9685 output at entry %u.\n",
                     configurationCount + 1);
      configurationCount = 0;
      return false;
    }
    configurations[configurationCount++] = candidate;
  }

  AppLog::printf("Loaded %u servo configuration(s).\n", configurationCount);
  return true;
}
