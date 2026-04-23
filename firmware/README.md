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
