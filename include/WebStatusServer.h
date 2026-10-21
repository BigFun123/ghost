#pragma once

#include <ESP8266WebServer.h>

#include "Pca9685ServoTest.h"
#include "ServoConfiguration.h"

class WebStatusServer {
 public:
  void begin(Pca9685ServoTest* servos,
             const ServoConfiguration* configurations,
             uint8_t servoCount,
             bool filesystemReady);
  void handleClient();
  void markServoPositionsChanged();

 private:
  void sendAsset(const char* path, const char* contentType);
  void sendStatus();
  void sendLog();
  void sendSequence();
  void saveSequence();
  void savePreviewConfiguration();
  void saveServoConfiguration();
  void saveServoPositionsIfDue();
  void setServoAngle();

  ESP8266WebServer server_{80};
  Pca9685ServoTest* servos_ = nullptr;
  const ServoConfiguration* configurations_ = nullptr;
  uint8_t servoCount_ = 0;
  bool filesystemReady_ = false;
  bool rebootPending_ = false;
  unsigned long rebootRequestedAt_ = 0;
  bool servoPositionsDirty_ = false;
  unsigned long servoPositionsChangedAt_ = 0;
  unsigned long servoPositionsLastSaveAttemptAt_ = 0;
};
