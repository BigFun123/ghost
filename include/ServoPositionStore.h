#pragma once

#include <Arduino.h>

bool loadServoPositions(uint8_t* positions, uint8_t capacity, uint8_t count);
bool saveServoPositions(const uint8_t* positions, uint8_t count);
