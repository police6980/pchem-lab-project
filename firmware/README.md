# Firmware (Phase 3)

ESP32 + BMP280 펌웨어. 보일 법칙 실험용 압력 센서 노드.

## 하드웨어
- **MCU**: ESP32 (DevKit 또는 WROOM 계열)
- **센서**: BMP280 (I2C, 기압·온도)
- **통신**: USB 시리얼 (115200 baud)

## 개발 환경
- **Wokwi 시뮬레이터** (하드웨어 도착 전 펌웨어 개발·검증)
- **Arduino IDE** (실물 플래시)

## 프로토콜
시리얼 프레임 포맷은 `docs/05-data-format.md` v1.1 참조.

- 전송: JSON 한 줄 + `\n`
- 메시지 타입: `"d"` (데이터) / `"s"` (hello) / `"c"` (calib ACK) / `"e"` (error)
- 수신: `ping` / `calib` / `cfg`

## 디렉토리
- `boyle/boyle.ino` — 보일 법칙용 펌웨어 (Arduino 스케치)

## Wokwi 시뮬레이션
- **프로젝트**: https://wokwi.com/projects/462084497227380737
- **구성**: ESP32 DevKit C v4 + 포텐셔미터 (GPIO34, ADC1_CH6)
- **용도**: 포텐셔미터를 "가짜 압력 센서"로 사용. 노브 돌리면 압력값(50000~200000 Pa) 변화
- **실물 교체**: `readPressurePa()` 함수 내부만 BMP280 I2C 호출로 변경

## Wokwi에서 검증된 것
- v1.1 hello 프레임 (`"t":"s"`) 부팅 시 1회 전송
- v1.1 데이터 프레임 (`"t":"d"`) 200ms(5Hz) 주기 전송
- 필드: `p` (Pa, 정수), `T` (°C, float), `ts` (ms, unsigned long)
- 포텐셔미터 전 범위 조작으로 p 값 실시간 변화 확인
