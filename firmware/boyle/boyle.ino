/*
 * Boyle 법칙 압력 센서 펌웨어 (Phase 3)
 * 시뮬레이터 단계: 포텐셔미터 → ADC → Pa 스케일링 → v1.1 JSON
 *
 * 프로토콜: docs/05-data-format.md v1.1
 *   - 부팅 직후: hello("t":"s") 1회
 *   - 이후: 데이터 프레임("t":"d") 200ms 주기 (5Hz)
 *   - (heartbeat hello는 현재 단계에선 생략)
 *
 * 실물 교체 포인트: readPressurePa() 한 함수만 bmp.readPressure()로.
 *
 * Wokwi 검증: https://wokwi.com/projects/462084497227380737
 */

#include <Arduino.h>

const int    POT_PIN         = 34;       // ADC1_CH6
const char*  SENSOR_NAME     = "BMP280";
const char*  FIRMWARE_VER    = "1.1.0-sim";
const unsigned long REPORT_MS = 200;     // 5Hz

// 포텐셔미터 스케일링 범위
// ADC 0 ~ 4095 를 50000 Pa ~ 200000 Pa 로 선형 매핑
// (기준 대기압 ~101325 Pa가 중간 약간 아래에 위치)
const long PA_MIN = 50000L;
const long PA_MAX = 200000L;

long readPressurePa() {
  int raw = analogRead(POT_PIN);  // 0..4095
  long pa = PA_MIN + ((long)raw * (PA_MAX - PA_MIN)) / 4095L;
  return pa;
}

void sendHello() {
  Serial.print("{\"t\":\"s\",\"sensor\":\"");
  Serial.print(SENSOR_NAME);
  Serial.print("\",\"fw\":\"");
  Serial.print(FIRMWARE_VER);
  Serial.println("\"}");
}

void sendData(long pa, float tempC, unsigned long ts) {
  Serial.print("{\"t\":\"d\",\"p\":");
  Serial.print(pa);
  Serial.print(",\"T\":");
  Serial.print(tempC, 1);
  Serial.print(",\"ts\":");
  Serial.print(ts);
  Serial.println("}");
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(POT_PIN, INPUT);
  sendHello();
}

void loop() {
  static unsigned long last = 0;
  unsigned long now = millis();
  if (now - last >= REPORT_MS) {
    last = now;
    long pa = readPressurePa();
    float tempC = 25.0;
    sendData(pa, tempC, now);
  }
}
