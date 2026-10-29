#pragma once
#include <ArduinoJson.h>
#include <LittleFS.h>

// Generated from the component registrations; no per-model firmware switch.
inline JsonDocument& componentCatalog() {
  static JsonDocument catalog;
  static bool loaded = false;
  if (!loaded) {
    File file = LittleFS.open("/components/catalog.json", "r");
    if (file && !deserializeJson(catalog, file)) loaded = true;
  }
  return catalog;
}
inline bool supportedComponentType(const String& type) {
  if (type == "Servo") return true;
  const JsonArrayConst types = componentCatalog()["objectTypes"].as<JsonArrayConst>();
  for (JsonVariantConst entry : types) {
    if (entry.as<String>() == type) return true;
  }
  return false;
}
inline bool supportedComponentModel(const String& type, const String& model) {
  const JsonArrayConst models = componentCatalog()["models"][type].as<JsonArrayConst>();
  for (JsonVariantConst entry : models) {
    if (entry.as<String>() == model) return true;
  }
  return false;
}

// Component-owned numeric settings are described by the filesystem catalog.
inline bool updateComponentNumericSettings(JsonObject entry, JsonObjectConst update) {
  const String type = entry["objectType"] | "Servo";
  const JsonObjectConst rules = componentCatalog()["numericSettings"][type].as<JsonObjectConst>();
  for (JsonPairConst rule : rules) {
    const char* key = rule.key().c_str();
    if (!update[key].isUnbound()) entry[key].set(update[key]);
    else if (entry[key].isUnbound()) entry[key].set(rule.value()["default"]);
    const JsonVariantConst value = entry[key];
    if (!value.is<double>() || !isfinite(value.as<double>()) ||
        value.as<double>() < rule.value()["min"].as<double>() ||
        value.as<double>() > rule.value()["max"].as<double>()) return false;
  }
  for (JsonPairConst rule : rules) {
    const char* maximum = rule.value()["maxField"] | "";
    if (maximum[0] && entry[rule.key()].as<double>() > entry[maximum].as<double>()) return false;
  }
  return true;
}
