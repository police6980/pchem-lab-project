# Real Sensor Integration Checklist

> Phase 5 Step I — 실물 센서(ESP32 + DFRobot SEN0257 × 2) 도착 시 따라할 단일 절차서.

## 목차
1. 목적·범위
2. 도착 직후 점검
3. 펌웨어 플래시
4. 1차 통신 검증 (시리얼)
5. WebSerial 브라우저 연결
6. 캘리브레이션
7. outlier 가드 동작 확인
8. 노이즈 특성 비교 (baseline 측정)
9. 통합 테스트 (Dalton 풀 코스)
10. 트러블슈팅
11. Step I 통과 기준

---

## 1. 목적·범위

이 문서는 실물 ESP32 + DFRobot SEN0257 × 2 도착 후 Phase 5 Step I 완료까지의 단일 절차서.

**다루는 것**: 조립 → 펌웨어 → 통신 → 캘리브레이션 → 회귀 테스트 → 통과 기준.

**다루지 않는 것**:
- 에뮬레이터 사용법 → `tools/firmware-emulator/README.md`
- params.sensor 상수 의미 → `docs/15-params-config-guide.md` (작성 예정)
- Dalton 시뮬 설계 → `docs/11-dalton-design.md`
- WebSerial 어댑터 내부 구조 → `docs/03-architecture.md` (mock 일원화 갱신 예정)

전제 — 에뮬 단계(Phase 5 A-1 까지)에서 outlier 가드 / 노이즈 시나리오 / Dalton 시뮬은 모두 통과 상태. 본 문서는 "에뮬 → 실물" 전환 시 코드 수정 0 목표를 검증하는 절차.

---

## 2. 도착 직후 점검

### 2.1 BOM (자재 목록)

| 부품 | 수량 | 비고 |
|---|---|---|
| ESP32 DevKit (WROOM-32) | 1 | USB-C 또는 Micro-USB |
| DFRobot SEN0257 (gauge) | 2 | 0~40 kPa, analog out |
| 점퍼 와이어 (수-수 / 수-암) | 약 10 | 빵판 배선용 |
| 빵판 (half-size) | 1 | 임시 조립 |
| USB 케이블 | 1 | ESP32 ↔ PC, **데이터 전송 가능** |

정식 케이스 / 납땜 PCB는 Step I 이후 (Phase 5.x 또는 Phase 6).

### 2.2 외관 점검

- [ ] ESP32 핀 휨 / 납땜 균열 없음
- [ ] SEN0257 케이블 단선 없음 (× 2)
- [ ] USB 케이블 데이터 전송 가능 — 전원 전용 케이블이면 인식 X

### 2.3 핀배치 (잠정)

```
ESP32          SEN0257 #0      SEN0257 #1
GPIO 34   <─── AOUT
GPIO 35   <───                 AOUT
3V3       ───> VCC, VCC                      (두 센서 공통)
GND       ───> GND, GND                      (두 센서 공통)
```

근거 — GPIO 34 / 35 는 input-only ADC1 채널. ADC2 는 WiFi 동시 사용 시 충돌하므로 회피. 실측 후 `firmware/src/main.cpp` 의 `PIN_CH0`, `PIN_CH1` 매크로와 일치 확인.

---

## 3. 펌웨어 플래시

### 3.1 빌드 환경

- PlatformIO (VSCode 확장 권장) 또는 Arduino IDE
- 보드 — ESP32 DevKit (WROOM-32)
- baud — 115200 (펌웨어 / 시리얼 모니터 / WebSerial 일치 필수)

### 3.2 절차

1. `firmware/` 진입
2. 핀 매핑 확인 — `src/main.cpp` 의 `PIN_CH0`, `PIN_CH1` 이 §2.3 과 일치
3. 빌드 → USB 연결 상태에서 플래시
4. 플래시 직후 시리얼 모니터 (115200) 에서 v1.1 hello 1회 출력 확인

플래시 실패 시 §10 참조.

---

## 4. 1차 통신 검증 (시리얼)

> 2026-04-28 갱신 — baseline.js 스모크 테스트 (effbf40) 에서 발견된 v1.2 실제 형식 반영. 권위: `docs/12-protocol-v1.2.md`. 펌웨어: `firmware/boyle/boyle.ino`.

### 4.1 hello 패킷

연결 직후 1회 출력 (v1.2 — 멀티채널):
```
{"t":"s","sensor":"DFRobot-1.6MPa","fw":"<펌웨어 버전>","channels":[
  {"ch":0,"sensor":"DFRobot-1.6MPa","label":"B-receiver"},
  {"ch":1,"sensor":"DFRobot-1.6MPa","label":"A-injector"}
]}
```

확인 — `t`=`"s"`, `channels` 배열 존재 + 길이 2 (ch:0, ch:1). v1.1 호환 (보일 단일 채널) 시 `channels` 필드 생략 — 단일 채널 모드.

### 4.2 데이터 패킷

이후 ~5 Hz/ch (200 ms 간격, **채널별 별도 패킷**):
```
{"t":"d","ch":0,"p":<Pa>,"T":<°C>,"ts":<ms>}
{"t":"d","ch":1,"p":<Pa>,"T":<°C>,"ts":<ms>}
```

확인 — `p` 가 0~1,600,000 (Pa 정수, 펌웨어가 ADC raw → Pa 변환 후 송신). 변환 코드: `firmware/boyle/boyle.ino:38-58` `readPressurePa()`. 두 채널 모두 0 또는 1,600,000 (= 1.6 MPa, P_FULL_PA) 고정 → 핀 / 전원 의심.

송신율 — `REPORT_MS = 200` (`boyle.ino:26`, `emulator.js:33`). 멀티채널 시 채널마다 200 ms 주기 → 합산 ~10 Hz (2 패킷/200 ms 윈도우). 송신율 변경은 cfg 메시지 (`docs/12` §브라우저→펌웨어 (3)).

### 4.3 압박 테스트

SEN0257 다이어프램에 가벼운 압력 → 해당 채널 `p` 가 ~5 kPa (5,000 Pa) 변화. 변화 없음 → 센서 단자 / 점퍼 의심.

---

## 5. WebSerial 브라우저 연결

### 5.1 사전 조건

- Chrome 89+ / Edge 89+ (WebSerial 표준)
- HTTPS 또는 `localhost`
- 시리얼 모니터 / 다른 프로세스의 COM 포트 점유 해제

### 5.2 절차

1. `python -m http.server 8000` (프로젝트 루트)
2. `http://localhost:8000/web/dalton.html`
3. 데이터 소스 → "실물 센서 (WebSerial)"
4. "포트 선택" → 브라우저 다이얼로그에서 ESP32 COM 포트 → 권한 승인
5. hello 자동 수신 → 연결 OK

### 5.3 연결 끊김

USB 분리 자동 감지 → 재연결 버튼 노출. 재연결 시 hello 1회 재수신.

---

## 6. 캘리브레이션

두 채널 별도 측정. 모든 상수는 `params.json` 의 `sensor` 블록에 기입.

### 6.1 영점 (`zeroPa`)

대기 평형 상태에서 60 초 `p` 평균 = `zeroPa` (Pa 정수). 펌웨어가 ADC raw 를 Pa 로 변환 후 송신 (§4.2) — 브라우저 / 캘리브 단계는 Pa 단위로 다룸. (TBD — 실측)

### 6.2 스팬 (`spanPa`, `spanKPa`)

알려진 압력 (예: 펌프 +5 kPa) 가할 때 `p` 변화량 = `spanPa` (Pa), 가한 압력 = `spanKPa`. (TBD — 실측)

### 6.3 ratio 매핑

Dalton 시뮬은 ratio (ch0 : ch1) 가 핵심. 절대 압력은 캘리브레이션 오차에 민감하지만 ratio 는 양 채널 동일 sensor 사용으로 상쇄. `params.sensor.useRatioMode = true` 유지 (기본값).

상수 의미 — `docs/15-params-config-guide.md` (작성 예정).

---

## 7. outlier 가드 동작 확인

5 단계 가드 (NaN / 음수 / saturation / median spike / state 갱신) 가 실물에서 정상 동작하는지 회귀 테스트. 가드는 `manager._dispatchData` 단일 위치에 silent guard 형태로 위치 (직전 세션 결정).

### 7.1 NaN / 음수

정상 동작 시 발생 X. 단자 분리 → floating 상태 → 노이즈 폭증 또는 4095 saturation 형태로 관찰. NaN / 음수 자체가 나오면 펌웨어 파싱 오류 신호.

### 7.2 Saturation (1.6 MPa)

다이어프램 강하게 압박 → `p` 가 P_FULL_PA (1,600,000 Pa = 1.6 MPa, 펌웨어 클램프) 도달 → 브라우저 outlier 가드 saturation 임계값 (1600 kPa, `web/js/serial.js GUARD_SATURATION_KPA`) 과 일치 → 1600 으로 clip + rate-limit warn 하는지 콘솔 확인.

### 7.3 Median spike

USB 케이블 흔들기 / 점퍼 살짝 빼기 → 일시적 spike → 시뮬 화면 jitter 없이 매끄러운지.

판정 — 에뮬 A-1 harsh 모드와 동등 안정성이면 통과.

---

## 8. 노이즈 특성 비교 (baseline 측정)

목적 — 에뮬 A-1 의 quiet / normal / harsh 프리셋이 실물 노이즈를 합리적으로 근사하는지 검증. 추후 회귀 테스트 baseline.

### 8.1 측정 스크립트

A-1 노이즈 시나리오 인프라 확장. `tools/firmware-emulator/baseline.js`:

```
# 에뮬레이터를 별도 터미널에서 실행 (preset 별 측정 시 --noise 변경)
cd tools/firmware-emulator && npm start -- --mode dalton --noise normal

# 다른 터미널에서 baseline 측정 (60 초)
node tools/firmware-emulator/baseline.js --duration 60 --out baseline-emu-normal.json --label "emu-normal"
```

출력 — JSON (label / sampleCount / σ / maxSpike / drift + raw samples).

실물 모드 — Node SerialPort 의존성 필요. 도착 후 npm install + 모드 추가 (§11 통과 측정 직전 TODO).

### 8.2 비교 지표

baseline.js 출력 단위 = Pa (펌웨어 / 에뮬 송신 단위 일치). A-1 preset 의 σ 도 Pa (예: quiet=500, normal=2000, harsh=5000).

| 지표 | 실물 | 에뮬 quiet | 에뮬 normal | 에뮬 harsh |
|---|---|---|---|---|
| σ (Pa) | TBD | TBD | TBD | TBD |
| 최대 spike (Pa) | TBD | TBD | TBD | TBD |
| drift / 분 (Pa) | TBD | TBD | TBD | TBD |

판정 — 실물 σ 가 에뮬 normal ± 50% 범위 내면 프리셋 유지. 벗어나면 A-1 프리셋 재조정 (Phase 5.x 후속).

---

## 9. 통합 테스트 (Dalton 풀 코스)

### 9.1 시나리오

1. 빈 챔버 평형 → 측정 시작
2. 가스 A 주입 → ch0 상승 확인
3. 가스 B 주입 → ch1 상승 확인
4. ratio 표시 / 그래프 / 결과 화면 흐름 정상
5. 측정 종료 → 보고서 화면

### 9.2 통과 조건

- 60 초 측정 중 disconnect / NaN / 0 고정 없음
- ratio 가 주입량과 일관 (± 10%)
- 그래프 jitter 가 에뮬 normal 동등 이하

---

## 10. 트러블슈팅

### COM 포트 인식 X
- USB 드라이버 (CP2102 / CH340) 설치
- 케이블 데이터 전송 가능 여부

### 플래시 실패 (timeout)
- BOOT 버튼 누른 상태에서 재시도
- baud 낮춤 (921600 → 460800 → 115200)

### WebSerial 권한 거부
- HTTPS 또는 `localhost` 인지
- 시리얼 모니터 점유 해제
- 브라우저 재시작

### JSON parse error (패킷 깨짐)
- baud mismatch — 펌웨어 / 브라우저 양쪽 115200 확인
- 점퍼 접촉 불량 → 빵판 재배치

### raw 값 항상 0 또는 4095
- §2.3 핀배치 재확인
- GND 공통 / VCC 공급 확인

---

## 11. Step I 통과 기준

다음 모두 만족 시 Phase 5 Step I 완료:

- [ ] 펌웨어 플래시 → hello 정상 수신 (§4)
- [ ] WebSerial 연결 10 분 이상 끊김 없음 (§5)
- [ ] 캘리브레이션 영점 / 스팬 / ratio 모드 작동 (§6)
- [ ] outlier 가드 5 단계 회귀 테스트 통과 (§7)
- [ ] 노이즈 baseline 측정 + 에뮬 프리셋 비교 분석 (§8)
- [ ] Dalton 풀 코스 60 초 측정 통과 (§9)

통과 후 — `docs/10-dev-journal.md` 에 Phase 5 Step I 완료 기록 추가. 다음 — Phase 5.x (케이스 / PCB) 또는 Phase 6 (다음 시뮬).
