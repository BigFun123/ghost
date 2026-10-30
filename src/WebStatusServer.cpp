#include "WebStatusServer.h"

#include "AppLog.h"
#include "RobotStorage.h"
#include "ComponentCatalog.h"
#include "BoardRgbLed.h"
#include "DistanceSensor.h"

extern DistanceSensor distanceSensor;

extern BoardRgbLed boardRgbLed;
#include "ServoPositionStore.h"

#include <ArduinoJson.h>
#include "DevicePlatform.h"
#include <LittleFS.h>
#include <math.h>

namespace {
bool validPowerRange(JsonObjectConst component) {
  for (const char* key : {"minPowerWatts", "maxPowerWatts"}) {
    const JsonVariantConst value = component[key];
    if (!value.isNull() && (!value.is<double>() || !isfinite(value.as<double>()) || value.as<double>() < 0)) return false;
  }
  for (const char* key : {"powerVoltageVolts", "idleCurrentAmps", "runningCurrentAmps", "peakCurrentAmps"}) {
    const JsonVariantConst value = component[key];
    if (!value.isNull() && (!value.is<double>() || !isfinite(value.as<double>()) ||
        (String(key) == "powerVoltageVolts" ? value.as<double>() <= 0 : value.as<double>() < 0))) return false;
  }
  const JsonVariantConst idle = component["idleCurrentAmps"], running = component["runningCurrentAmps"], peak = component["peakCurrentAmps"];
  if (!idle.isNull() && !peak.isNull() && idle.as<double>() > peak.as<double>()) return false;
  if (!running.isNull() && ((!idle.isNull() && running.as<double>() < idle.as<double>()) ||
      (!peak.isNull() && running.as<double>() > peak.as<double>()))) return false;
  return component["minPowerWatts"].isNull() || component["maxPowerWatts"].isNull() ||
      component["minPowerWatts"].as<double>() <= component["maxPowerWatts"].as<double>();
}

bool validRgb(JsonVariantConst value) {
  if (!value.is<JsonArrayConst>() || value.size() != 3) return false;
  for (JsonVariantConst channel : value.as<JsonArrayConst>()) {
    if (!channel.is<int>() || channel.as<int>() < 0 || channel.as<int>() > 255) return false;
  }
  return true;
}
constexpr uint8_t kMaximumSequenceSteps = 32;
constexpr uint32_t kMinimumStepDurationMilliseconds = 100;
constexpr uint32_t kMaximumStepDurationMilliseconds = 60000;
constexpr size_t kMaximumSequenceFileBytes = 8192;
constexpr unsigned long kServoPositionSaveDelayMilliseconds = 5000;

bool validNullConstraints(JsonVariantConst value) {
  if (!value.is<JsonObjectConst>()) return false;
  for (JsonPairConst entry : value.as<JsonObjectConst>()) {
    const String axis = entry.key().c_str();
    if (axis != "x" && axis != "y" && axis != "z") return false;
    const JsonObjectConst limit = entry.value().as<JsonObjectConst>();
    if (limit.isNull() || !limit["enabled"].is<bool>() || !limit["min"].is<double>() || !limit["max"].is<double>() ||
        !isfinite(limit["min"].as<double>()) || !isfinite(limit["max"].as<double>()) || limit["min"].as<double>() > limit["max"].as<double>()) return false;
  }
  return true;
}

bool validCameraSettings(JsonVariantConst value) {
  if (!value.is<JsonObjectConst>()) return false;
  const JsonObjectConst camera = value.as<JsonObjectConst>();
  for (const char* key : {"yaw", "pitch", "roll", "zoom", "panX", "panY", "panZ"}) {
    if (!camera[key].is<double>() || !isfinite(camera[key].as<double>())) return false;
  }
  if (fabs(camera["pitch"].as<double>()) > 1.570796326795 ||
      camera["zoom"].as<double>() < 0.001 || camera["zoom"].as<double>() > 5 || !camera["perspective"].is<bool>()) return false;
  if (!camera["views"].isUnbound()) {
    if (!camera["views"].is<JsonObjectConst>()) return false;
    for (JsonPairConst entry : camera["views"].as<JsonObjectConst>()) {
      const String slot = entry.key().c_str();
      if (slot != "u1" && slot != "u2" && slot != "u3") return false;
      const JsonObjectConst view = entry.value().as<JsonObjectConst>();
      if (view.isNull()) return false;
      for (const char* key : {"yaw", "pitch", "roll", "zoom", "panX", "panY", "panZ"}) {
        if (!view[key].is<double>() || !isfinite(view[key].as<double>())) return false;
      }
      if (fabs(view["pitch"].as<double>()) > 1.570796326795 || view["zoom"].as<double>() < 0.001 ||
          view["zoom"].as<double>() > 5 || !view["perspective"].is<bool>()) return false;
    }
  }
  const JsonObjectConst webcam = camera["webcam"].as<JsonObjectConst>();
  if (webcam.isNull() || (!webcam["active"].isUnbound() && !webcam["active"].is<bool>()) || !webcam["deviceId"].is<const char*>() || strlen(webcam["deviceId"].as<const char*>()) > 512 ||
      !webcam["mirror"].is<bool>()) return false;
  const String fit = webcam["fit"] | "";
  if (fit != "cover" && fit != "contain") return false;
  const JsonObjectConst controls = webcam["controls"].as<JsonObjectConst>();
  if (controls.isNull() || controls.size() > 24) return false;
  for (JsonPairConst entry : controls) {
    if (strlen(entry.key().c_str()) > 31) return false;
    JsonVariantConst setting = entry.value();
    if (setting.is<bool>()) continue;
    if (setting.is<double>() && isfinite(setting.as<double>())) continue;
    if (setting.is<const char*>() && strlen(setting.as<const char*>()) <= 64) continue;
    return false;
  }
  return true;
}

void appendJsonString(String& json, const String& value) {
  static const char hexDigits[] = "0123456789abcdef";
  json += '"';
  for (size_t index = 0; index < value.length(); ++index) {
    const uint8_t character = static_cast<uint8_t>(value[index]);
    switch (character) {
      case '"':
      case '\\':
        json += '\\';
        json += static_cast<char>(character);
        break;
      case '\b':
        json += F("\\b");
        break;
      case '\f':
        json += F("\\f");
        break;
      case '\n':
        json += F("\\n");
        break;
      case '\r':
        json += F("\\r");
        break;
      case '\t':
        json += F("\\t");
        break;
      default:
        if (character < 0x20) {
          json += F("\\u00");
          json += hexDigits[character >> 4];
          json += hexDigits[character & 0x0F];
        } else {
          json += static_cast<char>(character);
        }
        break;
    }
  }
  json += '"';
}
}  // namespace

void WebStatusServer::begin(Pca9685ServoTest* servos,
                            const ServoConfiguration* configurations,
                            uint8_t servoCount,
                            bool filesystemReady) {
  servos_ = servos;
  configurations_ = configurations;
  servoCount_ = servoCount;
  filesystemReady_ = filesystemReady;
  if (filesystemReady_) {
    AppLog::println("LittleFS mounted.");
  } else {
    AppLog::println("LittleFS mount failed; upload the filesystem image.");
  }
  runtimeRobot_ = RobotStorage::active();
  initializeServoPositionStorage();
  server_.on("/api/robots", HTTP_GET, [this]() {
    JsonDocument manifest;
    File file = LittleFS.open("/robots.json", "r");
    if (file) { deserializeJson(manifest, file); file.close(); }
    if (manifest["active"].isNull()) manifest["active"] = "";
    if (!manifest["robots"].is<JsonArray>()) manifest["robots"].to<JsonArray>();
    manifest["runtime"] = runtimeRobot_;
    String body; serializeJson(manifest, body);
    server_.send(200, "application/json", body);
  });
  server_.on("/api/robot/rename", HTTP_POST, [this]() {
    JsonDocument names;
    if (rebootPending_ || !filesystemReady_ || server_.arg("plain").length() > 256 || deserializeJson(names, server_.arg("plain"))) {
      server_.send(400, "text/plain", "Invalid robot rename request"); return;
    }
    const String from = names["from"] | "", to = names["to"] | "";
    if (!RobotStorage::renameRobot(from, to)) { server_.send(409, "text/plain", "Could not rename robot; check the name and that its folder does not already exist"); return; }
    if (runtimeRobot_ == from) { runtimeRobot_ = to; initializeServoPositionStorage(); }
    server_.send(200, "text/plain", "Robot folder renamed");
  });
  server_.on("/api/robot/select", HTTP_POST, [this]() {
    JsonDocument body;
    if (rebootPending_ || server_.arg("plain").length() > 256 || deserializeJson(body, server_.arg("plain")) || !RobotStorage::select(body["name"] | "")) {
      server_.send(400, "text/plain", "Invalid robot selection"); return;
    }
    if (runtimeRobot_ != RobotStorage::active()) {
      for (uint8_t i = 0; i < servoCount_; ++i) servos_[i].setOutputEnabled(false);
    }
    server_.send(200, "text/plain", "Robot selected. Restart to apply on hardware.");
  });
  server_.on("/", HTTP_GET, [this]() {
    sendAsset("/index.html", "text/html; charset=utf-8");
  });
  server_.on("/style.css", HTTP_GET, [this]() {
    sendAsset("/style.css", "text/css; charset=utf-8");
  });
  server_.on("/3d-renderer.js", HTTP_GET, [this]() {
    sendAsset("/3d-renderer.js", "application/javascript; charset=utf-8");
  });
  server_.on("/metrics.js", HTTP_GET, [this]() {
    sendAsset("/metrics.js", "application/javascript; charset=utf-8");
  });
  server_.on("/shop.html", HTTP_GET, [this]() {
    sendAsset("/shop.html", "text/html; charset=utf-8");
  });
  server_.on("/shop.js", HTTP_GET, [this]() {
    sendAsset("/shop.js", "application/javascript; charset=utf-8");
  });
  server_.on("/app.js", HTTP_GET, [this]() {
    sendAsset("/app.js", "application/javascript; charset=utf-8");
  });
  for (const char* path : {"/camera-renderer.js", "/component-panels.js",
                           "/dialog.js", "/power-meters.js", "/simulated-sensor.js",
                           "/ai-rig.js", "/ai-runtime.js", "/ai-task.js",
                           "/ai-policy.js", "/ai-reward.js", "/ai-environment.js",
                           "/ai-view.js", "/ai-baseline.js", "/ai-curriculum.js",
                           "/ai-evaluation.js", "/ai-ppo.js", "/ai-training.js",
                           "/ai-worker-client.js", "/ai-worker.js", "/ai-learning.js",
                           "/ai-policy-file.js", "/ai-layout.js", "/ai-test-progress.js", "/ai-auto-training.js", "/ai-acquisition.js", "/ai-convergence.js"}) {
    server_.on(path, HTTP_GET, [this, path]() {
      sendAsset(path, "application/javascript; charset=utf-8");
    });
  }
  server_.on("/physics.js", HTTP_GET, [this]() {
    sendAsset("/physics.js", "application/javascript; charset=utf-8");
  });
  server_.on("/lib/rapier.js", HTTP_GET, [this]() {
    sendAsset("/lib/rapier.js", "application/javascript; charset=utf-8");
  });
  server_.on("/config.json", HTTP_GET, [this]() {
    const String robot = server_.hasArg("robot") ? server_.arg("robot") : RobotStorage::active();
    if (robot.length() && !RobotStorage::validName(robot)) { server_.send(400, "text/plain", "Invalid robot name"); return; }
    sendAsset(RobotStorage::path("config.json", robot).c_str(), "application/json; charset=utf-8");
  });
  server_.on("/api/config/servo", HTTP_POST, [this]() {
    saveServoConfiguration();
  });
  server_.on("/api/config/preview", HTTP_POST, [this]() {
    savePreviewConfiguration();
  });
  server_.on("/api/reboot", HTTP_POST, [this]() {
    if (!rebootPending_) {
      rebootPending_ = true;
      rebootRequestedAt_ = millis();
      AppLog::println("Controller reboot requested from frontend.");
    }
    server_.sendHeader("Connection", "close");
    server_.send(202, "text/plain; charset=utf-8", "Reboot scheduled");
  });
  server_.on("/api/sensors", HTTP_GET, [this]() {
    JsonDocument document;
    distanceSensor.appendStatus(document["vl53l0x"].to<JsonObject>());
    String body;
    serializeJson(document, body);
    server_.sendHeader("Cache-Control", "no-store");
    server_.send(200, "application/json; charset=utf-8", body);
  });
  server_.on("/api/status", HTTP_GET, [this]() {
    sendStatus();
  });
  server_.on("/api/log", HTTP_GET, [this]() {
    sendLog();
  });
  server_.on("/api/sequence", HTTP_GET, [this]() {
    sendSequence();
  });
  server_.on("/api/sequence", HTTP_POST, [this]() {
    saveSequence();
  });
  for (char slot = 'a'; slot <= 'j'; ++slot) {
    const String route = String("/api/sequence/") + slot;
    server_.on(route.c_str(), HTTP_GET, [this]() { sendSequence(); });
    server_.on(route.c_str(), HTTP_POST, [this]() { saveSequence(); });
  }
  server_.on("/api/led", HTTP_POST, [this]() {
    JsonDocument document;
    if (server_.arg("plain").length() > 128 || deserializeJson(document, server_.arg("plain")) || !validRgb(document["rgb"])) {
      server_.send(400, "text/plain", "Expected rgb: three integers from 0 to 255");
      return;
    }
    boardRgbLed.setColor(document["rgb"][0], document["rgb"][1], document["rgb"][2]);
    server_.send(200, "text/plain", "LED color updated");
  });
  server_.on("/api/servo", HTTP_POST, [this]() {
    setServoAngle();
  });
  server_.on("/api/servos", HTTP_POST, [this]() {
    setServoBatch();
  });
  server_.onNotFound([this]() {
    const String uri = server_.uri();
    const String componentPrefix = "/components/";
    if (server_.method() == HTTP_GET && uri.startsWith(componentPrefix) && uri.endsWith(".js")) {
      const String file = uri.substring(componentPrefix.length());
      bool valid = file.length() && file.indexOf("..") < 0;
      for (size_t i = 0; i < file.length(); ++i) {
        const char c = file[i];
        if (!isAlphaNumeric(c) && c != '.' && c != '-' && c != '_') valid = false;
      }
      if (valid) { sendAsset(uri.c_str(), "application/javascript; charset=utf-8"); return; }
    }
    server_.send(404, "text/plain; charset=utf-8", "Not found");
  });
  server_.begin();
  servoPositionsDirty_ = true;
  servoPositionsChangedAt_ = millis();
  AppLog::println("HTTP status page started.");
}

void WebStatusServer::sendAsset(const char* path, const char* contentType) {
  if (!filesystemReady_) {
    server_.send(503, "text/plain; charset=utf-8",
                 "Web assets unavailable: LittleFS is not mounted");
    return;
  }

  File file = LittleFS.open(path, "r");
  if (!file) {
    AppLog::printf("Web asset missing from LittleFS: %s\n", path);
    server_.send(404, "text/plain; charset=utf-8",
                 "Web asset not found. Upload the LittleFS image.");
    return;
  }

  server_.sendHeader("Cache-Control", "no-cache");
  server_.streamFile(file, contentType);
  file.close();
}

void WebStatusServer::handleClient() {
  server_.handleClient();
  if (rebootPending_) {
    // Return the HTTP acknowledgement before restarting from the main loop.
    if (millis() - rebootRequestedAt_ >= 500) ESP.restart();
    return;
  }
  saveServoPositionsIfDue();
}

void WebStatusServer::markServoPositionsChanged() {
  if (!filesystemReady_) {
    return;
  }
  servoPositionsDirty_ = true;
  servoPositionsChangedAt_ = millis();
}

void WebStatusServer::saveServoPositionsIfDue() {
  if (!filesystemReady_ || !servoPositionsDirty_) {
    return;
  }

  const unsigned long now = millis();
  if (now - servoPositionsChangedAt_ <
          kServoPositionSaveDelayMilliseconds ||
      now - servoPositionsLastSaveAttemptAt_ <
          kServoPositionSaveDelayMilliseconds) {
    return;
  }
  for (uint8_t index = 0; index < servoCount_; ++index) {
    if (!servos_[index].isReady() || servos_[index].isMotionRunning()) {
      return;
    }
  }

  uint8_t positions[kMaximumServoCount];
  for (uint8_t index = 0; index < servoCount_; ++index) {
    positions[index] = servos_[index].targetAngle();
  }
  servoPositionsLastSaveAttemptAt_ = now;
  if (saveServoPositions(positions, servoCount_)) {
    servoPositionsDirty_ = false;
    AppLog::println("Saved servo startup positions.");
  }
}

void WebStatusServer::sendLog() {
  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "text/plain; charset=utf-8", AppLog::snapshot());
}

void WebStatusServer::sendSequence() {
  const String robot = server_.hasArg("robot") ? server_.arg("robot") : RobotStorage::active();
  if ((robot.length() && !RobotStorage::validName(robot)) || !LittleFS.exists(RobotStorage::path("config.json", robot))) {
    server_.send(404, "text/plain", "Robot not found"); return;
  }
  const uint8_t storedServoCount = RobotStorage::servoCount(robot);
  const String slot = server_.uri().startsWith("/api/sequence/") ? server_.uri().substring(14) : (server_.hasArg("slot") ? server_.arg("slot") : String());
  if (server_.hasArg("slot") && (slot.length() != 1 || slot[0] < 'a' || slot[0] > 'j')) {
    server_.send(400, "text/plain; charset=utf-8", "Sequence slot must be a-j");
    return;
  }
  const String sequencePath = slot.length() ? RobotStorage::path(String("sequence_") + slot + ".json", robot) : RobotStorage::path("sequence.json", robot);
  if (!filesystemReady_) {
    server_.send(503, "text/plain; charset=utf-8",
                 "Sequence storage unavailable: LittleFS is not mounted");
    return;
  }

  const String readPath = slot == "a" && !LittleFS.exists(sequencePath)
      ? RobotStorage::path("sequence.json", robot) : sequencePath;
  File file = LittleFS.open(readPath, "r");
  if (!file) {
    server_.sendHeader("Cache-Control", "no-store");
    server_.send(200, "application/json; charset=utf-8",
                 "{\"loop\":false,\"steps\":[]}");
    return;
  }

  if (file.size() > kMaximumSequenceFileBytes) {
    file.close();
    AppLog::println("Stored sequence file exceeds the size limit.");
    server_.send(500, "text/plain; charset=utf-8",
                 "Stored sequence data is too large");
    return;
  }
  String sequence;
  sequence.reserve(file.size());
  while (file.available()) {
    sequence += static_cast<char>(file.read());
  }
  file.close();

  JsonDocument document;
  const DeserializationError error = deserializeJson(document, sequence);
  if (error || !document["loop"].is<bool>() ||
      (!document["finish"].isUnbound() && !document["finish"].is<bool>()) ||
      !document["steps"].is<JsonArrayConst>() ||
      document["steps"].as<JsonArrayConst>().size() >
          kMaximumSequenceSteps) {
    AppLog::printf("Stored sequence JSON is invalid%s%s.\n",
                   error ? ": " : "",
                   error ? error.c_str() : "");
    server_.send(500, "text/plain; charset=utf-8",
                 "Stored sequence data is invalid");
    return;
  }

  const JsonArrayConst steps = document["steps"].as<JsonArrayConst>();
  for (JsonObjectConst step : steps) {
    if (step["type"] == "delay") {
      if (!step["durationMs"].is<uint32_t>() ||
          step["durationMs"].as<uint32_t>() < 1 || step["durationMs"].as<uint32_t>() > 60000) {
        server_.send(400, "text/plain", "Delay must be between 1 and 60000 milliseconds");
        return;
      }
      continue;
    }
    if (step["type"] == "color") {
      if (!validRgb(step["rgb"]) || !step["durationMs"].is<uint32_t>() ||
          step["durationMs"].as<uint32_t>() < 100 || step["durationMs"].as<uint32_t>() > 60000) {
        server_.send(400, "text/plain", "Invalid RGB color step");
        return;
      }
      continue;
    }
    if (step["type"].is<const char*>() && String(step["type"].as<const char*>()) == "sequence") {
      const String target = step["slot"].is<const char*>() ? String(step["slot"].as<const char*>()) : String();
      if (target.length() != 1 || target[0] < 'a' || target[0] > 'j') {
        server_.send(400, "text/plain; charset=utf-8", "Sequence call target must be a-j");
        return;
      }
      continue;
    }
    const JsonArrayConst angles = step["angles"].as<JsonArrayConst>();
    const JsonArrayConst servoStates =
        step["servoStates"].as<JsonArrayConst>();
    const JsonVariantConst duration = step["durationMs"];
    const JsonVariantConst servoStatesValue = step["servoStates"];
    if (angles.isNull() || angles.size() != storedServoCount ||
        !duration.is<uint32_t>() ||
        duration.as<uint32_t>() < kMinimumStepDurationMilliseconds ||
        duration.as<uint32_t>() > kMaximumStepDurationMilliseconds ||
        (!servoStatesValue.isNull() &&
         (!servoStatesValue.is<JsonArrayConst>() ||
          servoStates.size() != storedServoCount))) {
      AppLog::println("Stored sequence contains an invalid step.");
      server_.send(500, "text/plain; charset=utf-8",
                   "Stored sequence data is invalid");
      return;
    }
    for (JsonVariantConst angle : angles) {
      if (!angle.is<int>() || angle.as<int>() < 0 ||
          angle.as<int>() > 180) {
        AppLog::println("Stored sequence contains an invalid servo angle.");
        server_.send(500, "text/plain; charset=utf-8",
                     "Stored sequence data is invalid");
        return;
      }
    }
    for (JsonVariantConst servoState : servoStates) {
      if (!servoState.is<int>() || servoState.as<int>() < 0 ||
          (servoState.as<int>() > 55 || (servoState.as<int>() & 24) == 24 || (servoState.as<int>() & 36) == 36)) {
        AppLog::println("Stored sequence contains invalid servo settings.");
        server_.send(500, "text/plain; charset=utf-8",
                     "Stored sequence data is invalid");
        return;
      }
    }
  }

  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "application/json; charset=utf-8", sequence);
}

void WebStatusServer::saveSequence() {
  const String robot = server_.hasArg("robot") ? server_.arg("robot") : RobotStorage::active();
  if ((robot.length() && !RobotStorage::validName(robot)) || !LittleFS.exists(RobotStorage::path("config.json", robot))) {
    server_.send(404, "text/plain", "Robot not found"); return;
  }
  const uint8_t storedServoCount = RobotStorage::servoCount(robot);
  const String slot = server_.uri().startsWith("/api/sequence/") ? server_.uri().substring(14) : (server_.hasArg("slot") ? server_.arg("slot") : String());
  if (server_.hasArg("slot") && (slot.length() != 1 || slot[0] < 'a' || slot[0] > 'j')) {
    server_.send(400, "text/plain; charset=utf-8", "Sequence slot must be a-j");
    return;
  }
  const String sequencePath = slot.length() ? RobotStorage::path(String("sequence_") + slot + ".json", robot) : RobotStorage::path("sequence.json", robot);
  if (rebootPending_) {
    server_.send(503, "text/plain; charset=utf-8", "Controller is rebooting");
    return;
  }
  if (!filesystemReady_) {
    server_.send(503, "text/plain; charset=utf-8",
                 "Sequence storage unavailable: LittleFS is not mounted");
    return;
  }

  const String requestBody = server_.arg("plain");
  if (requestBody.length() > kMaximumSequenceFileBytes) {
    server_.send(400, "text/plain; charset=utf-8",
                 "Sequence data exceeds the 8192-byte limit");
    return;
  }

  JsonDocument document;
  const DeserializationError error =
      deserializeJson(document, requestBody);
  if (error) {
    server_.send(400, "text/plain; charset=utf-8",
                 "Invalid sequence JSON");
    return;
  }

  const JsonVariantConst loop = document["loop"];
  const JsonArrayConst steps = document["steps"].as<JsonArrayConst>();
  if (!loop.is<bool>() || (!document["finish"].isUnbound() && !document["finish"].is<bool>()) || steps.isNull() ||
      steps.size() > kMaximumSequenceSteps ||
      measureJson(document) > kMaximumSequenceFileBytes) {
    server_.send(400, "text/plain; charset=utf-8",
                 "Sequence must contain a loop setting and no more than 32 steps");
    return;
  }

  for (JsonObjectConst step : steps) {
    if (step["type"] == "delay") {
      if (!step["durationMs"].is<uint32_t>() ||
          step["durationMs"].as<uint32_t>() < 1 || step["durationMs"].as<uint32_t>() > 60000) {
        server_.send(400, "text/plain", "Delay must be between 1 and 60000 milliseconds");
        return;
      }
      continue;
    }
    if (step["type"] == "color") {
      if (!validRgb(step["rgb"]) || !step["durationMs"].is<uint32_t>() ||
          step["durationMs"].as<uint32_t>() < 100 || step["durationMs"].as<uint32_t>() > 60000) {
        server_.send(400, "text/plain", "Invalid RGB color step");
        return;
      }
      continue;
    }
    if (step["type"].is<const char*>() && String(step["type"].as<const char*>()) == "sequence") {
      const String target = step["slot"].is<const char*>() ? String(step["slot"].as<const char*>()) : String();
      if (target.length() != 1 || target[0] < 'a' || target[0] > 'j') {
        server_.send(400, "text/plain; charset=utf-8", "Sequence call target must be a-j");
        return;
      }
      continue;
    }
    const JsonArrayConst angles = step["angles"].as<JsonArrayConst>();
    const JsonArrayConst servoStates =
        step["servoStates"].as<JsonArrayConst>();
    const JsonVariantConst duration = step["durationMs"];
    const JsonVariantConst servoStatesValue = step["servoStates"];
    if (angles.isNull() || angles.size() != storedServoCount ||
        !duration.is<uint32_t>() ||
        (!servoStatesValue.isNull() &&
         (!servoStatesValue.is<JsonArrayConst>() ||
          servoStates.size() != storedServoCount))) {
      server_.send(400, "text/plain; charset=utf-8",
                   "Each step must contain one angle per servo and a duration");
      return;
    }

    const uint32_t durationMilliseconds = duration.as<uint32_t>();
    if (durationMilliseconds < kMinimumStepDurationMilliseconds ||
        durationMilliseconds > kMaximumStepDurationMilliseconds) {
      server_.send(400, "text/plain; charset=utf-8",
                   "Step duration must be between 100 and 60000 milliseconds");
      return;
    }
    for (JsonVariantConst angle : angles) {
      if (!angle.is<int>() || angle.as<int>() < 0 ||
          angle.as<int>() > 180) {
        server_.send(400, "text/plain; charset=utf-8",
                     "Step angles must be integers from 0 to 180");
        return;
      }
    }
    for (JsonVariantConst servoState : servoStates) {
      if (!servoState.is<int>() || servoState.as<int>() < 0 ||
          (servoState.as<int>() > 55 || (servoState.as<int>() & 24) == 24 || (servoState.as<int>() & 36) == 36)) {
        server_.send(400, "text/plain; charset=utf-8",
                     "Servo settings contain an invalid mute, solo, mode, or speed value");
        return;
      }
    }
  }

  File file = LittleFS.open(sequencePath + ".tmp", "w");
  if (!file) {
    AppLog::println("Could not open temporary sequence file for writing.");
    server_.send(500, "text/plain; charset=utf-8",
                 "Could not open sequence storage");
    return;
  }
  const size_t bytesWritten = serializeJson(document, file);
  file.close();
  if (bytesWritten != measureJson(document) ||
      !LittleFS.rename(sequencePath + ".tmp", sequencePath)) {
    AppLog::println("Could not save sequence file.");
    server_.send(500, "text/plain; charset=utf-8",
                 "Could not save sequence storage");
    return;
  }

  AppLog::printf("Saved %u sequencer step(s).\n",
                 static_cast<unsigned>(steps.size()));
  server_.send(200, "text/plain; charset=utf-8", "Sequence saved");
}

void WebStatusServer::saveServoConfiguration() {
  const String robot = server_.hasArg("robot") ? server_.arg("robot") : RobotStorage::active();
  if (robot.length() && !RobotStorage::validName(robot)) { server_.send(400, "text/plain", "Invalid robot name"); return; }
  if (rebootPending_) {
    server_.send(503, "text/plain; charset=utf-8", "Controller is rebooting");
    return;
  }
  auto fail = [this](int code, const char* message) { server_.send(code, "text/plain; charset=utf-8", message); };
  if (!filesystemReady_) { fail(503, "Config storage unavailable"); return; }
  const String body = server_.arg("plain");
  if (body.length() > 4096) { fail(413, "Servo settings too large"); return; }
  JsonDocument request;
  if (deserializeJson(request, body)) { fail(400, "Invalid settings JSON"); return; }
  if (!request["camera"].isUnbound() && !validCameraSettings(request["camera"])) { fail(400, "Invalid camera settings"); return; }
  const char* originalName = request["originalName"] | "";
  const JsonObjectConst update = request["servo"].as<JsonObjectConst>();
  if (!originalName[0] || update.isNull()) { fail(400, "Missing servo settings"); return; }
  File file = LittleFS.open(RobotStorage::path("config.json", robot), "r");
  if (!file || file.size() > 24576) { if (file) file.close(); fail(500, "Could not read config"); return; }
  JsonDocument config;
  const auto error = deserializeJson(config, file); file.close();
  JsonArray entries = config["components"].as<JsonArray>();
  if (error || entries.isNull() || entries.size() > 60) { fail(500, "Invalid stored config"); return; }
  JsonObject target;
  for (JsonObject entry : entries) {
    if (String(entry["name"] | "") == originalName && String(entry["objectType"] | "Servo") == "Servo") { target = entry; break; }
  }
  if (target.isNull()) { fail(409, "Servo not found; reload the page"); return; }
  // Keep unknown metadata and other components; only settings exposed by the form change.
  for (const char* key : {"name", "type", "address", "channel", "startupAngle", "minPulseMicroseconds", "maxPulseMicroseconds",
                         "minAngle", "maxAngle", "initialMotionMode", "enabled", "reversed", "continuous", "model", "parent", "position", "rotation", "minPowerWatts", "maxPowerWatts", "powerVoltageVolts", "idleCurrentAmps", "runningCurrentAmps", "peakCurrentAmps"}) {
    if (!update[key].isNull() || String(key) == "parent" ||
        ((!update[key].isUnbound()) && (String(key) == "minPowerWatts" || String(key) == "maxPowerWatts" || String(key) == "powerVoltageVolts" || String(key) == "idleCurrentAmps" || String(key) == "runningCurrentAmps" || String(key) == "peakCurrentAmps"))) target[key].set(update[key]);
  }
  if (!validPowerRange(target)) { fail(400, "Invalid power range in watts"); return; }
  const char* newName = target["name"] | "";
  if (!newName[0] || strlen(newName) > 31) { fail(400, "Servo name must contain 1-31 bytes"); return; }
  for (JsonObject entry : entries) {
    if (String(entry["parent"] | "") == originalName) entry["parent"] = newName;
  }
  uint8_t servoCount = 0;
  for (size_t index = 0; index < entries.size(); ++index) {
    JsonObjectConst entry = entries[index];
    const char* name = entry["name"] | "";
    if (!name[0]) { fail(400, "Each component needs a name"); return; }
    for (size_t previous = 0; previous < index; ++previous) {
      if (String(entries[previous]["name"] | "") == name) { fail(400, "Component names must be unique"); return; }
    }
    const char* type = entry["objectType"] | "Servo";
    if (String(type) == "Servo") {
      ++servoCount;
      const char* addressText = entry["address"] | "";
      char* end = nullptr;
      const unsigned long address = strtoul(addressText, &end, 0);
      if (!addressText[0] || *end || address < 0x40 || address > 0x77 ||
          !entry["channel"].is<int>() || entry["channel"].as<int>() < 0 || entry["channel"].as<int>() > 15 ||
          !entry["startupAngle"].is<int>() || entry["startupAngle"].as<int>() < 0 || entry["startupAngle"].as<int>() > 180 ||
          !entry["minPulseMicroseconds"].is<int>() || !entry["maxPulseMicroseconds"].is<int>() ||
          entry["minPulseMicroseconds"].as<int>() < 500 || entry["maxPulseMicroseconds"].as<int>() > 2500 ||
          entry["minPulseMicroseconds"].as<int>() >= entry["maxPulseMicroseconds"].as<int>()) {
        fail(400, "Invalid servo channel, address, startup angle or pulse range"); return;
      }
      for (size_t previous = 0; previous < index; ++previous) {
        JsonObjectConst other = entries[previous];
        if (String(other["objectType"] | "Servo") == "Servo" &&
            strtoul(other["address"] | "", nullptr, 0) == address && other["channel"].as<int>() == entry["channel"].as<int>()) {
          fail(400, "PCA9685 address/channel is already assigned to another servo"); return;
        }
      }
    } else if (!supportedComponentType(type)) {
      fail(400, "Unknown component type"); return;
    }
    String parent = entry["parent"] | "";
    for (size_t hop = 0; parent.length(); ++hop) {
      if (hop >= entries.size() || parent == name) { fail(400, "Component parents must not form cycles"); return; }
      bool found = false;
      for (JsonObjectConst ancestor : entries) {
        if (String(ancestor["name"] | "") == parent) { parent = ancestor["parent"] | ""; found = true; break; }
      }
      if (!found) { fail(400, "Parent component not found"); return; }
    }
  }
  if (servoCount > kMaximumServoCount) { fail(400, "Expected 0-20 servos"); return; }
  for (const char* field : {"position", "rotation"}) {
    for (const char* axis : {"x", "y", "z"}) {
      const JsonVariantConst value = target[field][axis];
      if (!value.is<double>() || !isfinite(value.as<double>())) { fail(400, "Transforms require finite x, y and z"); return; }
    }
  }
  const String model = target["model"] | "standard";
  const String mode = target["initialMotionMode"] | "immediate";
  if (!supportedComponentModel("Servo", model) || (mode != "smooth" && mode != "immediate" && mode != "linear") ||
      !target["enabled"].is<bool>() || !target["reversed"].is<bool>() ||
      (!target["continuous"].isNull() && !target["continuous"].is<bool>()) ||
      !target["minAngle"].is<int>() || !target["maxAngle"].is<double>() ||
      target["minAngle"].as<int>() < 0 || !isfinite(target["maxAngle"].as<double>()) ||
      target["minAngle"].as<double>() > target["maxAngle"].as<double>()) {
    fail(400, "Invalid servo model, mode, flags or angle limits"); return;
  }
  if (!request["camera"].isUnbound()) config["camera"].set(request["camera"]);
  const size_t expected = measureJson(config);
  if (expected > 24576) { fail(413, "Config too large"); return; }
  File output = LittleFS.open(RobotStorage::path("config.json.tmp", robot), "w");
  if (!output) { fail(500, "Could not open config storage"); return; }
  const size_t written = serializeJson(config, output); output.close();
  if (written != expected || !LittleFS.rename(RobotStorage::path("config.json.tmp", robot), RobotStorage::path("config.json", robot))) {
    LittleFS.remove(RobotStorage::path("config.json.tmp", robot)); fail(500, "Could not save config"); return;
  }
  server_.send(200, "text/plain; charset=utf-8", "Config saved; restart controller to apply");
}

void WebStatusServer::savePreviewConfiguration() {
  if (rebootPending_) {
    server_.send(503, "text/plain; charset=utf-8", "Controller is rebooting");
    return;
  }
  if (!filesystemReady_) {
    server_.send(503, "text/plain; charset=utf-8", "Config storage unavailable");
    return;
  }
  constexpr size_t kMaximumConfigBytes = 24576;
  const String body = server_.arg("plain");
  if (body.length() > kMaximumConfigBytes) {
    server_.send(413, "text/plain; charset=utf-8", "Config request too large");
    return;
  }
  JsonDocument patch;
  if (deserializeJson(patch, body)) {
    server_.send(400, "text/plain; charset=utf-8", "Invalid config JSON");
    return;
  }
  const JsonArrayConst updates = patch["components"].as<JsonArrayConst>();
  if (updates.isNull() || updates.size() == 0 || updates.size() > 60) {
    server_.send(400, "text/plain; charset=utf-8", "Expected placements for 1-60 components");
    return;
  }
  const String robot = patch["robot"].is<const char*>() ? patch["robot"].as<String>() : RobotStorage::active();
  if (robot.length() && !RobotStorage::validName(robot)) { server_.send(400, "text/plain", "Invalid robot name"); return; }
  const String configPath = RobotStorage::path("config.json", robot);
  const bool exists = LittleFS.exists(configPath);
  const bool creating = !exists && patch["originalNames"].isNull();
  JsonDocument config;
  if (creating) {
    if (!patch["configuration"].is<JsonObjectConst>()) { server_.send(400, "text/plain", "Missing robot config"); return; }
    config.set(patch["configuration"]);
    config["components"].to<JsonArray>();
  } else {
    File source = LittleFS.open(configPath, "r");
    if (!source || source.size() > kMaximumConfigBytes || deserializeJson(config, source)) {
      server_.send(409, "text/plain", "Could not read robot config"); return;
    }
    source.close();
  }
  JsonArray entries = config["components"].as<JsonArray>();
  auto fail = [this](int code, const char* message) { server_.send(code, "text/plain; charset=utf-8", message); };
  const JsonArrayConst originalNames = patch["originalNames"].as<JsonArrayConst>();
  if (entries.isNull() || (!creating && (originalNames.isNull() || originalNames.size() != entries.size()))) {
    fail(409, "Config changed; reload the page"); return;
  }
  for (size_t index = 0; index < entries.size(); ++index) {
    if (String(originalNames[index] | "") != String(entries[index]["name"] | "")) {
      fail(409, "Config changed; reload the page"); return;
    }
  }
  JsonDocument rebuilt;
  JsonArray newEntries = rebuilt.to<JsonArray>();
  for (JsonObjectConst update : updates) {
    const String name = update["originalName"].isUnbound() ? String(update["name"] | "") : String(update["originalName"] | "");
    for (size_t previous = 0; previous < newEntries.size(); ++previous) {
      const JsonObjectConst other = updates[previous];
      const String previousName = other["originalName"].isUnbound() ? String(other["name"] | "") : String(other["originalName"] | "");
      if (name.length() && previousName == name) { fail(400, "Duplicate component identity"); return; }
    }
    JsonObject added = newEntries.add<JsonObject>();
    for (JsonObjectConst stored : entries) {
      if (name.length() && String(stored["name"] | "") == name) { added.set(stored); break; }
    }
    if (!update["originalName"].isUnbound() && !update["originalName"].isNull() && added["name"].isNull()) {
      fail(409, "Component changed; reload the page"); return;
    }
  }
  if (!patch["camera"].isUnbound()) {
    if (!validCameraSettings(patch["camera"])) { fail(400, "Invalid camera settings"); return; }
    config["camera"].set(patch["camera"]);
  }
  config["components"].set(newEntries);
  entries = config["components"].as<JsonArray>();
  // Save the servo settings included in the robot snapshot as well as placement.

  for (size_t index = 0; index < updates.size(); ++index) {
    const JsonObjectConst update = updates[index].as<JsonObjectConst>();
    const char* name = update["name"] | "";
    if (entries[index]["name"].isNull()) {
      const String type = update["objectType"] | "";
      if (!supportedComponentType(type)) {
        fail(400, "Unknown component type"); return;
      }
      JsonObject added = entries[index].as<JsonObject>();
      added.set(update);
      added.remove("originalName");
      if (type == "Servo") {
        const String model = added["model"] | "";
        if (!supportedComponentModel("Servo", model) ||
            !added["minAngle"].is<int>() || added["minAngle"].as<int>() < 0 ||
            !added["maxAngle"].is<int>() || added["maxAngle"].as<int>() > 180 ||
            added["minAngle"].as<int>() > added["maxAngle"].as<int>() ||
            (String(added["initialMotionMode"] | "") != "immediate" && String(added["initialMotionMode"] | "") != "smooth" && String(added["initialMotionMode"] | "") != "linear") ||
            !added["reversed"].is<bool>() || !added["continuous"].is<bool>()) {
          fail(400, "Invalid new servo settings"); return;
        }
      }
    }
    const size_t maximumNameBytes = String(entries[index]["objectType"] | "Servo") == "Servo" ? 31 : 63;
    if (!name[0] || strlen(name) > maximumNameBytes) {
      fail(400, "Component name exceeds its byte limit (31 for servos, 63 for other components)"); return;
    }
    if (!update["constraints"].isUnbound()) {
      if (String(entries[index]["objectType"] | "Servo") != "Null" || !validNullConstraints(update["constraints"])) {
        fail(400, "Invalid Null axis constraints"); return;
      }
      entries[index]["constraints"].set(update["constraints"]);
    }
    if (!update["rotationConstraints"].isUnbound()) {
      if (String(entries[index]["objectType"] | "Servo") != "Null" || !update["rotationConstraints"].is<JsonObjectConst>()) {
        fail(400, "Invalid Null rotation constraints"); return;
      }
      for (JsonPairConst entry : update["rotationConstraints"].as<JsonObjectConst>()) {
        const String axis = entry.key().c_str();
        if ((axis != "x" && axis != "y" && axis != "z") || !entry.value().is<bool>()) { fail(400, "Invalid Null rotation constraints"); return; }
      }
      entries[index]["rotationConstraints"].set(update["rotationConstraints"]);
    }
    if (String(entries[index]["objectType"] | "Servo") == "Servo") {
      for (const char* key : {"type", "address", "channel", "startupAngle", "minPulseMicroseconds", "maxPulseMicroseconds",
                             "minAngle", "maxAngle", "initialMotionMode", "enabled", "reversed", "continuous", "model"}) {
        if (!update[key].isUnbound()) entries[index][key].set(update[key]);
      }
      JsonObjectConst servo = entries[index];
      const String model = servo["model"] | "standard";
      const String motion = servo["initialMotionMode"] | "immediate";
      if (!supportedComponentModel("Servo", model) || (motion != "immediate" && motion != "smooth" && motion != "linear") ||
          !servo["enabled"].is<bool>() || !servo["reversed"].is<bool>() || !servo["continuous"].is<bool>() ||
          !servo["minAngle"].is<int>() || servo["minAngle"].as<int>() < 0 ||
          !servo["maxAngle"].is<int>() || servo["maxAngle"].as<int>() > 180 ||
          servo["minAngle"].as<int>() > servo["maxAngle"].as<int>()) {
        fail(400, "Invalid servo settings"); return;
      }
    }
    for (const char* key : {"minPowerWatts", "maxPowerWatts", "powerVoltageVolts", "idleCurrentAmps", "runningCurrentAmps", "peakCurrentAmps"}) {
      if (!update[key].isUnbound()) entries[index][key].set(update[key]);
    }
    if (!updateComponentNumericSettings(entries[index].as<JsonObject>(), update)) { fail(400, "Invalid component numeric settings"); return; }
    if (!validPowerRange(entries[index])) { fail(400, "Invalid power range in watts"); return; }
    const JsonVariantConst mass = update["massGrams"];
    if (!mass.isUnbound() && !mass.isNull()) {
      if (!mass.is<double>() || !isfinite(mass.as<double>()) || mass.as<double>() <= 0) {
        fail(400, "Mass must be a positive number in grams"); return;
      }
      entries[index]["massGrams"] = mass.as<double>();
    } else entries[index].remove("massGrams");
    entries[index]["name"] = name;
    if (!update["parent"].isUnbound()) {
      if (!update["parent"].isNull() && !update["parent"].is<const char*>()) {
        fail(400, "Parent must be a component name or null"); return;
      }
      entries[index]["parent"].set(update["parent"]);
    }
    for (const char* field : {"position", "rotation"}) {
      const JsonObjectConst vector = update[field].as<JsonObjectConst>();
      for (const char* axis : {"x", "y", "z"}) {
        const JsonVariantConst value = vector[axis];
        if (!value.is<double>() || !isfinite(value.as<double>())) {
          server_.send(400, "text/plain; charset=utf-8", "Transforms require finite x, y and z numbers");
          return;
        }
        config["components"][index][field][axis] = value.as<double>();
      }
    }
  }
  uint8_t servoCount = 0;
  for (size_t index = 0; index < entries.size(); ++index) {
    JsonObjectConst entry = entries[index];
    const char* name = entry["name"] | "";
    if (!name[0]) { fail(400, "Each component needs a name"); return; }
    for (size_t previous = 0; previous < index; ++previous) {
      if (String(entries[previous]["name"] | "") == name) { fail(400, "Component names must be unique"); return; }
    }
    const char* type = entry["objectType"] | "Servo";
    if (String(type) == "Servo") {
      ++servoCount;
      const char* addressText = entry["address"] | "";
      char* end = nullptr;
      const unsigned long address = strtoul(addressText, &end, 0);
      if (!addressText[0] || *end || address < 0x40 || address > 0x77 ||
          !entry["channel"].is<int>() || entry["channel"].as<int>() < 0 || entry["channel"].as<int>() > 15 ||
          !entry["startupAngle"].is<int>() || entry["startupAngle"].as<int>() < 0 || entry["startupAngle"].as<int>() > 180 ||
          !entry["minPulseMicroseconds"].is<int>() || !entry["maxPulseMicroseconds"].is<int>() ||
          entry["minPulseMicroseconds"].as<int>() < 500 || entry["maxPulseMicroseconds"].as<int>() > 2500 ||
          entry["minPulseMicroseconds"].as<int>() >= entry["maxPulseMicroseconds"].as<int>()) {
        fail(400, "Invalid servo channel, address, startup angle or pulse range"); return;
      }
      for (size_t previous = 0; previous < index; ++previous) {
        JsonObjectConst other = entries[previous];
        if (String(other["objectType"] | "Servo") == "Servo" &&
            strtoul(other["address"] | "", nullptr, 0) == address && other["channel"].as<int>() == entry["channel"].as<int>()) {
          fail(400, "PCA9685 address/channel is already assigned to another servo"); return;
        }
      }
    } else if (!supportedComponentType(type)) {
      fail(400, "Unknown component type"); return;
    }
    String parent = entry["parent"] | "";
    for (size_t hop = 0; parent.length(); ++hop) {
      if (hop >= entries.size() || parent == name) { fail(400, "Component parents must not form cycles"); return; }
      bool found = false;
      for (JsonObjectConst ancestor : entries) {
        if (String(ancestor["name"] | "") == parent) { parent = ancestor["parent"] | ""; found = true; break; }
      }
      if (!found) { fail(400, "Parent component not found"); return; }
    }
  }
  if (servoCount > kMaximumServoCount) { fail(400, "Expected 0-20 servos"); return; }
  const size_t expected = measureJson(config);
  if (expected > kMaximumConfigBytes) {
    server_.send(413, "text/plain; charset=utf-8", "Updated config too large");
    return;
  }
  if (robot.length()) {
    const String directory = String("/robots/") + robot;
    if ((!LittleFS.exists("/robots") && !LittleFS.mkdir("/robots")) ||
        (!LittleFS.exists(directory) && !LittleFS.mkdir(directory))) {
      fail(500, "Could not create robot folder; check filesystem free space"); return;
    }
  }
  File target = LittleFS.open(configPath + ".tmp", "w");
  if (!target) {
    server_.send(500, "text/plain; charset=utf-8", "Could not open config storage");
    return;
  }
  const size_t written = serializeJson(config, target);
  target.close();
  if (written != expected || !LittleFS.rename(configPath + ".tmp", configPath)) {
    LittleFS.remove(configPath + ".tmp");
    server_.send(500, "text/plain; charset=utf-8", "Could not save config");
    return;
  }
  if (robot.length() && !RobotStorage::select(robot)) { fail(500, "Config saved but robot selection failed"); return; }
  if (robot.length() && RobotStorage::active() != robot) {
    fail(500, "Config saved but active robot was not persisted"); return;
  }
  if (runtimeRobot_ != RobotStorage::active()) {
    for (uint8_t i = 0; i < servoCount_; ++i) servos_[i].setOutputEnabled(false);
  }
  server_.send(200, "text/plain; charset=utf-8", "Robot saved");
}

void WebStatusServer::setServoBatch() {
  auto fail = [this](int code, const char* message) { server_.send(code, "text/plain", message); };
  if (rebootPending_ || runtimeRobot_ != RobotStorage::active()) {
    fail(409, "Controller requires restart before servo commands"); return;
  }
  if (server_.arg("plain").length() > 8192) { fail(413, "Batch too large"); return; }
  JsonDocument document;
  if (deserializeJson(document, server_.arg("plain"))) { fail(400, "Invalid batch JSON"); return; }
  const JsonArrayConst commands = document["commands"].as<JsonArrayConst>();
  if (commands.isNull() || commands.size() == 0 || commands.size() > servoCount_) { fail(400, "Invalid servo batch size"); return; }
  struct Command {
    uint8_t channel;
    bool hasAngle, enabled, smooth, linear;
    uint8_t angle;
    ServoMotionSpeed speed;
    float rate;
    uint32_t duration;
  };
  Command prepared[kMaximumServoCount];
  bool seen[kMaximumServoCount] = {};
  size_t count = 0;
  // Validate the entire step before starting any output.
  for (JsonObjectConst entry : commands) {
    if (!entry["channel"].is<int>() || entry["channel"].as<int>() < 1 || entry["channel"].as<int>() > servoCount_ || !entry["enabled"].is<bool>()) {
      fail(400, "Invalid servo batch channel or enabled state"); return;
    }
    const uint8_t index = entry["channel"].as<int>() - 1;
    if (seen[index]) { fail(400, "Duplicate batch channel"); return; }
    if (!servos_[index].isReady()) { fail(503, "Servo channel unavailable"); return; }
    seen[index] = true;
    const bool hasAngle = !entry["angle"].isUnbound();
    if (hasAngle && (!entry["angle"].is<int>() || entry["angle"].as<int>() < 0 || entry["angle"].as<int>() > 180)) {
      fail(400, "Invalid batch angle"); return;
    }
    const String mode = entry["motionMode"] | "immediate";
    const String speed = entry["speed"] | "M";
    if ((mode != "immediate" && mode != "smooth" && mode != "linear") || (speed != "L" && speed != "M" && speed != "H") ||
        !entry["playbackRate"].is<float>() || !isfinite(entry["playbackRate"].as<float>()) || entry["playbackRate"].as<float>() < 0.001f || entry["playbackRate"].as<float>() > 10.0f) {
      fail(400, "Invalid batch motion mode, speed or playback rate"); return;
    }
    if (!entry["durationMs"].isUnbound() && (mode != "linear" || !entry["durationMs"].is<uint32_t>() ||
        entry["durationMs"].as<uint32_t>() < kMinimumStepDurationMilliseconds || entry["durationMs"].as<uint32_t>() > kMaximumStepDurationMilliseconds)) {
      fail(400, "Invalid linear step duration"); return;
    }
    prepared[count++] = { index, hasAngle, entry["enabled"].as<bool>(), mode == "smooth", mode == "linear",
      static_cast<uint8_t>(entry["angle"] | 0), speed == "L" ? ServoMotionSpeed::Low : speed == "M" ? ServoMotionSpeed::Medium : ServoMotionSpeed::High,
      entry["playbackRate"].as<float>(), entry["durationMs"] | static_cast<uint32_t>(0) };
  }
  for (size_t i = 0; i < count; ++i) {
    const Command& command = prepared[i];
    Pca9685ServoTest& servo = servos_[command.channel];
    if (!servo.setEnabled(command.enabled) || (command.hasAngle && command.enabled && servo.isOutputEnabled() &&
        !servo.setTargetAngle(command.angle, command.smooth, command.speed, command.rate, command.linear, command.duration))) {
      // If hardware fails part-way through a batch, stop all participating outputs.
      for (size_t j = 0; j < count; ++j) servos_[prepared[j].channel].setOutputEnabled(false);
      fail(500, "PCA9685 rejected batch; participating outputs switched off"); return;
    }
  }
  server_.send(200, "text/plain", "Servo step started");
}

void WebStatusServer::setServoAngle() {
  if (runtimeRobot_ != RobotStorage::active()) { server_.send(409, "text/plain", "Robot changed; restart the controller before commanding servos"); return; }
  if (rebootPending_) {
    server_.send(503, "text/plain; charset=utf-8", "Controller is rebooting");
    return;
  }
  if (!server_.hasArg("channel")) {
    server_.send(400, "text/plain; charset=utf-8", "Missing channel parameter");
    return;
  }
  const String channelValue = server_.arg("channel");
  if (channelValue.length() == 0 || channelValue.length() > 2) {
    server_.send(400, "text/plain; charset=utf-8",
                 "Channel must be an integer from 1 to 20");
    return;
  }
  for (size_t index = 0; index < channelValue.length(); ++index) {
    if (channelValue[index] < '0' || channelValue[index] > '9') {
      server_.send(400, "text/plain; charset=utf-8",
                   "Channel must be an integer from 1 to 20");
      return;
    }
  }
  const long channel = channelValue.toInt();
  if (channel < 1 || channel > servoCount_) {
    server_.send(400, "text/plain; charset=utf-8",
                 "Channel is not configured");
    return;
  }
  const uint8_t channelIndex = static_cast<uint8_t>(channel - 1);
  Pca9685ServoTest* servo = &servos_[channelIndex];
  if (servo == nullptr || !servo->isReady()) {
    server_.send(503, "text/plain; charset=utf-8",
                 "PCA9685 servo channel is unavailable");
    return;
  }
  const bool hasAngle = server_.hasArg("angle");
  const bool hasEnabled = server_.hasArg("enabled");
  const bool hasOutputEnabled = server_.hasArg("outputEnabled");
  const bool hasSmooth = server_.hasArg("smooth");
  const bool hasSpeed = server_.hasArg("speed");
  if (!hasAngle && !hasEnabled && !hasOutputEnabled) {
    server_.send(400, "text/plain; charset=utf-8",
                 "Provide an angle, enabled, or outputEnabled parameter");
    return;
  }

  long angle = 0;
  if (hasAngle) {
    const String value = server_.arg("angle");
    if (value.length() == 0 || value.length() > 3) {
      server_.send(400, "text/plain; charset=utf-8",
                   "Angle must be an integer from 0 to 180");
      return;
    }
    for (size_t index = 0; index < value.length(); ++index) {
      if (value[index] < '0' || value[index] > '9') {
        server_.send(400, "text/plain; charset=utf-8",
                     "Angle must be an integer from 0 to 180");
        return;
      }
    }

    angle = value.toInt();
    if (angle > 180) {
      server_.send(400, "text/plain; charset=utf-8",
                   "Angle must be an integer from 0 to 180");
      return;
    }
  }

  bool outputEnabled = servo->isOutputEnabled();
  if (hasOutputEnabled) {
    const String value = server_.arg("outputEnabled");
    if (value != "0" && value != "1") {
      server_.send(400, "text/plain; charset=utf-8", "OutputEnabled must be 0 or 1");
      return;
    }
    outputEnabled = value == "1";
  }
  bool enabled = servo->isEnabled();
  if (hasEnabled) {
    const String enabledValue = server_.arg("enabled");
    if (enabledValue != "0" && enabledValue != "1") {
      server_.send(400, "text/plain; charset=utf-8",
                   "Enabled must be 0 or 1");
      return;
    }
    enabled = enabledValue == "1";
  }

  bool smooth = false;
  if (hasSmooth) {
    const String smoothValue = server_.arg("smooth");
    if (smoothValue != "0" && smoothValue != "1") {
      server_.send(400, "text/plain; charset=utf-8",
                   "Smooth must be 0 or 1");
      return;
    }
    smooth = smoothValue == "1";
  }

  bool linear = false;
  if (server_.hasArg("motionMode")) {
    const String mode = server_.arg("motionMode");
    if (mode != "immediate" && mode != "smooth" && mode != "linear") {
      server_.send(400, "text/plain", "Motion mode must be immediate, smooth or linear"); return;
    }
    smooth = mode == "smooth";
    linear = mode == "linear";
  }

  float playbackRate = 1.0f;
  if (server_.hasArg("playbackRate")) {
    const String value = server_.arg("playbackRate");
    char* end = nullptr;
    playbackRate = strtof(value.c_str(), &end);
    if (end == value.c_str() || *end != '\0' ||
        !(playbackRate >= 0.001f && playbackRate <= 10.0f)) {
      server_.send(400, "text/plain; charset=utf-8",
                   "Playback rate must be between 0.001 and 10");
      return;
    }
  }

  ServoMotionSpeed speed = ServoMotionSpeed::High;
  if (hasSpeed) {
    const String speedValue = server_.arg("speed");
    if (speedValue == "L") {
      speed = ServoMotionSpeed::Low;
    } else if (speedValue == "M") {
      speed = ServoMotionSpeed::Medium;
    } else if (speedValue != "H") {
      server_.send(400, "text/plain; charset=utf-8",
                   "Speed must be L, M, or H");
      return;
    }
  }

  if ((hasOutputEnabled && !servo->setOutputEnabled(outputEnabled)) ||
      (hasEnabled && !servo->setEnabled(enabled)) ||
      (hasAngle &&
       !servo->setTargetAngle(static_cast<uint8_t>(angle), smooth, speed,
                             playbackRate, linear))) {
    server_.send(500, "text/plain; charset=utf-8",
                 "PCA9685 rejected the servo command");
    return;
  }
  if (hasAngle) {
    markServoPositionsChanged();
  }

  String result = configurations_[channelIndex].name;
  if (hasAngle) {
    result += " commanded to " + String(angle) + " degrees";
  }
  if (hasEnabled) {
    result += enabled ? " enabled" : " muted";
  }
  server_.send(200, "text/plain; charset=utf-8", result);
}

void WebStatusServer::sendStatus() {
  const bool connected = WiFi.status() == WL_CONNECTED;
  const IPAddress ipAddress = connected ? WiFi.localIP() : IPAddress(0, 0, 0, 0);
  const String ssid = connected ? WiFi.SSID() : String();
  const String ip = ipAddress.toString();
  const String mac = WiFi.macAddress();
  const String sdkVersion = ESP.getSdkVersion();
  const String coreVersion = DevicePlatform::coreVersion();
  const String resetReason = DevicePlatform::resetReason();

  String json;
  json.reserve(1800);
  json += F("{\"device\":{\"chipId\":\"0x");
  json += String(DevicePlatform::chipId(), HEX);
  json += F("\",\"cpuMHz\":");
  json += String(ESP.getCpuFreqMHz());
  json += F(",\"sdk\":");
  appendJsonString(json, sdkVersion);
  json += F(",\"core\":");
  appendJsonString(json, coreVersion);
  json += F(",\"resetReason\":");
  appendJsonString(json, resetReason);
  json += F(",\"uptimeSeconds\":");
  json += String(millis() / 1000);
  json += F(",\"freeHeap\":");
  json += String(ESP.getFreeHeap());
  json += F(",\"largestFreeBlock\":");
  json += String(DevicePlatform::largestFreeBlock());
  json += F(",\"heapFragmentation\":");
  json += String(DevicePlatform::heapFragmentation());
  json += F(",\"flashSize\":");
  json += String(ESP.getFlashChipSize());
  json += F(",\"sketchSize\":");
  json += String(ESP.getSketchSize());
  json += F(",\"freeOtaSpace\":");
  json += String(ESP.getFreeSketchSpace());
  json += F("},\"wifi\":{\"connected\":");
  json += connected ? F("true") : F("false");
  json += F(",\"ssid\":");
  appendJsonString(json, ssid);
  json += F(",\"ip\":");
  appendJsonString(json, ip);
  json += F(",\"rssi\":");
  json += String(connected ? WiFi.RSSI() : 0);
  json += F(",\"mac\":");
  appendJsonString(json, mac);
  json += F("},\"led\":{\"rgb\":[");
  json += String(boardRgbLed.red()); json += ',';
  json += String(boardRgbLed.green()); json += ',';
  json += String(boardRgbLed.blue());
  json += F("]},\"sensors\":");
  JsonDocument sensors;
  distanceSensor.appendStatus(sensors["vl53l0x"].to<JsonObject>());
  // ArduinoJson 7 clears String destinations; preserve the status prefix.
  String sensorJson;
  serializeJson(sensors, sensorJson);
  json += sensorJson;
  json += F(",\"servos\":[");
  for (uint8_t index = 0; index < servoCount_; ++index) {
    Pca9685ServoTest* servo = &servos_[index];
    if (index > 0) {
      json += ',';
    }
    json += F("{\"id\":");
    json += String(index + 1);
    json += F(",\"name\":");
    appendJsonString(json, configurations_[index].name);
    json += F(",\"address\":");
    json += String(configurations_[index].address);
    json += F(",\"channel\":");
    json += String(configurations_[index].channel);
    json += F(",\"ready\":");
    json += servo->isReady() ? F("true") : F("false");
    json += F(",\"continuous\":");
    json += configurations_[index].continuous ? F("true") : F("false");
    json += F(",\"minAngle\":");
    json += String(configurations_[index].minimumAngle);
    json += F(",\"maxAngle\":");
    json += String(configurations_[index].maximumAngle);
    json += F(",\"angleDegrees\":");
    json += String(servo->angle());
    json += F(",\"pulseMicroseconds\":");
    json += String(servo->pulseMicroseconds());
    json += F(",\"enabled\":");
    json += servo->isEnabled() ? F("true") : F("false");
    json += F(",\"outputEnabled\":");
    json += servo->isOutputEnabled() ? F("true") : F("false");
    json += '}';
  }
  json += F("]}");

  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "application/json; charset=utf-8", json);
}
