#include "WebStatusServer.h"

#include "AppLog.h"

#include <ESP8266WiFi.h>
#include <LittleFS.h>

namespace {
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
  server_.on("/", HTTP_GET, [this]() {
    sendAsset("/index.html", "text/html; charset=utf-8");
  });
  server_.on("/style.css", HTTP_GET, [this]() {
    sendAsset("/style.css", "text/css; charset=utf-8");
  });
  server_.on("/app.js", HTTP_GET, [this]() {
    sendAsset("/app.js", "application/javascript; charset=utf-8");
  });
  server_.on("/config.json", HTTP_GET, [this]() {
    sendAsset("/config.json", "application/json; charset=utf-8");
  });
  server_.on("/api/status", HTTP_GET, [this]() {
    sendStatus();
  });
  server_.on("/api/log", HTTP_GET, [this]() {
    sendLog();
  });
  server_.on("/api/servo", HTTP_POST, [this]() {
    setServoAngle();
  });
  server_.onNotFound([this]() {
    server_.send(404, "text/plain; charset=utf-8", "Not found");
  });
  server_.begin();
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
}

void WebStatusServer::sendLog() {
  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "text/plain; charset=utf-8", AppLog::snapshot());
}

void WebStatusServer::setServoAngle() {
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
  if (!hasAngle && !hasEnabled) {
    server_.send(400, "text/plain; charset=utf-8",
                 "Provide an angle or enabled parameter");
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

  if ((hasEnabled && !servo->setEnabled(enabled)) ||
      (hasAngle && !servo->setAngle(static_cast<uint8_t>(angle)))) {
    server_.send(500, "text/plain; charset=utf-8",
                 "PCA9685 rejected the servo command");
    return;
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
  const String coreVersion = ESP.getCoreVersion();
  const String resetReason = ESP.getResetReason();

  String json;
  json.reserve(1800);
  json += F("{\"device\":{\"chipId\":\"0x");
  json += String(ESP.getChipId(), HEX);
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
  json += String(ESP.getMaxFreeBlockSize());
  json += F(",\"heapFragmentation\":");
  json += String(ESP.getHeapFragmentation());
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
  json += F("},\"servos\":[");
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
    json += F(",\"angleDegrees\":");
    json += String(servo->angle());
    json += F(",\"pulseMicroseconds\":");
    json += String(servo->pulseMicroseconds());
    json += F(",\"enabled\":");
    json += servo->isEnabled() ? F("true") : F("false");
    json += '}';
  }
  json += F("]}");

  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "application/json; charset=utf-8", json);
}
