# pchem-lab: 보일 법칙 통합 교육 플랫폼

실제 센서 측정 + 입자 수준 시뮬레이션 + 생성형 AI 튜터를 하나로 묶은 과학
교육 플랫폼. 중·고등 과학 영재 학생을 대상으로 이론(기체 법칙)·실험(압력
센서)·탐구(AI 튜터 대화)의 연속성을 제공한다.

현재 **보일 법칙**을 중심 소재로 구현되어 있으며, 샤를·산염기 법칙은 후속
Phase 에서 확장 예정.

---

## 주요 기능

- **2D 입자 시뮬레이션** — p5.js, 맥스웰-볼츠만 분포, HSB 속도 색상, 피스톤
  충돌 섬광, 이상기체 기하학적 강제(`PV = const` 편차 ±0.5% 이내)
- **AI 튜터 (Anthropic Claude, BYOK)** — 학생 답변에 맞춘 멀티턴 대화, 수준
  자동 감지, Q1~Q4·자유 질문 탭 분리, 탐구 보고서 자동 생성(`.docx`)
- **3가지 센서 모드** — 시뮬레이션 / WebSocket 에뮬레이터 / 실센서(Web Serial),
  런타임 전환
- **심화 탐구 모드** — 이상기체 법칙 전 변수(V·T·N·기체 종류) 동시 조작, 추적
  입자 + 속도 게이지
- **세션 기록** — 측정점·연속 로그 CSV 내보내기, 10 000 행 상한 버퍼

---

## 빠른 시작

### 1. 로컬 서버 실행

프로젝트 루트에서:

```bash
python -m http.server 8000
```

브라우저(Chrome/Edge)에서 `http://localhost:8000/web/` 접속. 실센서 모드를
쓰지 않으면 이것만으로 전체 시뮬레이션·AI 튜터 사용 가능.

### 2. 센서 모드 선택

상단 토글에서 선택:

| 모드 | 설명 | 사용 시점 | 전제 |
|---|---|---|---|
| 🖥 시뮬레이션 | DEV 슬라이더로 압력 직접 조작 (81~400 kPa) | 이론 탐구, 하드웨어 없음 | 없음 |
| 🔌 에뮬레이터 | Node.js WebSocket 서버로 가짜 센서 프레임 수신 | 실센서 없이 Web Serial 외 경로 개발·수업 | 에뮬레이터 프로세스 실행 |
| ⚡ 실센서 | ESP32 + DFRobot Gravity 1.6MPa, USB 시리얼 | 실제 보일 실험 | 펌웨어 플래시 + 포트 권한 |

### 3. (선택) 에뮬레이터 실행

실물 센서 없이도 전체 데이터 경로(펌웨어 프로토콜 v1.1 → 브라우저 수신 →
UI 반영 → AI 튜터 컨텍스트)를 흘릴 수 있다.

```bash
cd tools/firmware-emulator
npm install        # 최초 1회 (ws 의존성)
npm start          # = node emulator.js
```

`ws://localhost:8787` 에서 대기 → 브라우저에서 [🔌 에뮬레이터] 클릭. CLI 에서
`↑↓` (±10 kPa) / `←→` (±1 kPa) / `r` (리셋) / `q` (종료) 로 압력 조작.

### 4. AI 튜터 활성화

사이드바 설정 패널(⚙)에 Anthropic API 키 입력. 키는 **sessionStorage 에만**
저장되어 탭을 닫으면 사라짐 — 공용 PC 사용 후 [키 삭제] 권장.

---

## 개발 현황

- **Phase 0~1 완료** — 설계·보일 시뮬레이터 MVP (`v0.1-mvp` 이후 여러 태그)
- **Phase 2-A/2-B 완료** — AI 튜터 UI + 실제 Anthropic API 연동 + 보고서 (`v0.3-ai-tutor-live`, `v0.4-boyle-complete`)
- **Phase 3 진행 중** — 실센서 통합 (현재 브랜치 `phase3-real-sensor`)
  - ✅ 프로토콜 v1.1, 펌웨어(Wokwi 검증), 에뮬레이터(calib ACK · cfg), 브라우저
    `WebSocketSensorSource` · `WebSerialSensorSource` · UI 삼항 토글,
    AI 튜터 데이터 소스 인식
  - ⏳ **Step 3-6**: 실물 DFRobot Gravity 1.6MPa 조립·플래시·실험 검증(하드웨어 도착 대기)
- **Phase 4.5** — 심화 탐구 모드 (`feature/particle-controls`, 병합 대기)
- **반응형 레이아웃** — (`feature/responsive-canvas`, 병합 대기)

상세 로드맵: `docs/09-roadmap.md`, 진행 상태 마스터: `docs/06-project-status.md`.

---

## 기술 스택

- **프론트엔드**: Vanilla JS + HTML/CSS, 빌드 도구 없음(단일 페이지, classic
  `<script defer>`)
- **시뮬레이션**: p5.js 1.11.2 (2D canvas, 2개 인스턴스: 시뮬 + 히스토그램)
- **AI**: Anthropic Claude Messages API — 브라우저 직접 호출(BYOK),
  `anthropic-dangerous-direct-browser-access` 헤더
- **센서 통신**: Web Serial API (실센서) / WebSocket (에뮬레이터), 프로토콜 v1.1
  JSON 라인. 상세는 `docs/05-data-format.md`.
- **펌웨어**: Arduino-ESP32, DFRobot Gravity 1.6MPa + 전압 분배기(R1=10kΩ/
  R2=27kΩ), Wokwi 사전 검증
- **에뮬레이터**: Node.js + `ws` 라이브러리 (`tools/firmware-emulator/`)

---

## 폴더 구조

```
pchem-lab-project/
├── web/                      # 웹 앱 (브라우저)
│   ├── index.html
│   ├── config/params.json
│   ├── css/style.css
│   └── js/ {simulation, renderer, serial, protocol, logger,
│            ai-tutor, ui, main}.js
├── firmware/                 # ESP32 펌웨어 (boyle.ino)
├── tools/firmware-emulator/  # Node.js WebSocket 에뮬레이터
└── docs/                     # 설계 문서 00~10
```

---

## 문서 안내

| 파일 | 내용 |
|---|---|
| `docs/00-project-overview.md` | 프로젝트 개요·교육 목표 |
| `docs/01-hardware-boyle.md` | 실센서 하드웨어 명세 (보일) |
| `docs/03-software-architecture.md` | 모듈 구성·데이터 흐름 |
| `docs/04-simulation-physics.md` | 시뮬레이션 물리 원칙 |
| `docs/05-data-format.md` | 프로토콜 v1.1 + CSV 포맷 |
| `docs/06-project-status.md` | 구현 현황 마스터 트래커 |
| `docs/07-ai-tutor.md` | AI 튜터 설계·프롬프트 |
| `docs/08-physics-validation.md` | 물리 정확도 검증 결과 |
| `docs/09-roadmap.md` | Phase 2-B 이후 전체 로드맵 |
| `docs/10-dev-journal.md` | 개발 일지 (의사결정 1차 자료) |
| `firmware/README.md` | 펌웨어 배선·Wokwi 설정 |
| `CLAUDE.md` | Claude Code 자동화 규약 |

---

## 개발 환경

- Node.js 20+ (에뮬레이터)
- Python 3 (정적 서버)
- Chrome/Edge (Web Serial 지원 브라우저)
- Arduino IDE 또는 PlatformIO (실물 펌웨어 플래시 시)

---

## 라이선스

라이선스 미결정 — 논문 발표 전까지 비공개 권장. 외부 인용·재사용 문의는
저장소 소유자에게 직접.
