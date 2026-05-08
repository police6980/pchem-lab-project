# Firmware (Phase 3)

ESP32 + DFRobot Gravity 1.6MPa 아날로그 압력 센서 펌웨어. 보일 법칙 실험용
압력 센서 노드.

## 하드웨어
- **MCU**: ESP32 (DevKit C v4 또는 WROOM 계열)
- **센서**: DFRobot Gravity 1.6MPa (아날로그 0.5~4.5V 선형 출력)
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
- **용도**: 포텐셔미터 출력 0~3.3V 가 **ESP32 ADC 가 읽는 전압**(실물 회로에서
  전압 분배기를 거친 값) 과 동일 의미를 갖도록 의도 설계됨. 노브 최대 3.3V →
  역산 Vsensor ≈ 4.52V → P ≈ 1608 kPa → 상한 클램프 1.6MPa.
- **실물 교체**: 배선만 센서 + 전압 분배기로 교체, `boyle.ino` 코드 수정 0.

## 실물 배선 (DFRobot Gravity 1.6MPa)

```
센서 (DFRobot Gravity 1.6MPa)
├─ 빨강 (VCC)  → ESP32 VIN 또는 5V
├─ 검정 (GND)  → ESP32 GND (공통 접지)
└─ 노랑 (SIG)  ─┬─ [R1 = 10 kΩ] → ESP32 GPIO34
                └─ [R2 = 27 kΩ] → GND
```

**전압 분배기 계산**:
- 센서 최대 출력 4.5 V × 27 / (10 + 27) = **3.28 V** (ESP32 ADC 안전 범위)
- 분배비 0.7297 → 펌웨어에서 역산해 원래 센서 전압 복원
- 펌웨어 상수: `DIVIDER_RATIO = 27.0 / (10.0 + 27.0)` in `boyle.ino`

**변환 체인** (펌웨어 `readPressurePa()` 내부):
1. `vAdc = analogRead(34) × 3.3 / 4095` — ESP32 ADC 전압
2. `vSensor = vAdc / DIVIDER_RATIO` — 센서 원래 출력 복원
3. `P_Pa = (vSensor − 0.5) / 4.0 × 1_600_000` — 0.5~4.5 V 를 0~1.6 MPa 로 선형
4. 0 / 1.6 MPa 상하한 클램프 (음수·오버플로 방어)

**주의**:
- ESP32 3V3 핀으로 센서 전원 공급 금지 — 센서는 5V 필요.
- 5V 전원은 USB 동작 중 ESP32 의 VIN 또는 5V 핀에서 얻음.
- GND 반드시 공통 접지. 전압 분배기 저항은 ±1 % 이하 권장.

## Wokwi 에서 검증된 것
- v1.1 hello 프레임 (`"t":"s"`) 부팅 시 1회 전송 — sensor=`DFRobot-1.6MPa`,
  fw=`1.1.0-real`
- v1.1 데이터 프레임 (`"t":"d"`) 200 ms (5 Hz) 주기 전송
- 필드: `p` (Pa, 정수 0 ~ 1_600_000), `T` (°C, float, 현재 25.0 고정),
  `ts` (ms, unsigned long)
- 포텐셔미터 전 범위 조작으로 `p` 값 0 ~ 1.6 MPa 실시간 변화 확인
