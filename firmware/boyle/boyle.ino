/*
 * Boyle 법칙 압력 센서 펌웨어 — DFRobot Gravity 1.6MPa 센서 버전
 *
 * 프로토콜: docs/05-data-format.md v1.1
 *   - 부팅 직후: hello("t":"s") 1회
 *   - 이후: 데이터 프레임("t":"d") 200ms 주기 (5Hz)
 *
 * 하드웨어:
 *   - ESP32 DevKit C v4
 *   - DFRobot Gravity 1.6MPa 압력 센서 (아날로그 0.5~4.5V 출력)
 *   - 전압 분배기: R1=10kΩ (센서-ADC), R2=27kΩ (ADC-GND)
 *   - GPIO34 (ADC1_CH6) 입력
 *
 * 임시 모드: BMP280/DFRobot 미도착 — readPressurePa()는 가짜 sin 데이터
 *   송신 중. 센서 도착 시 원본 복원.
 *
 * Wokwi 검증: 포텐셔미터로 0~3.3V 아날로그 출력을 흉내.
 *   포텐셔미터 양끝 3V3/GND, SIG → GPIO34 (실물 배선과 동일 핀).
 *   실물 전환 시 배선만 센서 + 전압 분배기로 바꾸면 코드 수정 0.
 *
 * 배선 상세: firmware/README.md 참조.
 */

#include <Arduino.h>

const int    POT_PIN         = 1;             // ADC1_CH0 (ESP32-S3)
const char*  SENSOR_NAME     = "DFRobot-1.6MPa";
const char*  FIRMWARE_VER    = "1.1.0-real";
static unsigned long REPORT_MS = 200;          // 5Hz (cfg 메시지로 갱신 가능)

// v1.1 RX 처리 — 한 줄 누적 버퍼 + 직전 측정값 (calib ACK 용)
const size_t LINE_BUF_MAX = 256;
static char  rxBuf[LINE_BUF_MAX];
static size_t rxLen = 0;
static long  lastPaForCalib = 0;   // 직전 readPressurePa() 결과 저장 (calib ACK용)

// 전압 분배기 계수 (R1=10k 직렬, R2=27k 대지)
const float V_ADC_MAX     = 3.3f;                         // ESP32 ADC 참조전압
const int   ADC_MAX       = 4095;                         // 12bit
const float DIVIDER_RATIO = 27.0f / (10.0f + 27.0f);      // ≈ 0.7297

// 센서 스펙 (DFRobot Gravity 1.6MPa)
const float V_SENSOR_ZERO = 0.5f;        // 0 Pa 출력
const float V_SENSOR_FULL = 4.5f;        // 1.6 MPa 출력
const long  P_FULL_PA     = 1600000L;    // 1.6 MPa

// 원본 — 센서 도착 시 #if 0 → #if 1 로 복원하고 아래 가짜 함수 제거
#if 0
long readPressurePa() {
  int raw = analogRead(POT_PIN);

  // ADC raw → 실제 ADC 입력 전압
  float vAdc = (float)raw * V_ADC_MAX / (float)ADC_MAX;

  // 전압 분배기 역산 → 원래 센서 출력 전압
  float vSensor = vAdc / DIVIDER_RATIO;

  // 0 kPa 미만(센서 오프셋 아래)은 0 으로 클램프
  if (vSensor < V_SENSOR_ZERO) return 0L;

  float ratio = (vSensor - V_SENSOR_ZERO) / (V_SENSOR_FULL - V_SENSOR_ZERO);
  long pa = (long)(ratio * (float)P_FULL_PA);

  // 상하한 클램프 (부동소수 오차·센서 튐 방어)
  if (pa < 0L)         pa = 0L;
  if (pa > P_FULL_PA)  pa = P_FULL_PA;

  return pa;
}
#endif

// 임시 가짜 데이터 — 6초 주기, 70~130 kPa sin 진동
long readPressurePa() {
  float t = millis() / 1000.0f;
  return 100000L + (long)(30000.0 * sin(t * 2.0 * PI / 6.0));
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

// ── v1.1 수신 처리 ──────────────────────────────────────────────
// 명세: docs/05-data-format.md §"브라우저 → 펌웨어"
//   ping  → 무응답 소비 (keep-alive)
//   calib → {"t":"c","p0":<Pa>} ACK
//   cfg   → REPORT_MS 갱신 (50~5000 ms), ACK 없음
// 의존성 0 — ArduinoJson 미사용, strstr 기반 단순 토큰 검색.

void sendCalibAck(long pa) {
  Serial.print("{\"t\":\"c\",\"p0\":");
  Serial.print(pa);
  Serial.println("}");
}

void parseCfgRate(const char* buf, size_t len) {
  (void)len;
  const char* p = strstr(buf, "\"rate\":");
  if (!p) return;
  p += 7;                                // strlen("\"rate\":")
  int rate = atoi(p);                    // atoi 는 leading whitespace 자체 처리
  if (rate >= 50 && rate <= 5000) {
    REPORT_MS = (unsigned long)rate;
  } else {
    Serial.print("{\"t\":\"e\",\"msg\":\"cfg_out_of_range:");
    Serial.print(rate);
    Serial.println("\"}");
  }
}

void handleLine(const char* buf, size_t len) {
  if (strstr(buf, "\"t\":\"ping\"")) {
    return;                              // 무응답 소비 (명세대로)
  }
  if (strstr(buf, "\"t\":\"calib\"")) {
    sendCalibAck(lastPaForCalib);
    return;
  }
  if (strstr(buf, "\"t\":\"cfg\"")) {
    parseCfgRate(buf, len);
    return;
  }
  Serial.println("{\"t\":\"e\",\"msg\":\"unknown_type\"}");
}

void handleSerialRx() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;             // CR 무시
    if (c == '\n') {
      if (rxLen > 0) {
        rxBuf[rxLen] = '\0';
        handleLine(rxBuf, rxLen);
      }
      rxLen = 0;
      continue;
    }
    if (rxLen >= LINE_BUF_MAX - 1) {
      Serial.println("{\"t\":\"e\",\"msg\":\"line_overflow\"}");
      rxLen = 0;
      continue;
    }
    rxBuf[rxLen++] = c;
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(POT_PIN, INPUT);
  analogReadResolution(12);
  sendHello();
}

void loop() {
  static unsigned long last = 0;
  unsigned long now = millis();
  if (now - last >= REPORT_MS) {
    last = now;
    long pa = readPressurePa();
    lastPaForCalib = pa;
    float tempC = 25.0f;      // 임시 고정. 별도 온도센서 추가 시 교체.
    sendData(pa, tempC, now);
  }
  handleSerialRx();
}
