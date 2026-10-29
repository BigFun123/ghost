#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

namespace RobotStorage {
inline bool validName(const String& name) {
  if (!name.length() || name.length() > 40 || name[0] == ' ' || name.endsWith(" ")) return false;
  for (size_t i = 0; i < name.length(); ++i) {
    const char c = name[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || (i && (c == ' ' || c == '_' || c == '-')))) return false;
  }
  String lower = name; lower.toLowerCase();
  return lower != "con" && lower != "prn" && lower != "aux" && lower != "nul" &&
      !(lower.length() == 4 && (lower.startsWith("com") || lower.startsWith("lpt")) && isDigit(lower[3]));
}
inline String active() {
  File file = LittleFS.open("/robots.json", "r");
  JsonDocument manifest;
  if (!file || deserializeJson(manifest, file)) return String();
  const String name = manifest["active"] | "";
  return validName(name) ? name : String();
}
inline String path(const String& file, const String& robot = active()) {
  return robot.length() ? String("/robots/") + robot + "/" + file : String("/") + file;
}
inline bool select(const String& name) {
  if (!validName(name) || !LittleFS.exists(path("config.json", name))) return false;
  JsonDocument manifest;
  File input = LittleFS.open("/robots.json", "r");
  if (input) { deserializeJson(manifest, input); input.close(); }
  JsonArray names = manifest["robots"].is<JsonArray>() ? manifest["robots"].as<JsonArray>() : manifest["robots"].to<JsonArray>();
  bool found = false;
  for (JsonVariantConst entry : names) if (entry.as<String>() == name) found = true;
  if (!found) names.add(name);
  manifest["active"] = name;
  File output = LittleFS.open("/robots.json.tmp", "w");
  if (!output) return false;
  const size_t expected = measureJson(manifest), written = serializeJson(manifest, output);
  output.close();
  return written == expected && LittleFS.rename("/robots.json.tmp", "/robots.json");
}
inline bool renameRobot(const String& from, const String& to) {
  if (!validName(from) || !validName(to) || !LittleFS.exists(path("config.json", from))) return false;
  if (from == to) return true;
  const String source = String("/robots/") + from, target = String("/robots/") + to;
  if (LittleFS.exists(target)) return false;
  JsonDocument manifest;
  File input = LittleFS.open("/robots.json", "r");
  if (!input || deserializeJson(manifest, input)) return false;
  input.close();
  for (JsonVariant entry : manifest["robots"].as<JsonArray>()) if (entry.as<String>() == from) entry.set(to);
  if (String(manifest["active"] | "") == from) manifest["active"] = to;
  if (!LittleFS.rename(source, target)) return false;
  File output = LittleFS.open("/robots.json.tmp", "w");
  const size_t expected = measureJson(manifest);
  const size_t written = output ? serializeJson(manifest, output) : 0;
  if (output) output.close();
  if (written != expected || !LittleFS.rename("/robots.json.tmp", "/robots.json")) {
    LittleFS.rename(target, source);
    return false;
  }
  return true;
}
inline uint8_t servoCount(const String& name) {
  JsonDocument config;
  File file = LittleFS.open(path("config.json", name), "r");
  if (!file || deserializeJson(config, file)) return 0;
  uint8_t count = 0;
  for (JsonObjectConst component : config["components"].as<JsonArrayConst>()) if (String(component["objectType"] | "Servo") == "Servo") ++count;
  return count;
}
}
