# 07. AI 튜터 설계

**문서 목적**: AI 튜터의 설계 철학, 구조, 프롬프트, 운영 정책을 종합 정리한다. 논문·연구 발표 시 방법론 근거 자료로 사용하며, 구현 세부는 다른 문서에 위임한다.

**마지막 업데이트**: 2026-05-08 (Phase 5.9 D-(2)/(3)/(4)/(5) 완료 표기. Phase 5.5 = AI 튜터 설정 패널 기본 열림. Phase 5.4 = Q3 ↔ Q4 swap + 입자운동 16 질문 차등 + 비활성 버그 fix).

**Phase 5.9 추가 (2026-05-07 ~ 08, D-(2)/(3)/(4)/(5))**: 4 트랙 완료. (1) D-(3) dataSource 4종 분기 (mock/ws/real/vernier) — Boyle (`ui.js:1754-1789`) 에 vernier 케이스 추가, Dalton (`main.js:3324-3416`) 에 분기 자체 첫 도입. Vernier 모드 학생이 sim 가이드를 받던 정합성 어긋남 정정. Vernier substate 컨텍스트 (Dalton 한정 — `daltonState.vernier` 4 필드) + 비교 모드 + Vernier 동시 정책 추가. (2) D-(4) Vernier 모드 측정 records 연동 — `addVernierRecord()` + record.mode 필드 + formatRecordLine helper. (3) D-(2) Q1~Q4 인지 흐름 재설계 (관찰/해석/예측·검증/메타, Bloom 흐름) + 16개 본문 학생 데이터 anchor (high/univ 동적 placeholder). (4) D-(5) 응답 가드 소크라테스식 — 절대 원칙 11~13 + Few-shot 3개. 상세: §4.6 데이터 소스 분기 (§4.6.4~7).

**Phase 5.5 추가**:
- **설정 패널 기본 열림** — 3 시뮬 (보일 = `ai-tutor.js:1054` / 돌턴 = `main.js:3155` / 입자운동 = `ui.js:2129`) 모두 첫 진입 시 펼침. ⚙ 클릭 토글 동작 유지. 진입 장벽 ↓ — 학생 모델 / 사용량 / 키 즉시 인지.
- 보고서 출력 = docx 단일 (PDF 출력 시도 후 폐기 — docx 와 중복 + html2canvas 차트 캡처 불안정).

**Phase 5.4 변경 요약**:
- **Q3 ↔ Q4 swap (보일/돌턴)**: 학습 흐름 = Q1~Q3 학습 질문 → Q4 메타 인지 (📊 질문 생성). 본문 swap (4 levels × 2 위치) + `btn-generate-q3` → `btn-generate-q4` ID rename + 핸들러 / `aiConversations` key / 다운로드 라벨 swap. 보고서 코드 변경 X — 위치 기반 (Q1/Q2/Q3 conversations) 그대로 사용 → 의미 자동 정합. 옵션 (c) hybrid 채택 (옵션 a 단순 swap = 보고서 의미 어긋남, 옵션 b 전면 swap = 변경 폭 큼).
- **입자운동 16 질문 차등**: 기존 flat 5 tab (모든 level 동일) → `{ elem, middle, high, univ } × { Q1~Q4, free }` (16 신규 질문 + 공유 free). `getAdvQuestionText(level, qid)` helper (level fallback `high`). `setActiveTab` + `buildSystemPrompt` 모두 helper 사용 — UI snippet / AI 프롬프트 동시 차등. level 변경 핸들러에 snippet 즉시 갱신 추가. 보일/돌턴 패턴 일관.
- **입자운동 ai-tutor.js 비활성 버그 fix**: particles.html 의 `<script src="js/ai-tutor.js">` 로드 제거. 원인 = ai-tutor.js 의 `updateTabAvailability` 가 `.ai-sidebar` 셀렉터로 입자운동 탭에도 영향 → 모든 탭 `aria-disabled="true"`. `createAdvAiTutor` 는 자체 핸들러 + measurement 변동 시 ai-tutor.js 의 `updateTabAvailability` 재호출 X → 영원히 시각 비활성. dalton 패턴 따름 (dalton 도 createDaltonTutor 자체 처리, ai-tutor.js 미사용).

**Phase 5.3 변경 (2026-04-26)**: **돌턴 AI 튜터 추가**. 보일/입자운동/돌턴 3 페이지 모두 AI 튜터 동작. 돌턴은 `createDaltonTutor` 자체 closure (입자운동 패턴, `ai-tutor.js` 의존 X). 4 학습 목표 (분자 수 보존 / 부분 압력 / 합 = 전체 / 시뮬 ↔ 이론), Q1~Q4 × 4 학생 수준 = 16 문항, F1 비교 모드 통합 (`comparisonSelected` 2개 시 두 record 자동 주입), `[[LEVEL:xxx]]` 자동 학생 수준 갱신, MODEL_PRICING 자체 정의 (Sonnet 3/15, Opus 5/25 USD per MTok). 상세 결정: `docs/10-dev-journal.md` § Phase 5.3 의 AI 튜터 결정 2건.

**구현 단계**: Part 3.5 완료 (대화 UI) → **Part 4 / Phase 2-B 완료** (실 Anthropic Messages API 연동, 멀티턴 대화, 비용 표시, docx 보고서, Q3 자동 생성, Q4 탭, 수준 자동 감지 원칙 9/10). 본 문서 본문의 "Part 4 예정" 표시는 설계 시점 기록 보존 차원에서 유지하며, **해당 항목 대부분은 구현 완료**됨.

---

## 1. 설계 철학

### 1.1 왜 AI 튜터가 필요한가

영재 교육의 핵심은 **학생의 자기 발견**이다. 그러나 탐구 과정에는 학생이 막히는 순간, 확장 질문이 필요한 순간, 오개념이 드러나는 순간이 있다. 교사 1명이 영재반 전체에 동시에 반응하기는 어려우므로 AI 튜터가 **교사를 대체하지 않으면서 보완**한다.

이 시스템은 "정답을 주는 기계"가 아니라 **학생이 자기 답변 위에서 한 걸음 더 나아가도록 돕는 확장 장치**로 설계된다.

### 1.2 절대 원칙 (AI 튜터가 하지 말 것)

1. **학생이 스스로 할 수 있는 사고를 대신 해주지 않는다.** 답을 주는 대신 질문으로 확장한다.
2. **결론·정답을 선제적으로 던지지 않는다.** 학생이 도달하기 전에 목적지를 제시하지 않는다.
3. **학생 답변을 평가·채점하지 않는다.** "잘했어요/틀렸어요"가 아니라 "여기를 한 번 더 보세요" 형태.
4. **시뮬레이션 조작을 대신해주지 않는다.** 학생 주체성은 실험과 측정에서 보존되어야 한다.
5. **교사의 판단을 가로막지 않는다.** AI의 반응은 최종 평가가 아니며, 교사가 CSV를 통해 학생·AI 상호작용을 검토할 수 있다.

### 1.3 역할 요약

- **확장 질문자**: 학생 답변 위에 한 단계 더 깊은 질문
- **데이터 해석 조수**: 학생이 놓친 숫자·패턴을 언급
- **자유 탐구 파트너**: 구조화 질문 밖의 호기심을 받아주는 공간
- **오개념 거울**: 오개념을 직접 교정하지 않고, 학생이 스스로 확인할 실험 방법을 제시

---

## 2. 구조 (Part 3.5 기준)

모듈 코드 세부는 `docs/03-software-architecture.md` §2.2 `ai-tutor.js` 참조. 여기서는 **설계 관점**에서 요약한다.

### 2.1 UI 구조

우측 사이드바 (`<aside id="ai-sidebar">`), 380 px 고정폭 sticky. `<body>`는 flexbox 좌우 2분할 (`main-area` flex:1 + `ai-sidebar` 380px).

구성 요소:
- 헤더: `⚙` 설정 토글 · `×` 사이드바 접기
- 접이식 설정 패널: API 키 · 학생 수준 · 모델 선택 · 경고 배너 · 사용량 표시
- 탭 5개: `Q1 | Q2 | Q3 | Q4 | 💬 자유`. **Q4 = 메타 탭 (📊 [질문 생성])** — 학생이 자기 데이터에 맞는 탐구 질문을 생성하는 메타 인지 위치 (Phase 5.4 swap 후, 보일·돌턴·입자운동 3 시뮬 일관)
- 질문 컨텍스트 미리보기
- 메시지 영역 (자동 스크롤)
- 입력창: `Enter` 전송, `Shift+Enter` 줄바꿈
- (Part 4 예정) 타이핑 인디케이터 · 비용 경고 배너 · [세션 초기화] 버튼

### 2.2 대화 세션

질문별 독립 세션이 5개 운영됨 (Phase 5.4 swap 후 — Q4 = 메타 탭, 위치 키 그대로).

```js
aiConversations = {
    1:    { messages: [], tokensIn: 0, tokensOut: 0 },
    2:    { messages: [], tokensIn: 0, tokensOut: 0 },
    3:    { messages: [], tokensIn: 0, tokensOut: 0 },
    4:    { messages: [], tokensIn: 0, tokensOut: 0 },  // Q4 = 메타 탭 (📊 질문 생성)
    free: { messages: [], tokensIn: 0, tokensOut: 0 },
}
```

각 `message`는:
```
{ role: "user" | "assistant", content: string, timestamp: number,
  tokensIn?: number, tokensOut?: number, model?: string }
```

저장 위치: **메모리 내 `aiConversations`**. sessionStorage 등 영구 저장 없음. 페이지 새로고침 시 손실되며, CSV로 내려받지 않은 대화는 사라진다.

### 2.3 탭 활성 조건

| 탭 | 활성 조건 |
|---|---|
| Q1 / Q2 / Q3 | 측정점 수 ≥ 3 (`datapoints.length >= 3`) — 학습 질문, 데이터 누적 후 활성 |
| Q4 (📊 질문 생성, 메타) | 측정점 수 ≥ 3 — 자기 데이터 기반 메타 인지 |
| 💬 자유 | 항상 활성 |

비활성 탭 클릭 시 2.5 초간 빨간 안내 토스트: **"측정점을 3개 이상 기록한 뒤 사용할 수 있습니다."**

이 게이트는 **실험 과정 보호**를 위한 것이다. 학생이 측정 없이 AI와만 대화하는 것을 막고, 정량 데이터 수집을 선행시킨다.

### 2.4 파일 구성

- `web/js/ai-tutor.js`: 보일 전용 **풀 AI 튜터** — 상태·렌더링·이벤트·실 Anthropic API 호출·Q3 자동·Q4 마무리·보고서 docx 생성·수준 자동 감지·토큰 비용 추적
- `web/js/ui.js createAdvAiTutor`: 입자운동(particles.html) 전용 **경량 AI 튜터** — 자체 완결된 멀티턴 채팅, 토큰 추적·보고서·Q3 자동 등 고급 기능은 의도적 미포함. **Phase 5.4** 부터 4 levels × Q1~Q4 = 16 질문 차등 (보일/돌턴 패턴 일관). `getAdvQuestionText(level, qid)` helper 가 UI snippet + AI 시스템 프롬프트 양쪽에서 동일 본문 사용. **particles.html 은 ai-tutor.js script 로드 X** — 공통 모듈의 `.ai-sidebar` 셀렉터가 입자운동 탭에도 영향 → 비활성 버그 회피 (dalton 패턴 동일)
- `web/boyle.html`: 보일 페이지 AI 사이드바 DOM (`#ai-sidebar`, id prefix 없음)
- `web/particles.html`: 입자운동 페이지 AI 사이드바 DOM (`#adv-ai-sidebar`, id `adv-*` prefix)
- `web/index.html` (랜딩): API 키 입력·저장·삭제 UI **단일 진입점**. sessionStorage `pchem_api_key` 로 두 실험 페이지와 공유
- `web/css/style.css`: 사이드바 레이아웃·말풍선 (3 페이지 공유)
- `web/js/ui.js createAnalysisPanel` (클로저): 보일 측 BYOK 관련 함수 (`verifyKey`, `clearKey`, `updateUsageDisplay`) — 현재 입력 UI 가 실험 페이지에서 제거되어 이벤트 배선이 null 가드로 차단됨 (dead code, 재사용 여지 유지). 프롬프트 빌더 (`buildSystemPrompt`, `buildUserPrompt`, `buildDataContext`) 는 활성

Phase 2-B에서 `ai-tutor.js`의 `fakeApiDelay` + `generateDummyAiResponse`를 Anthropic Messages API 실 호출로 교체한다.

---

## 3. BYOK (Bring Your Own Key) 패턴

### 3.1 선택 근거

- **백엔드 서버 불필요** — 정적 호스팅(GitHub Pages)만으로 운영
- **비용 책임 분산** — 학생·교사가 자기 Anthropic 계정으로 호출, 플랫폼 운영자 비용 0
- **개인정보 처리 책임 단순화** — 플랫폼이 키·대화의 중간자가 되지 않음
- **MVP·연구 단계에 적합** — 빠른 배포, 소규모 검증에 유리

### 3.2 보안 원칙

- **저장 위치**: **sessionStorage만 사용** (`localStorage` 금지)
  - 탭을 닫으면 자동 소멸 → 공용 컴퓨터 리스크 완화
  - XSS 완전 방어는 아니지만 `localStorage`보다 노출 창이 짧음
- **저장 키**: `pchem_api_key`, `pchem_ai_level`, `pchem_ai_model`
- **키 표시**: 마스킹 (`sk-ant-api03-xxxx...xxxx`), 포커스 시만 원값 표시
- **저장 전 검증**: Anthropic `/v1/messages` 에 `claude-haiku-4-5` 모델로 최소 호출(토큰 5개)하여 유효성 확인
- **경고 배너**: 설정 패널 하단에 "공용 컴퓨터 사용 후 반드시 [키 삭제]" 상시 표시
- **운영 전환 시점**: 서비스화(공식 배포·학교 보급) 단계로 가면 **반드시 서버 프록시로 전환**

### 3.3 한계와 수용

BYOK는 완벽한 키 보호를 제공하지 않는다. 다음을 수용한다:
- 브라우저 DevTools로 sessionStorage 열람 가능
- 네트워크 탭에서 API 호출 확인 가능
- XSS 취약점이 있으면 키 유출 가능 (현재 `escapeHtml` 및 `<script>` 주입 검토 최소한만 적용)

완화 방안:
- 사용자 교육 (API 키 발급 가이드 · 공용 컴퓨터 주의 · 월 사용량 한도 설정 권장)
- Anthropic 콘솔에서 키 발급 시 **월 사용량 한도 설정 권장** (예: $5/월)
- 키 범위를 최소화(해당 프로젝트 한정 key 발급)하도록 가이드

---

## 4. 시스템 프롬프트 설계

### 4.1 현재 `buildSystemPrompt(level, questionNum)` 전문 (ui.js:1774, 보일 기준 — Dalton 은 §4.6 참조)

```
당신은 영재 과학교육 튜터입니다.

대상 학생: {LEVEL_GUIDES[level]}

현재 탐구 주제: 보일 법칙 (P·V = 일정, 등온 조건)
현재 질문의 교육적 의도: {QUESTION_FOCUS[questionNum]}

절대 원칙:
1. 학생이 아직 생각하지 못한 답을 직접 알려주지 마세요. 학생의 답변을 인정하고 한 단계 더 깊은 질문을 던지세요.
2. 학생 답변의 구체적 표현을 인용하며 피드백하세요. 일반론 금지.
3. 학생 데이터의 구체 숫자를 언급하며 연결하세요.
4. 격려하되 과찬 금지. 틀린 부분은 명확히 짚되 비난 금지.
5. 250자 이내. 한 번의 피드백에 한 가지 핵심 확장만.
6. 마지막에 학생이 더 생각해볼 질문 1개 제시.

한국어로 답변하세요.
```

### 4.2 질문별 Focus (`QUESTION_FOCUS`)

**Q1 — 메커니즘 설명**
> 거시 관찰(P·V 일정)을 미시 메커니즘(입자 운동)으로 설명하도록 유도. 학생 답변이 피상적이면 '입자가 벽에 부딪히는 빈도·강도'와 '부피 변화의 관계' 방향으로 질문으로 확장.

**Q2 — 극단 조건 외삽**
> 관찰한 규칙을 극단 조건에 외삽하도록 유도. 이상기체와 실제 기체의 차이(반데르발스 편차) 언급 가능. 학생이 단순 계산만 했으면 '모델의 한계'로 사고 확장 유도.

**Q3 — 다음 실험 설계**
> 학생이 제안한 조건의 과학적 의미를 확장. 샤를 법칙, 게이뤼삭 법칙, 이상기체 법칙 등 관련 개념 자연스럽게 소개 가능.

**Q4 — 메타 탭 (📊 질문 생성, Phase 5.4 swap 후)**
> 학생이 자기 측정 데이터에 맞는 탐구 질문을 직접 생성. AI 는 학생의 측정 패턴 / 이상값 / 흥미로운 추세를 짚어 학생 수준에 맞는 탐구 질문 1~3 개 제시 (정답 X, 질문 X). 학생 자기 질문이 학습 목표라 보고서 CSV 의 "AI 튜터 대화" 섹션에는 미포함 (Q1/Q2/Q3 학습 본문만 보고서 평가 대상).

**자유 모드**
> 자유 질문 — 직접 답해도 되지만 마지막에 한 단계 깊은 탐구 방향을 한 문장 제안. 400자 이내. 모든 학생 수준 동일 본문 (level 무관, `ADV_TUTOR_FREE_TEXT` 상수로 분리).
> - 답을 직접 줘도 됨 (구조화 질문과 달리)
> - 답 뒤에 한 단계 더 깊은 탐구 방향을 한 문장 덧붙임
> - 오개념 발견 시 직접 교정하지 않고 **실험으로 확인할 방법** 제시

### 4.3 학생 수준별 가이드 (`LEVEL_GUIDES`)

```
middle (중학교 2-3학년 영재학급):
  기본 분자 운동론은 알지만 깊은 통계역학은 모름.
  친근한 톤, 어려운 용어 설명 동반.

high (고등학교 영재학급):
  이상기체 상태방정식, 간단한 통계역학 개념 가능.
  과학적 엄밀성 유지하되 학생 사고를 존중.

univ (대학교 일반화학/물리화학 초기):
  맥스웰-볼츠만 분포, 반데르발스 방정식 수준 개념 사용 가능.
```

기본값: `high` (설정 패널 드롭다운 selected).

### 4.4 사용자 프롬프트 구조 (`buildUserPrompt`)

```
[실험 데이터]
온도: {tempC}°C ({tempK}K)
측정점: {N}개
평균 P·V: {meanPV} kPa·mL
최대 편차: {maxDev}%

측정점 상세:
  1번: P={P}kPa, V={V}mL, P·V={PV}
  2번: ...
  ...

[질문]
{QUESTION_TEXT[questionNum]}

[학생 답변]
{answer}

위 학생 답변에 대해 영재 교육 튜터로서 피드백해주세요.
```

모든 사용자 프롬프트에 **현재 실험의 실제 숫자 컨텍스트**가 포함된다. AI가 "학생 데이터의 구체 숫자를 언급하며 연결"하도록 강제하는 구조.

### 4.5 Part 4 추가 예정 원칙

현재 프롬프트는 **단발 피드백용**으로 작성됐다. Part 4 multi-turn 대화에서는 다음 항목이 추가된다:

7. 대화형이므로 결론 짓지 말고 다음 생각으로 이어지는 질문으로 마무리
8. 3~4턴 이상 진행 시 자연스럽게 학생이 답에 다가가도록 수렴
9. 이전 턴의 학생 답변·AI 응답을 `messages` 배열로 전체 누적 전송 (맥락 유지)
10. 대화 턴 수가 8회를 넘으면 시스템이 [세션 초기화]를 제안

### 4.6 데이터 소스 분기 (Phase 5.5~5.9, Phase 6.4 vapor 통합)

**도입 배경**: 학생이 mock(시뮬) · ws(에뮬레이터) · real(ESP32 자작) · vernier(상용 BLE) 4 모드 중 어느 것을 쓰는지에 따라 측정 데이터의 성격이 다르다. 동일 프롬프트로 모든 모드를 다루면 vernier 학생에게 "이상기체 법칙이 정확히 성립" 같은 sim 가이드가 나가는 정합성 어긋남 발생. Phase 6.4 fixup 17a 에서 vapor 페이지도 본 분기 패턴 정합 (단 현재 mock 만 active, ws/real/vernier 는 Phase 6.3+ 예약).

#### 4.6.1 분기 패턴 (4종)

| mode | dataSource 라벨 | sensorGuide 톤 |
|---|---|---|
| `mock` | 시뮬레이션 (입자 시뮬, P 직접 산출) | 이상기체 법칙 성립, 이론 중심. (Dalton 한정) 분자 수 보존·부분 압력 가산성·입자 시각 강조 |
| `ws` | 펌웨어 에뮬레이터 (개발용 가짜 센서) | 노이즈 X, 측정 절차는 가능하나 오차 해석 지양 |
| `real` | 실물 센서 (ESP32 + 압력 센서) | 측정 오차·기밀·드리프트 적극 반영, 시린지 눈금 직접 읽기 전제 |
| `vernier` | Vernier GDX-GP (상용 BLE 압력 센서) | ±3 kPa 검정 정확도. 노이즈 ↓ 이지만 기밀·드리프트 여전. 비이상성·측정 절차 분석 유도. **records.P_A/P_B/n_*=null** (분압·분자수 산출 불가, mode='vernier' 식별 — D-(4)) |

**구현 위치**:
- Boyle: `ui.js:1754-1789` — `buildDataContext.dataSource` 4종 + `buildSystemPrompt.sensorGuide` 4종
- Dalton: `main.js:3324-3416` — `buildDataContext` 콜백에서 `daltonSensorManager.mode` 직접 접근 (같은 closure) → `daltonBuildSystemPrompt(level, qid, ctx)` 의 `ctx.mode` 경유
- 입자운동 (`ui.js:2235` `createAdvAiTutor`): dataSource 분기 X. 입자운동은 모드 운용 시나리오와 무관한 시뮬 전용 페이지라 추가 작업 X (현 보존)
- **Vapor**: `main.js:4484+` `initVaporTutor` — `vaporConfig + buildDataContext.mode "mock"`. Phase 6.3 ws/real/vernier 예약 (4 데이터 소스 분기 정합). factory 재사용 (`tutor.js` 자체 변경 0). 자세 자세 = §4.6.5 + `docs/17` §14.

**vernier 본문 인용 (시뮬별 분량 차이 시각화)**:

Boyle vernier (~110자, 단일 P·V 법칙 성격):

```
[데이터 소스 고려사항]
현재는 **Vernier GDX-GP** (상용 BLE 압력 센서, ±3 kPa 검정 정확도) 실측 환경: 노이즈는 적지만 시린지 기밀·온도 드리프트 등 실험 현실 요인은 여전히 존재. 측정값과 이상기체 이론값의 차이를 기체 비이상성·측정 절차 측면에서 분석하도록 유도.
```

Dalton vernier (~290자, Phase 5.9 운용 시나리오 5요소 반영):

```
[데이터 소스 고려사항]
현재는 **Vernier GDX-GP** (상용 BLE 압력 센서, ±3 kPa 검정 정확도) + **콕 결합 셋업** (3-way 콕은 A·B 연결 위치 고정, GDX는 측정 포트). 측정 단계 = 1번 클릭으로 결합 시스템 초기 P_initial 캡처 → 학생이 A 시린지 누름 → 평형 후 2번 클릭으로 P_total 캡처. **1센서 운용 한계**: P_A·P_B 동시 측정 불가, 시작·끝 두 점만 의미 있음 — Dalton 법칙 검증은 평형 P_total 비교로 진행. V_A_current 는 V_A' = P_initial·(V_A+V_B)/P_current − V_B 역산으로 학생 누름 정도 실시간 추정. 이론값: P_total = P_initial·(V_A+V_B)/V_B.
```

분량 차이 사유: Boyle = 단일 법칙 컨텍스트 / Dalton = 콕 셋업·단계별 측정·1센서 한계·역산식·이론식 5요소. 톤 일관성보다 정보 충실성 우선 (일지 결정 — 옵션 A 채택).

mock/ws/real 본문은 각 시뮬 코드 직접 참조 (Boyle `ui.js:1782-1789` / Dalton `main.js:3378-3384`).

#### 4.6.2 Vernier substate 컨텍스트 (Dalton 한정)

`daltonState.vernier` substate (Phase 5.9 작업 1~4 도입):

| 필드 | 타입 | 의미 |
|---|---|---|
| `stage` | string | `IDLE` / `INJECTING` / `STABILIZING` / `READY_TO_CAPTURE` / `CAPTURED` 5상태 |
| `P_initial_kPa` | number\|null | 1번 클릭 캡처값 (결합 시스템 초기 압력) |
| `P_total_kPa` | number\|null | 2번 클릭 캡처값 (평형 후 P_total) |
| `V_A_current_mL` | number\|null | T 소거 식 역산: `P_initial·(V_A+V_B)/P_current − V_B` |

**`buildDataContext` 반환 객체 (Dalton)**:

```js
{
    mode: daltonSensorManager.mode,       // "mock" | "ws" | "real" | "vernier"
    records: daltonState.measurementRecords,
    comparisonSelected: daltonState.comparisonSelected,
    V_A: daltonState.syringeA.volume,     // 모든 모드 공통
    V_B: daltonState.syringeB.volume,
    vernier: { stage, P_initial_kPa, P_total_kPa, V_A_current_mL },  // vernier 모드만 표시
}
```

**시스템 프롬프트 표시 형식** (vernier 모드 진행 중 가정):

```
[현재 시린지 부피] V_A=80 mL, V_B=50 mL
[Vernier 측정 진행 상태] stage=READY_TO_CAPTURE, P_initial=101.32 kPa, P_total=미측정, V_A_current=72.4 mL
```

`null` → "미측정" 한국어화. `stage` 는 영문 보존 (코드 일관성).

**비교 모드 + Vernier 동시 정책**: 학생이 측정 기록 비교 체크 (`comparisonSelected.length === 2`) 와 Vernier 측정 진행 (`mode === "vernier"`) 동시인 경우, 두 블록 모두 표시 + 시스템 프롬프트에 1줄 우선순위 가이드 추가:

> 학생이 비교 모드를 체크하고 동시에 Vernier 측정 진행 중입니다. 비교 분석을 우선하되, 진행 중인 측정도 인지해 답하세요.

#### 4.6.3 톤 정책 (Boyle 패턴 미러링 + Dalton 보강)

**미러링 원칙**: Dalton 분기 신설 시 Boyle (Phase 5.5 1차 검증 완료) 의 dataSource 라벨·sensorGuide 톤을 그대로 따른다. 두 시뮬 모두 영재 과학교육·동일 학생 대상이라 톤 통일이 자연스럽고, 1차 검증 본문 재사용으로 회귀 위험 ↓.

**Dalton 보강**:
- mock 본문: Dalton 학습 주제 (분자 수 보존·부분 압력 가산성·입자 시각) 1문장 추가
- vernier 본문: Phase 5.9 운용 시나리오 5요소 신규 (Boyle 본문엔 없음)

**중복 회피**: Dalton 만의 차별점 (분자 수·부분 압력) 은 sensorGuide 가 아니라 본문 다른 곳의 학습 목표 4 핵심에서 다룬다 — 이중 명시 회피.

#### 4.6.4 Phase 5.9 D-(3) 완료 표기

**commits**:
- `8cb741e` — feat(tutor): Boyle 튜터 dataSource·sensorGuide 분기에 Vernier 추가 (+9/-6)
- `10ae103` — feat(tutor): Dalton 튜터 데이터 소스 분기 신설 + Vernier 운용 시나리오 (+51/-1)

**일지**: `docs/10-dev-journal.md § Phase 5.9 2026-05-07`

**후속 의무**:
- 부피 고정 기구 도착 후 V_A_current_mL 시각 검증 + Vernier sensorGuide 본문 응답 품질 평가 → 분량 단축 여부 재결정 (현 vernier 본문 ~290자 = 5요소 반영 우선, 실측 단계에서 약점 발견 시 단축)
- 작업 D-(4) 측정 데이터 연동 점검 / D-(5) 응답 가드 (소크라테스식) 진입 시 본 §4.6 보강 가능


#### 4.6.5 Phase 6.4 fixup 17a vapor AI 튜터 통합

**Phase 6.4 예약 실행**: `tutor.js` 헤더 docstring 안 "Phase 6.4 예약: vapor 도 본 factory 사용 예정" (Phase 6.1-a `b3972b3` 선언) → fixup 17a (`f0acb06`) 실행. tutor.js 자체 변경 0 (factory + 공통 logic 그대로). 페이지 간 UX 일관성 (boyle/particles/dalton/vapor 동일 사이드바 + 학습 흐름).

**vaporConfig 명세** (요약):

```js
const vaporConfig = {
    simName: "vapor",
    sidebarSelector: "#ai-sidebar",
    tabIds: ["1", "2", "3", "4", "free"],
    metaTabId: "4",
    closeConfig: { /* default prompt */ },
    reportEnabled: false,
    getQuestionText: vaporGetQuestionText,
    buildSystemPrompt: vaporBuildSystemPrompt,   // 학습 목표 4 + 절대 원칙 12 + 시뮬 시각 단서 활용
    buildDataContext: () => ({ /* T / P / 평형 5-state / measurementPoints / mode "mock" */ }),
    onLevelDetect: (level) => { /* 학생 수준 자동 감지 */ },
};
window.PchemTutorModule.createTutor(vaporConfig);
vaporTutor.init();   // ← fixup 17b 누락 수정 (silent regression 본질, dalton:3492 동일 패턴)
```

**VAPOR_LEVEL_GUIDES** (4 수준):
- **elem (초등)**: 입자 운동 직관 + 액체↔기체 변화 정성.
- **middle (중등)**: 동적 평형 개념 + 온도 의존성 정성.
- **high (고등)**: 클라우지우스-클라페롱 식 정성 + 평형 정량 (P_eq(T)).
- **univ (대학)**: ln P vs 1/T 직선 + ΔH_vap 도출.

**VAPOR_QUESTION_TEXT** (4 수준 × 5 탭 = 20):
- Q1 동적 평형 / Q2 T 효과 / Q3 시뮬 vs 이론 / Q4 메타 (자동 생성) / free 자유 질문.

**vaporBuildSystemPrompt — 시뮬 시각 단서 활용 권장**:
- rate 그래프 두 곡선 만남 (정성적 평형, fixup 7~14 진화).
- 압력계 + LCD 시계 + 입자 막대 (fixup 15s Johnstone 3수준 통합).
- 평형 5-state 배지 (fixup 15n).
- 화살표 자연 fade (fixup 15a v4 사건 빈도 시각).
- 형광 색 (fixup 8 노랑 + 핑크 사건 강조).

**buildDataContext 반환 객체 (vapor)**:

```js
{
    T_celsius,                       // tInput.value (학생 입력)
    P_kPa,                           // world.pressureKPa (mock=시뮬값)
    V_flask, V_liquid, V_gas,        // 사이드바 입력
    liquidType,                      // 현재 water 만 (Phase 6.7 ethanol 예정)
    elapsed_sec,                     // world.elapsedSec
    gasParticles,                    // world.gasParticles.length
    equilibriumState,                // none/near/detected/confirmed/exited (fixup 15n 5-state)
    equilibriumDetected,             // boolean getter
    equilibriumConfirmed,            // boolean getter
    equilibriumReachedAtSec,
    evapEMA, condEMA,
    measurementPoints,               // recordEquilibrium 누적
    mode: "mock",                    // Phase 6.3+ ws/real/vernier 예약
}
```

**Phase 6.3 4 데이터 소스 분기 예약**: 현재 vapor `mode` = "mock" 만 active. ws/real/vernier 활성화 시점 = Phase 6.3 (실센서 도착 후). sensorGuide 본문은 boyle/dalton 패턴 정합 추정 — 실측 활성화 시 작성. 단일 측정값 모드별 source 분기 철학 (`docs/17` §6 fixup 15j) 정합 — `world.pressureKPa` (mock 시뮬값) → `world.pressureMeasured` (real 실측값) 자연 교체. AI 튜터 buildDataContext 무변경 (P_kPa 출처만 자동 분기).

**commits**:
- `f0acb06` (fixup 17a) — vapor AI 튜터 통합 (tutor.js factory 재사용, +308/-8)
- `753b723` (fixup 17b) — silent regression 수정 (vaporTutor.init() 1줄 누락) + flex 부모 시도
- `e9459c1` (fixup 17d) — 시스템 layout 본질 발견 (@media 1599 → 1199 + flex 부모 정공법)

**일지**: `docs/10-dev-journal.md § Phase 6.4 fixup 17a~17g-1` (17h-1d entry).

**자세**: `docs/17-vapor-design.md` §14 (vapor AI 튜터 통합) + §15 (시스템 layout).

#### 4.6.6 D-(4) Vernier records 연동 (2026-05-08, commit `105c226`)

**배경**: D-(3) 완료 후 발견 — Vernier 모드에서 N회 측정해도 records 0건 유지. `addRecord()` 는 mock stage `INJECTED` 일 때만 호출, Vernier 측정 버튼은 `vernier.stage` 만 갱신. AI 튜터는 "측정 기록 없음 — [확인] 버튼 안 누름" 메시지로 잘못 안내 ([확인] 은 mock 전용 UI).

**해결**:
- Vernier 측정 버튼 `CAPTURED` 진입 시 `addVernierRecord()` 호출 (mock 과 records 배열 공유)
- record 객체에 `mode` 필드 신설 (`mock` / `ws` / `real` / `vernier` 출처 식별)
- `P_A` / `P_B` / `n_A` / `n_B` / `n_total = null` (Vernier 단일 센서로 분압·분자수 산출 불가)
- `daltonBuildSystemPrompt formatRecordLine` helper 에서 mode 분기 — vernier 는 "회차 N [Vernier 실측]: P_total=... atm (실측), P_A/P_B=N/A" 표시
- `[측정 기록 없음 — [확인] 버튼 ...]` → `[측정 기록 없음 — 학생이 아직 측정을 진행하지 않았습니다.]` 메시지 정합화
- 디버그 핸들 추가 — `window._daltonBuildDataContext` / `window._daltonBuildSystemPrompt`

**근거**: 옵션 A2 (별도 `vernierRecords` 배열) 대신 옵션 A1 (records 통합) 채택 — 비교 모드·CSV·표 그래프 등 기존 UI 자동 재사용 가능.

**검증**: mock 모드에서 `_daltonBuildDataContext().records[0].mode === "mock"` 확인, `_daltonBuildSystemPrompt` 출력에 학생 측정값 라인 포함 확인. Vernier 모드 record 형식 검증은 BT 어댑터 부재로 보류.

**후속**: 표 row 렌더 / 그래프 갱신 / CSV null 처리는 D-(4) 범위 외 — 후속 트랙.

#### 4.6.7 D-(2) Q1~Q4 인지 흐름 재설계 + 본문 anchored (2026-05-08, commit `7dedd21` — message 라벨 D-(?))

**배경**: D-(4) 검증 중 발견 — Q1~Q3 본문이 학생 측정 데이터와 무관한 일반 이론 질문. 예: high.q1 = "주입 전후 분자 수 보존을 가정할 때 PV=nRT 로 설명" (가정 기반, 학생 데이터 0% 사용). 매핑 (목표 1/2/동적/4) 은 사후 문서화일 뿐, journal·docs 에 학습학적 결정 근거 미기록 — 변경 자유 확인.

**해결 — 매핑 재설계 (Bloom 인지 흐름)**:
- Q1 = **관찰** (Observation) — 학생 데이터 직접 보기
- Q2 = **해석** (Interpretation) — 관찰값을 이론과 연결, 부분 압력·분자수 비율
- Q3 = **예측·검증** (Prediction & Verification) — 다른 조건 예측 → 측정 검증
- Q4 = **메타** (현행 유지)

**해결 — 16개 본문 재작성**:
- elem / middle: 정적 문자열, 자연 표현 ("방금 측정한 회차의 ...")
- high / univ: `(ctx) => string` 함수 형태 — 동적 placeholder `${ctx.records.slice(-1)[0].FIELD}` 치환
- 0건 fallback: `?? "(측정 전)"` 안전 처리
- 학습 목표 4개 유지 (분자 수 보존 / 부분 압력 / 가산성 / 시뮬↔이론)
- `daltonGetQuestionText(level, qid, ctx)` — `typeof` check 로 함수/문자열 분기, lazy ctx fallback (`tutor.js` 의 2-arg 호출 시 closure `daltonState.measurementRecords` 자동 사용)

**해결 — system prompt 가이드 강화**:
- `[Q별 데이터 인용 가이드]` 섹션 신설 — Q1~Q4 별 어떤 측정 필드 인용해야 하는지 명시
- `[측정 기록 0건 처리]` 섹션 신설 — records 빔 시 측정 진행 먼저 안내
- `sensorGuide` vernier 분기 추가 보강 — Q1·Q2 에서 P_A/P_B 인용 X, V_A/V_B 비율과 P_total 로 분기

**참고**: commit message 는 `D-(?)` 잔존. journal cross-ref 표 (`docs/10-dev-journal.md` line 3132) 에 "D-(2) = 7dedd21 (msg D-(?))" 명시.

**검증**: mock 1회 측정 후 `_daltonBuildSystemPrompt("high", "1")` 본문에 "방금 측정에서 V_A=50, V_B=50일 때..." 확인. records 0건 fallback "(측정 전)" 정상 표시.

#### 4.6.8 D-(5) 응답 가드 — 소크라테스식 (2026-05-08, commit `ffdf92c`)

**배경**: 기존 절대 원칙 1·6·7·9 가 소크라테스식 의도 일부 반영했으나 실효 약함. AI 가 학생 압박 ("정답이 뭐야", "그냥 알려줘") 에 굴복할 위험. 직답 표현 명시적 금지 부재. Few-shot 예시 부재로 LLM 패턴 학습 약함.

**해결 — 절대 원칙 11~13 신설**:
- **11**: 학생 직답 요청 거부 + 힌트성 질문 전환 (예: "직접 답을 드리진 않을게요. 대신 [학생 마지막 관찰] 에서 다음으로 어떤 게 궁금하세요?")
- **12**: 직답 표현 금지 ("정답은", "결론적으로", "~이기 때문입니다" 단정형) + 가능성 표현 ("~할 수도", "~라면 어떨까요") 권장
- **13**: 학생 추론 단계 보존 — 한 단계만 답하기, 두 단계 이상 X

**해결 — Few-shot 예시 3개 (Q1·Q2·Q3) system prompt 통합**:
- 학생 답변 시뮬 + 나쁜 응답 / 좋은 응답 대비 + 핵심 패턴 정리 (학생 데이터 인용 / 직답 차단 / 발견 인정 / 깊은 질문 / 가설 검증 유도)
- system prompt 분량 ~2050자 → ~2700자 (Claude sonnet-4-6 입력 토큰 ~$0.0003/호출, 비용 미미)

**근거**: 트랙 1 (programmatic 응답 후처리) 은 false positive 위험 큼 — 정상 응답도 거부될 가능성. 트랙 2 (system prompt 강화) + Few-shot 결합이 효과·작업 균형 최적.

**검증** (실 AI 호출, claude-sonnet-4-6):
- 학생 답변 'P_A=0.96, P_B=1.04, 합치면 P_total=2.00. 정답인가요?'
  → 응답: "합 관계를 정확히 찾으셨네요. P_A + P_B = 2.00, P_total = 2.00... 부피·온도 같은데 압력 다른 이유는?"
  → 학생 데이터 인용 + 단정형 표현 없음 + 깊은 질문 마무리 ✅
- 직답 요청 회귀 '그냥 답 알려줘. 정답이 뭐야?'
  → 응답: "직접 답을 드리진 않을게요. 두 기체 사이 다른 점이 있을 텐데... 분자 수(n) 확인해보셨나요?"
  → 직답 거부 + 힌트성 질문 전환 ✅

**후속**: Few-shot 예시 안의 단정형 인용 ("정답입니다", "맞습니다") LLM 이 그대로 따라할 위험 — 실측 검증 통과로 위험 낮음 확인. 다양한 학생 입력 (오개념·회피·메타) 회귀 검증은 별도 트랙. 보일·입자운동 튜터에도 같은 가드 적용은 별도 트랙.

#### 4.6.9 D 시리즈 일련번호 (2026-05-08 시점)

journal `docs/10-dev-journal.md § Phase 5.9 D 트랙` 표와 정합:

| ID | 명칭 | 상태 | commit |
|---|---|---|---|
| D-(1) | 돌턴 보고서 자동 생성 | 후속 | — (보일 `tutor-report-boyle.js` 패턴 재사용 예정) |
| D-(2) | Q1~Q4 인지 흐름 재설계 + 본문 anchored | 완료 | `7dedd21` (msg D-(?)) |
| D-(3) | 데이터 소스 분기 (Vernier) | 완료 | `8cb741e` / `10ae103` |
| D-(4) | 측정 데이터 연동 점검 (Vernier records) | 완료 | `105c226` |
| D-(5) | 응답 가드 (소크라테스식) | 완료 | `ffdf92c` |
| D-(6) | 학생 수준 자동 판단 검증 | 후속 | — (`[[LEVEL:xxx]]` 동작 실측 필요) |

#### 4.6.10 Vernier P 차이 추론 흐름 (2026-05-10, fixup 19)

**본질**: Vernier 단일 센서 = 결합 시스템 P_total 만 측정 가능 = 이론값 P_theory 와 ~5% 차이 자세 발견 가능 (결합관/콕 추가 부피 자세). 학생 자율 사고 사이클 정합 = AI 튜터가 직접 원인 알려주지 X = 소크라테스식 진입.

**변경 영역**:
- `formatRecordLine` vernier 분기 = `P_theory=${r.theoryAtm.toFixed(2)} atm (이론)` 추가 (AI 자동 차이 인지)
- `sensorGuide` vernier 분기 = "P 차이 추론 안내" 단락 신설 (5 가설 + V_A/V_B 검증 흐름)

**학습 흐름**:
1. 차이 발견 시 (~5% 자세) = 직접 원인 알려주지 X. 소크라테스식 질문 진입: "어디서 왔을까요?"
2. 학생 가설 list 진입 = 5 가설 모두 가능 자세:
   - (1) 결합관/콕 추가 부피 (학생 V_A+V_B 외 추가 빈 공간 — **본질**)
   - (2) 기체 비이상성 (압력 ↑ 시 PV=nRT 편차)
   - (3) 기체 누출 (콕 기밀 자세)
   - (4) 온도 변화 (압축 시 단열 효과)
   - (5) 측정 노이즈 (±3 kPa GDX 검정 정확도)
3. 검증 진입 = V_A/V_B 변경 측정 비교:
   - 차이 비율 일정 시 = (1) 결합관 부피 자세
   - 차이 P 의존 시 = (2) 비이상성 자세
   - 차이 시간 의존 시 = (3) 누출 자세
4. 학생 (1) 결합관 부피 본질 도달 = **영재교육 핵심 발견** = 인정 + "그 부피 어떻게 측정할 수 있을까요?" 진입.

**배경**: V_dead 입력 UI 폐기 = 정답 주입 = 학생 사고 X = 영재교육 본질 위반. AI 튜터 추론 흐름 = 학생 자율 발견 사이클 보존.


---

## 5. 모델·비용 정책

### 5.1 지원 모델

| 모델 | 용도 | 비용 특성 |
|---|---|---|
| `claude-sonnet-4-6` | 기본 응답 (설정 패널 기본 선택) | 균형잡힌 품질·비용 |
| `claude-opus-4-7` | 깊은 피드백 (고품질 필요 시) | 고비용 |
| `claude-haiku-4-5` | **키 검증 전용** | 최소 호출 (`max_tokens: 5`), 사용자 노출 없음 |

### 5.2 비용 표시

메시지별 메타 (`message-meta` 영역):
```
Sonnet · 입력 280 토큰 · 출력 195 토큰
```

누적 세션 사용량 (`.usage-display`):
```
이번 세션 사용량: 430 토큰 (약 23원)
```

Part 4 예정:
- 누적 비용 **100원 초과** → 주황 배너
- 누적 비용 **500원 초과** → 빨강 배너 + [세션 초기화] 제안

### 5.3 모델 단가 (`MODEL_PRICING`, 2026-04 확인)

| 모델 | 입력 | 출력 |
|---|---|---|
| `claude-sonnet-4-6` | $3 / MTok | $15 / MTok |
| `claude-opus-4-7` | **$5 / MTok** | **$25 / MTok** |

> **주의**: Opus 4.7은 이전 세대(Opus 3 계열)의 $15/$75와 다르다. 코드 주석에서 명시적으로 구분됨 (`simulation.js`가 아닌 `ui.js:731`).

환율 상수: `USD_TO_KRW = 1400`. 실제 환율 변동 대응은 향후 과제.

### 5.4 과금 구조 이해

Anthropic API는 **토큰 단위 과금**이다. 한국어 한 글자 ≈ 1~3 토큰 (BPE 기반). 평균적으로:
- 학생 답변 200자 + 시스템/컨텍스트 프롬프트 = 입력 ~500-800 토큰
- AI 응답 250자 이내 = 출력 ~200-400 토큰
- Sonnet 기준 1턴 ≈ 5~10원

한 세션(4~6턴) 추정: Sonnet 기준 **약 30~80원**. Opus 기준 약 3배.

---

## 6. CSV 통합

모든 대화는 **분석 보고서 CSV**의 `# == AI 튜터 대화 ==` 섹션에 통합 저장된다. 별도 `chat_*.json`은 만들지 않는다.

스키마 상세: `docs/05-data-format.md` §분석 보고서 CSV 참조.

### 6.1 교육적 활용

- **교사 검토**: 학생별 대화를 한 파일로 읽어 개입 여부·질문 깊이 파악
- **학습 분석**: "이 학생은 Q2에서 3회 대화했다", "자유 탭을 적극 활용했다" 등 패턴 추출
- **논문 자료**: 학생-AI 상호작용 로그로 정성 연구 가능 (`turns`, `token_ratio`, `question_depth` 등)

### 6.2 프라이버시 경계

CSV에는 다음이 포함된다:
- 학생 답변 원문
- AI 응답 원문
- 모델명·토큰 수
- 시점(timestamp)

포함되지 **않는** 것:
- 학생 이름·식별자 (프롬프트·메시지 모두에 개인정보 금지 원칙)
- API 키
- 브라우저·OS 정보

---

## 7. 교육적 검증 계획

**현재 상태**: 실제 학생 대상 검증 **미수행**. 시뮬레이션 물리·UI 동작만 개발자 단독 검증.

### 7.1 Phase 3 이후 수행 예정

**1차시 시범 수업**
- 대상: 영재반 5~10명
- 설정: AI 튜터 사용군 vs 미사용군 (간이 대조)
- 기간: 1회차 (45~50분)

**평가 지표**
- 성찰 대화의 질적 깊이 (텍스트 분석: 키워드 밀도, 개념 연결 수)
- 학생 자발 질문 빈도 (자유 탭 사용 분석)
- 오개념 발생·교정 비율 (pre/post 평가)
- 학생 만족도 (5점 척도) 및 AI 의존도 지각

**교사 피드백**
- AI 튜터가 수업 흐름을 방해하지 않는지
- 학생 개인차(수준·성향)에 적절히 반응하는지
- 관찰자로서 AI 응답 품질 판정

### 7.2 연구 설계 고려사항

- 샘플 크기: 1차 시범은 질적 중심 (소규모), 2차 확장 시 n≥30 양적
- 학생 동의·학부모 동의 절차 필수 (§8.2 참조)
- 교육청·학교 IRB 심의 (한국 맥락에선 기관별 정책 확인)

---

## 8. 윤리·접근성

### 8.1 AI 의존도 경계

학생이 AI에 과도 의존하지 않도록 다음 장치가 있다:

| 장치 | 현재 상태 |
|---|---|
| 측정점 ≥ 3 조건 (Q1~Q3) | **구현됨** — 실험 없이 AI와만 대화 불가 |
| 자유 탭 상시 활성 | 구현됨 (탐구 자유 보장과의 절충) |
| 한 세션당 대화 턴 제한 | **Part 4 예정** (8턴 권장) |
| 교사에게 AI 사용 기록 공개 | 구현됨 (CSV 통합 저장) |

### 8.2 개인정보

- 학생 답변이 Anthropic API(미국 서버)로 전송됨 → **학부모·교육청 동의 필요** (실 수업 투입 전)
- 최소 데이터 원칙: 프롬프트와 메시지에 학생 이름·학번·생년월일 등 식별자 금지
- 코드 리뷰 시 "학생 정보가 새어나갈 수 있는 필드가 있는가" 점검 필요
- API 키는 학생 개인 계정 사용 권장 (교사 계정 공유는 로그 추적 불가 위험)

### 8.3 접근성 (미래 과제)

현재 **기본적인 접근성만 충족**:
- 탭·버튼에 `aria-label` 일부 부여
- `aria-disabled` 로 비활성 탭 상태 표시
- 키보드 전용 조작 가능 (Enter 전송, Tab 포커스 이동)

Phase 4+ 개선:
- 스크린 리더 대응 강화 (대화 추가 시 `aria-live="polite"`)
- 색맹 친화적 색상 재검토 (현재 Q1~Q3 보라 vs 자유 청록 — 색약 구분 확인 필요)
- 대비 비율 WCAG AA 이상 검증

---

## 9. 한계와 미래 과제

### 9.1 현재 한계 (Part 3.5 기준)

- **실제 API 호출 없음** (더미 응답) — Phase 2-B에서 교체
- 프롬프트가 실제 학생 반응으로 튜닝되지 않음
- 한국어 과학 교육 맥락에 최적화된 프롬프트 실증 데이터 부재
- 대화 품질이 모델 버전에 민감 (Sonnet 4.6 기준으로 작성됨, 후속 모델 교체 시 재튜닝 필요)
- 오프라인 사용 불가 (인터넷 필수)
- `QUESTION_TEXT` 중복 — Phase 5.4 시점 3 시뮬 (보일/돌턴/입자운동) 모두 자체 `QUESTION_TEXT` 정의. 보일 = `ai-tutor.js`, 돌턴 = `ui.js createDaltonTutor` closure, 입자운동 = `ui.js ADV_TUTOR_QUESTION_TEXT` (4 levels × 4 questions). 통합은 Phase 6/7 신규 시뮬 추가 직전 별 브랜치 (`phase5-tutor-unify`) 에서 — 셀렉터 / 책임 분리 명확화 후

### 9.2 Phase 2-B 작업 (자세한 내용은 `06` §3 참조)

- Anthropic Messages API 실 호출 교체
- 대화 히스토리 multi-turn 전송 (`messages` 배열 누적)
- 타이핑 인디케이터
- 에러 처리 (401/429/529/0 네트워크)
- 토큰·비용 누적 실제 업데이트
- 비용 경고 배너 (100원/500원)
- [세션 초기화] 버튼
- 자유 모드 시스템 프롬프트 추가
- `QUESTION_TEXT` 중복 제거 (ai-tutor.js로 통합)

### 9.3 Phase 3+ 계획

- **실센서 데이터 연동**: Arduino 측정값이 이론과 다를 때 AI가 차이를 해석 ("실제 측정 P·V가 이론과 5% 다른 이유는?"). Phase 5.4 멀티채널 SensorSource 가 돌턴 2 채널을 동시 공급 → AI 컨텍스트에 채널별 P_A / P_B 자동 포함 가능
- **[A] AI 튜터 통합 (`phase5-tutor-unify` 별 브랜치)**: Phase 6/7 신규 시뮬 추가 직전. 3 시뮬 (보일/돌턴/입자운동) 의 자체 closure 가 누적 → 공통 모듈로 통합 시 셀렉터 / 책임 분리 명확화 필요. Phase 5.4 의 입자운동 비활성 버그 (ai-tutor.js 의 `.ai-sidebar` 셀렉터 광역 영향) 가 통합 전 해결할 대표 이슈
- **교사 대시보드**: 학생별 AI 사용 패턴 실시간 조회 (Phase 6)
- **다국어**: 영어 영재 과정(해외 IB 등) 대응 시 시스템 프롬프트 번역 + 학생 수준 매핑 재설계

### 9.4 추구하지 않을 것

AI 튜터 설계에서 **의도적으로 배제**되는 기능:

- **시뮬레이션 자동 조작 AI** — 학생 주체성 파괴
- **자동 채점·평가 AI** — 교사 역할 침범, 평가 편향 우려
- **학생 감시·행동 조작 AI** — 윤리적 한계 (교육 목적을 넘어선 데이터 활용)
- **실시간 학생 간 비교** — 상대 평가 문화 조장 위험

---

## 10. 관련 문서

- `00-project-overview.md` — 프로젝트 전체 비전·교육학적 근거(Johnstone)
- `03-software-architecture.md` §2.2 `ai-tutor.js` — 모듈 심볼·의존성 세부
- `05-data-format.md` — 분석 보고서 CSV 스키마 (AI 튜터 대화 섹션)
- `06-project-status.md` §3~§4 — Phase 2-B/3/4/5/6 로드맵
- `docs/09-roadmap.md` (예정) — Phase별 상세 로드맵
