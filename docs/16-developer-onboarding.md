# 16. 개발자 Onboarding

**문서 목적**: 새 PC 또는 신규 협업자가 본 저장소에서 처음 작업할 때
필요한 환경 준비 / 클론 / 의존성 / 실행 / 자주 막히는 곳을 한 자리에
정리한다. README 의 "빠른 시작" 을 보강하는 위치 — README 가 외부
진입점이라면 본 문서는 *작업자 진입점* 이다.

**마지막 업데이트**: 2026-04-28 (Phase 5.4 진행 중, 본인 새 PC 진입 직후 작성)

**전제 독자**:
- 본 저장소를 처음 클론하는 개발자
- 새 PC / 새 환경에서 동일 저장소를 다시 셋업하는 본인
- 학생 / 교사 협업자 (코드 수정보다 *실행* 이 주 목적인 경우)

**cross-ref**: 도메인 / 교육 목표는 `docs/00`, 현재 진행 상태는
`docs/06`, 로드맵은 `docs/09`, 의사결정 1차 자료는 `docs/10`. AI 튜터
프롬프트 / 데이터 포맷은 `docs/07` / `docs/05` 를 별도 참조.

---

## 1. 사전 준비

### 1.1 OS

Windows 10/11 / macOS / Linux 모두 동작. 본인 검증 환경은
**Windows 11** 기준. macOS / Linux 는 명령어 차이 (예: `python3` vs
`python`) 만 주의.

### 1.2 필수 설치

| 도구 | 버전 | 용도 |
|---|---|---|
| **Node.js** | LTS 20+ | `tools/firmware-emulator/` (WebSocket 에뮬레이터) |
| **Python** | 3.x (3.8+ 권장) | 정적 파일 서버 (`http.server`) |
| **Git** | 임의 | 클론 / 브랜치 작업 |
| **Chrome / Edge** | 최신 | Web Serial API (실센서) — Firefox / Safari 불가 |

`.nvmrc` / `.python-version` 파일은 **두지 않음** (의도적 — 단일 파일
유지 비용 > 가치). 위 표가 권위 있는 버전 명세.

### 1.3 권장 (선택)

| 도구 | 용도 |
|---|---|
| **VS Code** | 에디터 — `web/js/*.js`, 펌웨어 `.ino` 편집 |
| **Claude Code** | AI 코드 에이전트 — `npm install -g @anthropic-ai/claude-code`. 본 저장소는 `CLAUDE.md` 로 자동화 규약 정의 (일지 작성 / commit 형식 / push 정책 등) |
| **Arduino IDE 또는 PlatformIO** | 실물 펌웨어 플래시 (Step I 단계 진입 시) |

---

## 2. 저장소 클론

```bash
git clone https://github.com/police6980/pchem-lab-project.git
cd pchem-lab-project
```

### 2.1 브랜치 정책

- **`main`** = archive (`v0.4-boyle-complete` 시점). 새 작업은 main 직접
  하지 않음.
- **feature / phase 브랜치** 에서 작업 → 마일스톤 시 별도 PR 또는 직접
  병합 (현재는 단일 작업자 → 수동 병합 대기).
- 현재 활성 브랜치 6 종 (병합 대기): `phase3-real-sensor`,
  `feature/landing-page`, `feature/particle-controls`,
  `feature/responsive-canvas`, `feature/dalton-experiment`,
  `phase5-real-sensor` (← 현재 작업).

### 2.2 작업 브랜치 진입

```bash
git checkout phase5-real-sensor
```

브랜치 전환 후 항상 `git status` / `git log -5` 로 현재 위치 확인.

---

## 3. 의존성 설치

### 3.1 에뮬레이터 (필수 — 실센서 없을 때)

```bash
cd tools/firmware-emulator
npm install
```

- 의존성: `ws ^8.20.0` 단 1개
- 산출물: `node_modules/`, `package-lock.json`
- `.gitignore` 가 `node_modules/` 무시 — 환경마다 새로 `npm install`

### 3.2 프로젝트 root 에는 `package.json` 없음

브라우저 측 `web/` 은 빌드 도구 없는 vanilla JS — p5.js 는 CDN 로드.
**root 에서 `npm install` 시도하지 말 것** — 의미 없음.

---

## 4. 실행

### 4.1 정적 서버 (project root, 별 cmd 창)

```bash
python -m http.server 8000
```

브라우저: `http://localhost:8000/web/` → 랜딩 페이지.

### 4.2 에뮬레이터 (별 cmd 창 — 동시 실행)

```bash
cd tools/firmware-emulator
npm start                       # 보일 모드 (단일 채널)
npm start -- --mode dalton      # 돌턴 모드 (2 채널: ch0=B-receiver, ch1=A-injector)
# 또는 직접 호출:
node emulator.js --mode dalton
```

**서버**: `ws://localhost:8787` 에서 대기.

**CLI 키 입력** (`tools/firmware-emulator/emulator.js:90~139`):

| 키 | 동작 (보일) | 동작 (돌턴) |
|---|---|---|
| `↑` / `↓` | ch0 ±10 kPa | 동일 (ch0 = B-receiver) |
| `→` / `←` | ch0 ±1 kPa | 동일 |
| `w` / `s` | — | ch1 ±10 kPa (A-injector) |
| `d` / `a` | — | ch1 ±1 kPa |
| `i` | — | 주입 시뮬 (ch1→ch0 부분압력 합산, ch1=PA_MIN) |
| `r` | 모든 채널 101325 Pa 리셋 | 동일 |
| `q` / Ctrl+C | 종료 | 동일 |

### 4.3 페이지 진입

| 페이지 | URL | 비고 |
|---|---|---|
| 랜딩 (홈 + API 키 설정) | `http://localhost:8000/web/` | sessionStorage 공유 시작점 |
| 보일의 법칙 | `http://localhost:8000/web/boyle.html` | 3 모드 (Mock/WS/Real) |
| 입자운동론 | `http://localhost:8000/web/particles.html` | V·T·N·기체 조작 |
| 돌턴의 부분압력 | `http://localhost:8000/web/dalton.html` | 다채널 SensorSource (Phase 5.4) |

---

## 5. 첫 실행 검증

1. `python -m http.server 8000` 실행 중인 상태에서 4 페이지 모두 로드 확인
   (랜딩 + 3 시뮬).
2. F12 콘솔 — 에러 0 (404, JS error 없음).
3. 에뮬레이터 모드 (보일 또는 돌턴 페이지 상단 토글):
   - 토글에서 [🔌 에뮬레이터] 선택 → "● 연결됨" 표시 확인.
   - 에뮬 cmd 창에 `▶ 연결됨 (...)` 로그 확인.
4. AI 튜터 사이드바: Q1~Q4 + 자유 탭 표시. **API 키 없이도 UI 자체는
   동작** — 키 입력 시점에만 키 필요.

---

## 6. 자주 막히는 곳

### 6.1 Windows PowerShell — npm 스크립트 실행 정책

**증상**: `npm start` 시 `이 시스템에서 스크립트를 실행할 수 없으므로
... 정책에 의해 실행이 비활성화 되어 ...` 오류.

**해결 (택 1)**:
- cmd 창 사용 (`cmd.exe`) — PowerShell 정책 영향 X
- PowerShell 정책 완화: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`
  (관리자 권한 X 필요)
- 직접 호출: `node emulator.js` (`npm start` 우회)

### 6.2 npm install 위치 헷갈림

**정답**: `tools/firmware-emulator/` 안에서만 실행.

**오답 (본인 새 PC 진입 시 흔적)**: project root 에서 `npm install`.
`package.json` 부재 시 npm 이 빈 `node`, `npm`, `pchem-firmware-emulator@*`
같은 0-byte 파일 만들 수 있음 (PowerShell + 특정 npm 버전 quirk).
`.gitignore:26-29` (commit `4d40791`) 가 이 임시 파일들을 ignore —
실수해도 commit 오염 X.

### 6.3 에뮬레이터 + 정적 서버 동시 실행

둘 다 long-running 프로세스 → **별도 cmd / terminal 창 2개 필수**.
한 창에서 둘 다 못 함. tmux / Windows Terminal 탭 분할 권장.

### 6.4 WebSocket 연결 첫 시도 실패

**원인**: 페이지 먼저 로드 → 에뮬 늦게 시작. 페이지가 `ws://localhost:8787`
못 찾음 (`web/js/serial.js:355` `WebSocket 생성 실패` 또는 `:363` HELLO
timeout).

**해결 (택 1)**:
- 에뮬 먼저 시작 → 페이지 새로고침
- 페이지의 모드 토글 다시 클릭 (에뮬레이터 → 시뮬레이션 → 다시 에뮬레이터)
  → `WebSocketSensorSource` 재생성

### 6.5 포트 충돌

| 포트 | 용도 | 충돌 시 |
|---|---|---|
| 8000 | python 정적 서버 | `python -m http.server 8001` 등 다른 포트 사용. URL 도 그에 맞춰 변경 |
| 8787 | 에뮬 WebSocket | 종료 안 된 이전 에뮬 cmd 창 확인. 변경 시 `emulator.js:26` + `web/js/serial.js:331` 동시 수정 (둘 다 hardcoded) |

### 6.6 Web Serial 권한 (실센서 모드)

- Chrome / Edge 최신 버전만 (`web/js/serial.js:185` 명시 에러).
- Firefox / Safari → 불가.
- Windows: USB 드라이버 (CP210x / CH340) 사전 설치 필요할 수 있음
  (ESP32 보드 칩셋에 따라).
- 첫 [⚡ 실센서] 클릭 시 브라우저 권한 dialog → 포트 선택.

### 6.7 Claude API 키

- 위치: 랜딩 페이지 (`/web/`) 의 API 키 입력란. 또는 실험 페이지의 AI
  튜터 사이드바 [🔑] 영역.
- 저장: `sessionStorage` (key=`pchem_api_key`). **탭 닫으면 휘발** — 새로고침
  시는 유지.
- 발급: Anthropic Console (`console.anthropic.com`) → API Keys.
  `sk-ant-...` prefix.
- 모델 / 학생 수준도 같은 sessionStorage 공유 (3 시뮬 동일 — 한 번 설정 →
  3 페이지 자동 인식).

### 6.8 학생 수준 / 모델 select

- 위치: AI 튜터 사이드바 상단 (3 시뮬 동일).
- 학생 수준: `elem` (초등) / `middle` (중등) / `high` (고등 — default) /
  `univ` (대학).
- 모델: `claude-sonnet-4-6` (default) / `claude-opus-4-7` /
  `claude-haiku-4-5`.
- **본 세션 변경**: 입자운동 16 질문 본문이 수준별 차등 (보일/돌턴은 이전
  부터 차등) — 신규 협업자가 이전 평가 재현 시 수준 select 영향 인지.

### 6.9 sensor 시스템 (Phase 5.4 신규 권위)

ws/real 모드 디버깅 / 노이즈 검증 시 권위 위치 — 본 §은 cross-ref만, 상세는 각 권위 문서:

- **A-1 노이즈 시나리오 모드** (off / quiet / normal / harsh) — `tools/firmware-emulator/README.md` §4. 에뮬 CLI 키 `n` (토글) / `1-4` (preset 직접). 실물 SEN0257 추정 σ=2~4 kPa = `normal` preset 일치.
- **outlier 가드 5 단계** (NaN / 음수 / saturation / median spike / state 갱신) — `docs/03-software-architecture.md` §3.8. ws/real 데이터 silent guard, mock 영향 X.
- **baseline.js 노이즈 특성 정량화** — `tools/firmware-emulator/README.md` §7 / `tools/firmware-emulator/baseline.js`. WebSocket 데이터 60초 수집 → σ / maxSpike / drift JSON 저장. 회귀 테스트 baseline.
- **시나리오 회귀 테스트** (`run-scenario.js` / `run-all.js`) — `tools/firmware-emulator/README.md` §7. emulator spawn → judge → 종료 코드 기반. CI 친화.

---

## 7. AI 튜터 사용

1. API 키 설정 (위 6.7).
2. 학생 수준 / 모델 선택 (위 6.8).
3. **Q1~Q4** = 학습 단계 질문 / **💬 자유** = 자유 질문.
4. **Q4 = 메타 탭** (📊 [질문 생성]) — Phase 5.4 에서 보일/돌턴 Q3↔Q4
   swap. 메타 탭은 학생이 *질문 자체* 를 만들도록 유도.
5. **보고서 생성** (보일): 측정 3 회 + Q1/Q2/Q3 학습 대화 완료 시 활성.
   `.docx` 자동 생성.

상세 프롬프트 / 시뮬별 system prompt: `docs/07-ai-tutor.md`.

---

## 8. 작업 흐름

### 8.1 commit author

```
police6980 <police6980@gmail.com>
```

신규 PC 에서 `git config user.name` / `user.email` 확인 — 다르면 위 값
설정.

### 8.2 push 정책

- **사용자 명시 지시 시만 push**. 자동 push X.
- 로컬 commit 까지가 기본. push 는 별도 요청 후.
- 근거: 작업 도중 의도하지 않은 강제 동기화 방지 (`CLAUDE.md:69`).

### 8.3 일지 작성 (`docs/10-dev-journal.md`)

본 저장소의 가장 중요한 자산 — **논문 작성 1차 자료**.

| 시점 | 내용 |
|---|---|
| 마일스톤 완료 | 여러 commit 묶음의 의사결정 정리 |
| 세션 종료 | 다음 세션에 휘발 방지 |
| Phase 전환 | 최후 보루 |

각 결정 블록 필수 4 요소: **배경 / 결정 / 근거 / 배제된 대안**.
형식 / 톤 / Phase 구조 등 상세는 `CLAUDE.md` 의 "개발 일지 유지 지침"
섹션 참조.

### 8.4 commit 메시지 형식

conventional commits 한글 본문. 예시:

```
docs(journal): <범위 요약> — Phase N <subphase>

- <핵심 결정 1>
- <핵심 결정 2>
```

타입: `feat` / `fix` / `chore` / `docs` / `refactor` / `revert`.
스코프: 시뮬 또는 모듈명 (`dalton` / `boyle` / `particles` / `tutor` /
`emulator` / `serial` / `gitignore` / `journal` 등).

### 8.5 Claude Code 상호작용

`CLAUDE.md` 가 자동화 규약 (일지 작성 / commit 형식 / push 정책 / 톤).
"일지 작성해줘" / "일지 업데이트" 같은 요청 시 자동 처리.
`.claude/settings.local.json` 은 로컬 권한 — `.gitignore` 에 의해 무시됨.
신규 PC 에선 빈 상태이므로 첫 실행 시 권한 prompt 다시 받음.

---

## 9. 다음 단계 — 추가 자료

| docs | 언제 보나 |
|---|---|
| `docs/00-project-overview.md` | 프로젝트 개요 / 교육 목표 — 비-개발자 협업자 진입 시 |
| `docs/03-software-architecture.md` | 모듈 구성 / 데이터 흐름 — 코드 진입 시 |
| `docs/05-data-format.md` | 프로토콜 v1.1 + CSV — 센서 작업 시 |
| `docs/06-project-status.md` | 마스터 트래커 — "어디까지 왔는가" |
| `docs/07-ai-tutor.md` | AI 튜터 프롬프트 변경 시 |
| `docs/09-roadmap.md` | 전체 Phase 로드맵 |
| `docs/10-dev-journal.md` | 의사결정 1차 자료 — "왜 이렇게 짰는가" |
| `docs/11-dalton-design.md` | 돌턴 시뮬 작업 시 + 브랜치 전략 예시 |
| `docs/12-protocol-v1.2.md` | 멀티채널 프로토콜 (Phase 5.4) |
| `docs/13-multi-channel-interface.md` | multi-channel SensorSource (Phase 5.4) |
| `docs/14-calibration-pipeline.md` | 실센서 캘리브레이션 (Phase 5.4) |
| `docs/15-params-config-guide.md` | params.json + SCENE + gases 권위 (Phase 5.4) |
| `docs/19-real-sensor-integration-checklist.md` | 실물 도착 시 Step I 단일 절차서 (Phase 5.4) |
| `tools/firmware-emulator/README.md` | 에뮬 권위 (CLI 키 / 노이즈 4 모드 / 시나리오 회귀) |
| `firmware/README.md` | 실물 펌웨어 플래시 (Step I 진입 시) |
| `CLAUDE.md` | Claude Code 협업 시 필수 |
