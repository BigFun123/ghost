#include "ServoPositionStore.h"

#include "AppLog.h"

#include <ArduinoJson.h>
#include <LittleFS.h>

namespace {
constexpr char kPositionFile[] = "/servo-positions.json";
constexpr char kTemporaryPositionFile[] = "/servo-positions.json.tmp";
}

bool loadServoPositions(uint8_t* positions, uint8_t capacity, uint8_t count) {
  if (positions == nullptr || count > capacity) {
    AppLog::println("Invalid servo position storage buffer.");
    return false;
  }
  for (uint8_t index = 0; index < count; ++index) {
    positions[index] = 0;
  }

  File file = LittleFS.open(kPositionFile, "r");
  if (!file) {
    AppLog::println("No saved servo positions; starting at zero.");
    return true;
  }

  JsonDocument document;
  const DeserializationError error = deserializeJson(document, file);
  file.close();
  if (error) {
    AppLog::printf("Saved servo position JSON error: %s.\n", error.c_str());
    return false;
  }

  const JsonArrayConst savedPositions =
      document["positions"].as<JsonArrayConst>();
  if (savedPositions.isNull() || savedPositions.size() != count) {
    AppLog::println("Saved servo positions do not match the configured servos.");
    return false;
  }

  uint8_t index = 0;
  for (JsonVariantConst position : savedPositions) {
    if (!position.is<int>() || position.as<int>() < 0 ||
        position.as<int>() > 180) {
      AppLog::printf("Invalid saved servo position at entry %u.\n",
                     index + 1);
      return false;
    }
    positions[index++] = static_cast<uint8_t>(position.as<int>());
  }

  AppLog::printf("Loaded %u saved servo position(s).\n", count);
  return true;
}

bool saveServoPositions(const uint8_t* positions, uint8_t count) {
  if (positions == nullptr) {
    AppLog::println("Invalid servo position storage buffer.");
    return false;
  }

  JsonDocument document;
  JsonArray savedPositions = document["positions"].to<JsonArray>();
  for (uint8_t index = 0; index < count; ++index) {
    if (positions[index] > 180) {
      AppLog::printf("Invalid servo position at entry %u.\n", index + 1);
      return false;
    }
    savedPositions.add(positions[index]);
  }

  File file = LittleFS.open(kTemporaryPositionFile, "w");
  if (!file) {
    AppLog::println("Could not open temporary servo position file.");
    return false;
  }
  const size_t expectedBytes = measureJson(document);
  const size_t bytesWritten = serializeJson(document, file);
  file.close();
  if (bytesWritten != expectedBytes ||
      !LittleFS.rename(kTemporaryPositionFile, kPositionFile)) {
    LittleFS.remove(kTemporaryPositionFile);
    AppLog::println("Could not save servo positions.");
    return false;
  }
  return true;
}
