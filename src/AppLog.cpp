#include "AppLog.h"

#include <stdarg.h>
#include <stdio.h>

namespace AppLog {
namespace {
constexpr size_t kBufferCapacity = 2048;
char logBuffer[kBufferCapacity];
size_t nextWriteIndex = 0;
size_t bufferedLength = 0;

void write(const char* text, size_t length) {
  Serial.write(reinterpret_cast<const uint8_t*>(text), length);
  for (size_t index = 0; index < length; ++index) {
    logBuffer[nextWriteIndex] = text[index];
    nextWriteIndex = (nextWriteIndex + 1) % kBufferCapacity;
    if (bufferedLength < kBufferCapacity) {
      ++bufferedLength;
    }
  }
}
}  // namespace

void begin() {
  nextWriteIndex = 0;
  bufferedLength = 0;
}

void print(const char* text) {
  if (text != nullptr) {
    write(text, strlen(text));
  }
}

void println(const char* text) {
  print(text);
  write("\r\n", 2);
}

void println() {
  write("\r\n", 2);
}

void printf(const char* format, ...) {
  char line[192];
  va_list arguments;
  va_start(arguments, format);
  const int length = vsnprintf(line, sizeof(line), format, arguments);
  va_end(arguments);

  if (length <= 0) {
    return;
  }

  const size_t bytesToWrite =
      static_cast<size_t>(length) < sizeof(line)
          ? static_cast<size_t>(length)
          : sizeof(line) - 1;
  write(line, bytesToWrite);
}

String snapshot() {
  String result;
  result.reserve(bufferedLength);
  const size_t firstIndex =
      (nextWriteIndex + kBufferCapacity - bufferedLength) % kBufferCapacity;
  for (size_t index = 0; index < bufferedLength; ++index) {
    result += logBuffer[(firstIndex + index) % kBufferCapacity];
  }
  return result;
}
}  // namespace AppLog
