#include "BoardRgbLed.h"

#if defined(CONFIG_IDF_TARGET_ESP32S3)
#include <esp32-hal-rgb-led.h>

#ifndef CONTROLLER_RGB_LED_PIN
#define CONTROLLER_RGB_LED_PIN PIN_RGB_LED
#endif
#endif

void BoardRgbLed::begin() {
  // Keep the startup indicator comfortably below full brightness.
  setColor(0, 0, 64);
}

void BoardRgbLed::setColor(uint8_t red, uint8_t green, uint8_t blue) {
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  rgbLedWrite(CONTROLLER_RGB_LED_PIN, red, green, blue);
#else
  // The original ESP8266 board has no addressable RGB LED.
  (void)red;
  (void)green;
  (void)blue;
#endif
}

void BoardRgbLed::off() {
  setColor(0, 0, 0);
}
