#pragma once

#include <Arduino.h>

#if defined(ARDUINO_ARCH_ESP32)
#include <WiFi.h>
#include <WebServer.h>
#include <esp_system.h>
#include <esp_arduino_version.h>
using ControllerWebServer = WebServer;
#else
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
using ControllerWebServer = ESP8266WebServer;
#endif

namespace DevicePlatform {
inline uint32_t chipId() {
#if defined(ARDUINO_ARCH_ESP32)
  return static_cast<uint32_t>(ESP.getEfuseMac() >> 24);
#else
  return ESP.getChipId();
#endif
}
inline String coreVersion() {
#if defined(ARDUINO_ARCH_ESP32)
  return ESP_ARDUINO_VERSION_STR;
#else
  return ESP.getCoreVersion();
#endif
}
inline String resetReason() {
#if defined(ARDUINO_ARCH_ESP32)
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "Power on";
    case ESP_RST_EXT: return "External reset";
    case ESP_RST_SW: return "Software reset";
    case ESP_RST_PANIC: return "Panic";
    case ESP_RST_INT_WDT: return "Interrupt watchdog";
    case ESP_RST_TASK_WDT: return "Task watchdog";
    case ESP_RST_WDT: return "Watchdog";
    case ESP_RST_DEEPSLEEP: return "Deep sleep";
    case ESP_RST_BROWNOUT: return "Brownout";
    case ESP_RST_SDIO: return "SDIO reset";
    default: return "Unknown";
  }
#else
  return ESP.getResetReason();
#endif
}
inline uint32_t largestFreeBlock() {
#if defined(ARDUINO_ARCH_ESP32)
  return ESP.getMaxAllocHeap();
#else
  return ESP.getMaxFreeBlockSize();
#endif
}
inline uint32_t heapFragmentation() {
#if defined(ARDUINO_ARCH_ESP32)
  const uint32_t freeHeap = ESP.getFreeHeap();
  const uint32_t largest = largestFreeBlock();
  return freeHeap && largest < freeHeap ? 100 - (100ULL * largest / freeHeap) : 0;
#else
  return ESP.getHeapFragmentation();
#endif
}
}  // namespace DevicePlatform
