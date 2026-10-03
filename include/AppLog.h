#pragma once

#include <Arduino.h>

namespace AppLog {
void begin();
void print(const char* text);
void println(const char* text);
void println();
void printf(const char* format, ...);
String snapshot();
}  // namespace AppLog
