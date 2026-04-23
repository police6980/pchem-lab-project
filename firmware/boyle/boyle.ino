/*
 * Boyle 법칙 압력 센서 펌웨어 (Phase 3)
 * ESP32 + BMP280 (I2C)
 *
 * 프로토콜: docs/05-data-format.md v1.1
 * 현재 단계: 스켈레톤 (hello 전송만 검증)
 *   - 센서 드라이버, 데이터 프레임, 수신 처리는 후속 커밋
 *
 * Wokwi 검증: https://wokwi.com/projects/462084497227360737
 *   (※ 실제 URL로 교체하세요)
 */

#include <Arduino.h>

const char* SENSOR_NAME = "BMP280";
const char* FIRMWARE_VER = "1.1.0-skeleton";

void sendHello() {
  Serial.print("{\"t\":\"s\",\"sensor\":\"");
  Serial.print(SENSOR_NAME);
  Serial.print("\",\"fw\":\"");
  Serial.print(FIRMWARE_VER);
  Serial.println("\"}");
}

void setup() {
  Serial.begin(115200);
  delay(300);
  sendHello();
}

void loop() {
  static unsigned long last = 0;
  unsigned long now = millis();
  if (now - last >= 1000) {
    last = now;
    sendHello();
  }
}
