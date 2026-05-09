// =============================================================
// vapor.js — 증기압 시뮬 본체
// Phase 6.1-b finalization fixup 17a (vapor AI 튜터 통합 — tutor.js factory 재사용)
// Phase 6.1-b finalization fixup 15s (P 영역 그래픽화 — SVG 압력계 + LCD 시계 + 입자 막대)
//
// 핵심 철학 (정공법):
//   학생 가시 = 실측 / 시뮬 = 미시 가시화 (정성적)
//   우측 상단 = "센서 영역" (T + P 카드 통합, fixup 12, 헤더 fixup 15f 단순화)
//     · mock 모드: T 입력 (number input + 5 프리셋, fixup 11+12 integrated) — P 영역 hidden (15f)
//     · real 모드 (Phase 6.3+): vapor-real-only hidden 토글로 P 영역 자동 부활
//                               T 실측 + P 실측 자동 표시 (DOM 보존)
//   화면 반응형 (fixup 11+12 integrated): 1024px / 768px 브레이크포인트
//   평형 판정 통일 (fixup 13): ratio = condEMA / evapEMA, [0.9, 1.1] band 5초 유지 → 평형
//     · 모든 평형 표지 동일 트리거: 시뮬 헤더 배지 + rate 그래프 ★ vertical line + 비율 zone 색
//     · mock 평형 배지 활성 (fixup 9 비공개 결정 일부 폐기)
//     · P 카드 + 측정점 표 비공개 유지 (정공법 회귀 흐름)
//   mock 모드: P 카드 placeholder / 측정점 표 / P-T 그래프 비공개 (평형 ★/배지/비율 zone 활성)
//   mock 학생 단서 = (1) rate 카드 third cell 비율 (cond/evap EMA + zone 색)
//                  (2) 화살표 매칭 상쇄 (위·아래 1쌍 캔슬 → 빈도 차 시각)
//                  (3) 색 강조 (노랑/핑크) — 사건 자체 가시화
//   real 모드 (Phase 6.3+): 실측 P 기반 활성, 정량 학습 활동
//
// 활성 명세:
//   ── 시뮬 모델 ──
//     · Liquid lattice = 정적 격자, 반투명 단색 (#1E40AF / opacity 0.92)
//     · SurfaceParticle = KE 시각용만 (smooth random walk, 색 매핑)
//     · 비동기 Poisson 사건 모델 (매 frame 독립 평가)
//     · Boltzmann factor T 통합: rate(T) = base × exp(E_a × (1 - T_ref/T))
//     · base_evap_rate = 0.010 /입자/s (fixup 11 — 학교 실험 시간 정합, T=25 평형 ~5분)
//
//   ── Ghost 통계 안정성 (보일 패턴 재사용) ──
//     · ghost 표면 800 + visible 80 = 880, 모두 게이트 평가
//     · 매 evap 시 visible_ratio (=0.4, fixup 11 base 튜닝 보강) 로 visible vs ghost 분기
//     · 압력 / rate 통계 결합: total × 0.4 = visible-equivalent
//
//   ── 시각 강조 (3계층 인지) ──
//     · 사건 자체 = 노랑 #FCD34D (가시 가스 birth) + 핑크 #F472B6 (격자 응결)
//                   둘 다 1.5s + 0.5s fade + glow blur 25 (별도 큐, 매칭 영향 X)
//     · 빈도 차 = evap 위 화살표 / cond 아래 화살표 (fixup 15a redo v4 — 매칭 폐기)
//                  _addFlash = 단순 push (매칭 / max cap 모두 폐기)
//                  drawFlashes = hold (flash_hold_sec=0.5초) 후 linear fade (flash_duration_sec=1.0)
//                  양쪽 독립 fade — 매칭 logic X
//                  학생 인지: 동시 visible 화살표 수 = 사건 빈도 비례 (양쪽 동시 visible 시 빈도 균형)
//                    · 시작 (응축 0): 위 화살표 ≈ 3.5개 동시 (raw 3.52/s × 1.0초)
//                    · 평형 (evap ≈ cond): 양쪽 동시 ≈ 3.5개씩 = 빈도 균형 시각
//     · 정량 절댓값 = rate 그래프 두 곡선 만남 (_evapWin / _condWin 카운터, 매칭 영향 X)
//
//   ── rate 그래프 (학습 단서, 우측 카드 별도 canvas) ──
//     · 시작부터 누적, x축 자동 스케일 (initial=180s, fixup 11 — 학교 시간 척도)
//     · 워밍업 = 첫 W tick (rate_warmup_ticks=2) 폐기 — 평균 시작 전 raw 폐기
//     · EMA prime = 워밍업 후 첫 N tick (rate_ema_prime_avg_ticks=5) raw 평균으로 초기화 (fixup 15a)
//                   → 잡음 σ √N 감소된 평균값 prime → 시작 직후 EMA 곡선 부자연 transient 회피
//     · prime 의도 = 시작 시점만 (EMA=0 워밍업 lag 차단). T 변경 시점 무관 (EMA 이미 정상값).
//     · T 변경 시 EMA 보존 (fixup 15e) — 자연 수렴 (alpha 0.05, τ=20s, ~60s)
//       raw buf reset (직전 T 잔재 회피)
//     · 학생 학습 = 두 곡선 만남 = 정성적 평형
//
//   ── rate 카드 third cell — 응축/증발 비율 (mock 학습 단서, fixup 11) ──
//     · ratio = condEMA / evapEMA, 텍스트 + zone 색 분기
//     · zone (zero/low/mid/eq/over), 1.0 도달 시 녹색 (eq) → 평형 인지
//
//   ── 평형 자동 감지 (fixup 15d — hysteresis 4-state, mock 활성) ──
//     · 4 상태: "none" / "near" / "reached" / "exited"
//     · 진입 zone [0.9, 1.1] holdSec=10초 → "reached" + _everReachedEquilibrium=true
//     · 도달 후 이탈 zone [0.85, 1.15] 안 = "reached" 유지 (hysteresis 잡음 보호)
//     · 이탈 zone 외 시 "exited" + _everReachedEquilibrium=false → 재도달 시 hold 다시
//     · 시뮬 헤더 배지 + rate 그래프 ★ + 비율 zone 색 모두 _equilibriumState 기반 동기화
//     · 직전 fixup 13 단일 metric ratio 0.9~1.1 / 5초 hold sticky 평형 폐기 (이탈 추적 부재)
//     · P_internal 변화율 평형 판정 폐기 (fixup 8~9), 진단용 _lastRelChange 보존
//     · equilibrium_change_threshold / equilibrium_warmup_sec 보존 (real 모드 재사용 의도)
//
//   ── setTemperature reset (fixup 10) ──
//     · _emaPrimed = false, _pressureSmoothedPrev = null 추가
//     · T 변경 시 evap 곡선 lag / relChange jump 회피
//
// 폐기 (fixup 누적 1~15f):
//   · KE 결정적 게이트 + 1초 동기 재샘플 (fixup 3)
//   · sliding window 60초 (fixup 6, 누적으로 변경)
//   · evap_rate_per_particle_per_sec (fixup 4, Boltzmann 으로 대체)
//   · pressure_to_evap_calibration (fixup 8, 시뮬 P 정량 정합 시도 폐기)
//   · 평형 P 카드 / 측정점 표 / P-T 그래프 학생 가시 (fixup 8)
//   · 평형 ★ + 평형도 % 학생 가시 (fixup 9, 정공법 완성)
//   · liquid_jitter_amp_px config + lattice amp/phase 필드 + update() 분기 (fixup 10)
//   · vapor-card-ratio 큰 카드 + ratio 막대 + 1.0 marker + axis labels (fixup 10 → 11 폐기)
//     ratio 자체는 rate 카드 third cell 로 이식 (텍스트 + zone 색)
//   · vapor-eq-percent DOM (fixup 9 hidden 상태였음, fixup 11 third cell 자체 비율로 교체 → 완전 폐기)
//   · 시뮬 캔버스 아래 T 슬라이더 + 프리셋 버튼 (fixup 12, 우측 카드 통합으로 이동)
//   · vapor-card-pvap (fixup 12, vapor-card-tp 안 P 영역으로 통합)
//   · T 셀렉트 (fixup 12 → 11+12 integrated, number input 으로 교체 — 학생 임의 T 직접 입력)
//   · 시작 직후 EMA prime 잡음 박힘 (fixup 9 부작용 → fixup 14 워밍업 + fixup 15a N tick 평균으로 해소)
//   · 화살표 매칭 logic 일체 폐기 (fixup 11 / 15a v1~v3 누적 시도 → v4 회귀, 매칭 로직 자체 폐기)
//   · _processFlashMatching 함수 + update() 호출 (redo v2/v3, redo v4 폐기)
//   · fading_flashes 큐 (redo v3, redo v4 폐기 — this.flashes 단일 큐)
//   · setTemperature 안 누적 화살표 fade 이동 (redo v3, redo v4 폐기 — T 변경 시 화살표 손대지 X)
//   · params.flash_arrow_match_cancel_fade_sec (15a v1) / match_min_hold_sec (v2) /
//     match_fade_sec / max_cap_per_dir / t_change_fade_sec (v3, v4 모두 폐기)
//   · fixup 13 sticky 평형 (단일 ratio band + 5초 hold, 이탈 추적 X) — fixup 15d 폐기
//   · equilibriumStartIdx 필드 (fixup 13, fixup 15d 폐기 — _equilibriumHoldStart ms 로 의미 이전)
//   · DOM data-state="yes"/"no" / data-zone "zero"/"low"/"mid"/"eq"/"over" (fixup 11~13)
//     fixup 15d 폐기 → 4 분기 (reached/exit/near/none) 통일
//   · setTemperature 안 EMA reset (fixup 10 + 15a, T 변경 시 prime 다시 의도)
//     fixup 15e 폐기 — 그래프 0 폭락 (mapY null) + spike 결함. EMA 보존으로 자연 수렴.
//     prime 의도 재정의: 시작 시점만 (EMA=0 워밍업 lag 차단), T 변경 무관.
//   · T+P 카드 P_vap mock placeholder 표시 (fixup 8/12, 사이드바 측정 모드 토글과 중복)
//     fixup 15f 폐기 — P 영역 vapor-real-only wrap → mock 단계 hidden, real 단계 자동 부활.
//     min-height 280 → 200, 카드 column gap 10 → 12 (UI 균형).
//     카드 헤더 "온도 / 증기압 (센서 영역)" → "센서 영역" (mock/real 양쪽 정합).
//
// 추가 (fixup 15g — UI 균형 다층, JS 로직 변동 X / HTML+CSS 만):
//   · 학습 목표 카드 신설 (Johnstone 3수준: 거시/입자/기호) — 상단 가로 행 위 3열 그리드.
//     의도: 학생이 페이지 진입 즉시 "무엇을 관찰해야 하는가" 인지 → 3 영역 (시뮬/카드/측정점)
//          관찰 행위에 의미 부여. mock 단계 빈 공간 (P 영역 hidden / 측정점 영역 hidden) 시각 보강.
//   · vapor-layout-v2 max-width 1400px + margin 0 auto — 1920+ 데스크톱 우측 회색 여백 차단.
//     배제: 100% width (회색 잉여) / 1600px+ (laptop 균형 손상).
//   · 시뮬 placeholder 강화 (icon + 본문 + hint 다층) — 시작 전 단계도 페이지 의도 전달.
//   · 분자 수 카드 footer "분자 수 = 동적 평형의 양적 지표" — 학습 단서 명시.
//   · 측정점 영역 placeholder padding 36 → 14 px (~140 → ~80px) — mock 단계 영역 비중 축소.
//
// 추가 (fixup 15h — 시뮬 중심 단순화, JS DOM dict / readout 정리 + HTML+CSS 대규모 재편):
//   · 사이드바 (.vapor-control-narrow 200px aside) 폐기 → 위쪽 가로 영역 (.vapor-top-control) 변신.
//     2 row layout: Row 1 = 실험 설정 (V_flask / V_liquid / 액체 / 시작·리셋 / 1입자≈X mmol),
//                  Row 2 = 측정 모드 (mock / WS / real / Vernier 4 button + help-text inline).
//     DOM ID 보존 (vFlaskSel / vLiquidIn / liquidTypeSel / btnStart / btnReset / mmolSpan
//                  / .vapor-mode-btn 4개) → JS 핸들러 변경 X.
//   · 시뮬 캔버스 표시 800 → 1100 (CSS scaling 1.375×). 모델 좌표 800×480 보존
//     (params.json canvas_width_px/canvas_height_px 무변동, 입자/격자/화살표 모두 좌표 그대로).
//     vapor-canvas-container max-width 800 → 1100, aspect-ratio 800/480 유지.
//     anti-alias 영향만 미세, 모델 retuning X.
//   · vapor-layout-v2 max-width 1400 → 1500 (canvas 1100 표시 수용).
//   · vapor-cards-region width 280 → 320 (가독성 ↑, 시뮬 660 정합).
//   · 카드 min-height: tp 200 → 300 (5 프리셋 + 입력 row + 가드 노트 여유),
//                    rate 220 → 340 (rate canvas 140 + readouts + note 여유).
//     컬럼 합산 = 300 + 12 + 340 = 652 ≈ 시뮬 660 정합.
//   · 시뮬 영역 (.vapor-sim-region) flex 0 0 824px → flex 1 1 auto + max-width 1124px
//     (사이드바 폐기 자리 활용, canvas 1100 + padding 24).
//
// 폐기 (fixup 15g 신규 → 15h 번복, 의사결정 reversal 패턴 — 논문 1차 자료 가치):
//   · 학습 목표 카드 (15g 신규: Johnstone 3수준 거시/입자/기호) — 15h 폐기.
//     사유: 시뮬 자체가 Johnstone 3수준 학습 단서를 충분히 제공 (입자 시각화 = 입자 수준,
//          비율 카드 = 기호 수준, 시뮬 자체 = 거시 수준) → 텍스트 중복.
//          시뮬 width ↑ 가 학습 가치에 직접 효과, 학습 목표 카드 자리 = 시뮬 자리.
//   · 분자 수 카드 (.vapor-card-counter, 표면/기체/액체 격자 3 row + 15g footer note) — 15h 폐기.
//     사유: rate 카드 + 평형 배지로 학생 인지 충분. 정량 표시 자체가 "시뮬 = 미시 가시화"
//          철학과 약간 충돌 (입자 수 = 정량 학습 단서). 시뮬 단순화 우선.
//     JS 정리: main.js dom dict 3 항목 (surfaceCount / gasCount / latticeCount) + readout
//             update + reset 모두 폐기. world.gasCount getter (vapor.js) 보존 (디버그 예비).
//   · vapor-control-narrow 사이드바 + .vapor-section + .vapor-field 등 사이드바 전용 CSS 일괄 폐기.
//   · .vapor-info-row 폐기 (사이드바 보조 정보 패널, .vapor-top-info 가 대체).
//   · .vapor-mode-toggle grid 2x2 → flex row (4 button 가로 정렬, 위쪽 가로 영역 정합).
//
// 추가 (fixup 15j — P 영역 부활 + 측정 기능 활성, 단일 측정값 모드별 source 분기 철학 회복):
//   · T+P 카드 P 영역 (.vapor-tp-pressure) vapor-real-only + hidden 속성 일괄 제거 → mock 모드 즉시 활성.
//     안 placeholder (vapor-tp-pressure-mock 아이콘+text+hint) 제거 / vapor-tp-pressure-real wrap 단순화.
//     이론값 메타 (vapor-pressure-theoretical) DOM 제거 — 단일 측정값 표시.
//     구분선 (.vapor-tp-divider) 의 vapor-real-only + hidden 제거 → 항상 표시.
//     신규 단순 구조: section-label + pvap-big + pressure-bar-wrap + pvap-meta (도달 시각만).
//   · measurement-region 안 .vapor-mock-placeholder-wide 통째 제거 → 측정 표 + 버튼 + P-T 그래프 즉시 활성.
//     기존 .vapor-real-only hidden wrap 제거 (mock 모드 활성 == real 모드 인프라 즉시 사용).
//   · 측정 표 thead 안 "이론 (kPa)" 컬럼 제거 (사용자 의도 정합: 시뮬일 때는 시뮬값만).
//     5 컬럼: # / T (°C) / P_vap (kPa) / 도달 (s) / 삭제. main.js renderMeasurementTable 정합 갱신.
//   · main.js readout: dom.pressureTheor 호출 폐기. dom.eqReachTime 포맷 "분/초" 화 (정량 인지 ↑).
//     measurementPoints 데이터 안 pt.Ptheor 보존 — P-T 그래프 회색 점선 (이론 곡선) 시각 비교용.
//   · world.pressureKPa getter (vapor.js:305) — 기존 코드 0 변동.
//     P 계산: total × ghostVisibleRatio × pressure_per_visible_gas_kPa = (가스+ghost) × 0.4 × 0.06.
//     mock 모드 입자 수 기반 자연 발생 양. real 모드 (Phase 6.3+) 진입 시 실측 변수로 자동 전환 디자인.
//   · recordEquilibrium / drawPTGraph (main.js 기존 구현) — hidden wrap 제거만으로 즉시 활성.
//     평형 도달 시 [기록] 버튼 자동 활성 (world.equilibriumReached === true 트리거, 15d 정합).
//
// 폐기 (의사결정 3단계 reversal — 논문 1차 자료 가치):
//   · fixup 15f P 영역 mock hidden (15c 사용자 비판 "딱딱 비어보이는" 해소 시도)
//   · fixup 15h hidden 유지 (시뮬 중심 단순화 흐름 정합 판단)
//   · fixup 15j 부활 (사용자 의도 "시뮬일 때는 시뮬값", 단일 측정값 모드별 source 분기 철학 회복)
//   3단계 reversal 패턴 자체가 본 프로젝트 정공법 회귀 의사결정 기록 가치 (논문 방법론 1차 자료).
//   사용자 명시: "이론값 시뮬값 나누지말고 시뮬일때는 시뮬값이 나오는거고 실제 실험할때는 실험값이 나오는거고"
//   → 단일 DOM, source 만 모드별 분기 (mock=world.pressureKPa / real=센서 실측, Phase 6.3+).
//
// 추가 (fixup 15k — 시뮬 시각 확대, 사용자 비판 "빈 공간 많은데" 해소):
//   · CSS scaling 1.375× → 1.625× (max-width 1500→1700, canvas-container 1100→1300).
//     모델 좌표 800×480 보존 (p5 internal 변경 X). cards-region 320 → 340.
//   · params.json ghost_gas_visible_ratio 0.4 → 0.7 (visible 입자 1.75× ↑).
//     T=25 평형 visible 53→93 / T=65 평형 417→730. sparse 인상 직접 ↓.
//   · params.json pressure_per_visible_gas_kPa 0.06 → 0.034 (P 정합 보존, 비례 조정).
//     world.pressureKPa = (visible+ghost) × ratio × k → (×) × 0.7 × 0.034 ≈ (×) × 0.024
//     ≈ 직전 (×) × 0.4 × 0.06 → P 값 직전과 거의 동일.
//   · 카드 min-height: tp 300→360 (P 영역 부활 height 흡수), card 기본 340→400.
//     카드 합산 360 + 12 + 400 = 772 ≈ 시뮬 ~780 정합.
//   · 트레이드오프: ghost 통계 √visible_ratio 잡음 흡수 효과 일부 손실
//     (√0.4≈0.63 → √0.7≈0.84, ghost 의존도 ↓). 학습 가치 (시각 밀도 ↑) 우선.
//   · regression 점검: rate EMA raw evap 1.75× ↑ (T=25 0.53/s → 0.93/s) — y축 자동 스케일 OK.
//                     평형 검출 (15d) ratio 기반, 입자 비율 변경 무관. 측정 기능 (15j) 영향 X.
//
// 추가 (fixup 15l — 여백 ↓ + rate 그래프 정렬 + 시뮬↔카드 height 정합, CSS only / JS 0 변동):
//   · max-width 1700 → 1900 (시뮬 좌우 여백 ~150 → ~20~40px 적정 도달).
//   · #vapor-rate-canvas max-width 256 폐기 → 100% (카드 폭 자동 채움, 좌측 치우침 해소).
//     drawVaporRateGraph2D 함수 W / H 인자 응답 → JS 0 변동 (canvas attr 256×140 보존,
//     CSS scaling ~1.22× 시각 정합). resizeObserver / 동적 attr 변경 X (단순).
//   · .vapor-card 기본 min-height 400 → 408 (카드 합산 360+12+408=780 ≈ 시뮬 box height 정확 정합).
//     사용자 비판: "시뮬 box vs cards-region height 미세 어긋남 → 시뮬 박스 끝 좌측 회색 여백" 해소.
//
// 추가 (fixup 15m — height 정합 옵션 C flex stretch + V_gas 칸 + 보조 정보 이동):
//   · 15l 정합 시도 (rate min-height 408) → 검증 실패 (실제 시뮬-region outer ~836 vs 카드 합산 780,
//     ~56px 어긋남). 사용자 보고 ~100~150px 어긋남 → 15m 옵션 C 구조적 정합.
//   · .vapor-top-row align-items flex-start → stretch (cards-region 자동 height 정합).
//     .vapor-card-tp flex 0 0 auto + min-height 360 보존 (5 프리셋 + 입력 + P 영역 정합).
//     .vapor-card-rate flex 1 1 auto + min-height 0 (cards-region 내 남은 height 자동 흡수).
//     → viewport-independent 구조적 정합 (1366 laptop / 1920 desktop / resize 모두 자동).
//   · V_gas 칸 form 변경: 가드 노트 "OK — V_gas = 200 mL" 텍스트 형태 → readonly input + 자동 채워짐.
//     vapor.html top-control Row 1 액체 부피 다음 신규 .vapor-top-field (input readonly tabindex=-1).
//     main.js validate(): error 시 vGasInput.value = "—" + 가드 메시지, OK 시 vGasInput.value = (vFlask-vLiquid)
//     + 가드 메시지 빈. CSS readonly 시각 (회색 배경).
//   · 보조 정보 (1 입자 ≈ X mmol) 위치 이동: top-control Row 1 우측 끝 .vapor-top-info 폐기.
//     시뮬 헤더 (.vapor-sim-header) 안 elapsed time 옆 inline (.vapor-sim-mmol-info 신규).
//     #vapor-mmol-per-particle ID 보존 → main.js 갱신 호출 site 0 변동.
//     학습 단서 정합 (시뮬 시작 직후 자연 인지) + top-control 너비 부담 ↓.
//
// 추가 (fixup 15n — 학생 평형 결정 메커니즘, 5-state machine, 시뮬 자동 → 학생 확정 분리):
//   · 사용자 비판: "평형도 감지하고 본인이 평형 결정하지말고, 평형에 도달한 것으로 보인다 평형 상태로
//                    지정? 정의? 뭐 하겠는지 물어보고" → 시뮬 자동 판정 폐기, 학생 결정 메커니즘 도입.
//   · 본 프로젝트 정공법 회귀: 측정 = 학생 결정 활동 (dual-layer = 시뮬 가시화 + 측정 활동 학생 발견).
//   · 4-state (none/near/reached/exited, 15d) → 5-state (none/near/detected/confirmed/exited, 15n).
//   · "detected" = 시뮬 hold 10초 자동 충족 (학생 확정 대기 상태).
//     "confirmed" = 학생 [평형 확정] 클릭 결정 (idx + reachedAtSec 이 시점에 set, 측정점 추가 트리거).
//   · 신규 method confirmEquilibrium() — detected 시점에 호출 가능, confirmed=true + idx + reachedAtSec set.
//     이미 confirmed 시 재호출 차단 (중복 측정점 방지).
//   · 신규 getter: equilibriumDetected / equilibriumConfirmed.
//     legacy alias: equilibriumReached → confirmed (drawVaporRateGraph2D ★ gate / main.js
//                  recordEquilibrium guard 등 backward compat 보존).
//   · hysteresis logic 변경:
//     - 미감지 / detected 후 이탈: 진입 band hold 충족 → state="detected" + _equilibriumDetected=true.
//                                    idx / reachedAtSec 는 confirm 시점에 set (여기서 X).
//     - detected 상태 + 이탈 zone 외: state="exited", _equilibriumDetected=false (재감지 가능),
//                                       _equilibriumConfirmed = X (애초에 confirmed X).
//     - confirmed 상태 + 이탈 zone 안: state="confirmed" (학생 결정 sticky 유지).
//     - confirmed 상태 + 이탈 zone 외: state="exited", confirmed/idx/reachedAtSec 보존 (★ 보존, 학생
//                                       결정 = historical record). T 변경 시만 reset.
//   · setTemperature reset: detected + confirmed + idx + reachedAtSec + _everReachedEquilibrium 모두 초기화.
//     T 변경 = 새 실험 조건 → 새 평형 도달 시 다시 [확정] 필요.
//   · main.js [평형 확정] 버튼 click handler: world.confirmEquilibrium() + recordEquilibrium() 통합 호출.
//     200ms readout: btnRecord.disabled = !equilibriumDetected || equilibriumConfirmed.
//     5-state 배지 분기: detected (옅은 녹 #dcfce7) / confirmed (진한 녹 #86efac + bold) 분리.
//
// 추가 (fixup 15o — T 잠금 확장 + 가스 입자 색 단일화, 사용자 비판 2건 단순 fix ~17줄):
//   · main.js dom.tPresets click handler — applyTemperature 자동 호출 폐기.
//     사용자 비판 "실험 중 온도 변경할 때 확인 안 눌러도 온도가 변해버린다" 직접 해소.
//     기존 흐름: 프리셋 클릭 → tInput.value 설정 + applyTemperature 자동 호출 (즉시 적용).
//     신규: 프리셋 클릭 = tInput.value 설정 + is-dirty class 추가 만. 학생 [입력] 클릭 또는
//          Enter 명시 확정 시 applyTemperature 호출 (pre-start / post-start 단일 메커니즘 통일).
//     tConfirmed flag 그대로 (분리 / 신규 flag 신설 X).
//   · drawMolecules 가스 입자 루프 KE 매핑 폐기 → 단일 색 cfg.gas_color (= #60a5fa, blue-400).
//     사용자 비판 "기체 입자 색깔 1가지 색으로, 물보다 약간 연한 색" 직접 해소.
//     액체 #1E40AF (blue-800) 보다 연한 파랑, 회색 배경 위 가시성 OK, 형광 노랑 lerp 자연.
//     params.json: gas_color 신규 키. color_KE_slow / fast / min / max 표면 입자 KE 매핑용으로 보존.
//     형광 노랑 birth flash (1.5s hold + 0.5s fade) / glow blur + stroke 보존.
//     vaporColorFromKE 함수 보존 (표면 입자에서만 사용).
//     가스 루프 안 KE 계산 (0.5×v²/ssq) + vaporColorFromKE 호출 폐기 → 단순화.
//
// 추가 (fixup 15q — 평형 배지 + [확정] 버튼 rate 카드 이동, 학습 흐름 정합, HTML+CSS only):
//   · 사용자 비판 2건:
//     - "평형 확정 버튼이 여기(rate 카드 영역) 있어야 할 것 같아"
//     - "이 메시지(평형 배지)도 속도 그래프 아래에 있어야 하고"
//   · 학습 흐름 정합: rate 그래프 두 선 만남 시각 단서 → 배지 색 변화 → [확정] 클릭 → 측정점 자동 추가.
//     인지 (rate 그래프) ↔ 액션 (확정) ↔ 결과 (배지 ★) 한 영역 통합.
//   · vapor.html .vapor-sim-header 안 #vapor-equilibrium-badge 제거 → .vapor-card-rate 안 그래프 직속 아래
//     신규 .vapor-rate-eq-row (배지 + [⊕ 평형 확정] 버튼 row) 추가.
//   · vapor.html measurement-region .vapor-measure-header 에서 #vapor-btn-record 제거 → [측정점 초기화] 단독.
//   · main.js: dom dict / click handler / disabled 조건 (15n) 모두 ID 보존, 0 변동.
//   · style.css: .vapor-rate-eq-row { flex space-between, 배지 + 버튼 } 추가.
//                .vapor-sim-mmol-info margin-left auto (배지 폐기 후 우측 정렬).
//   · 시뮬 헤더: 좌 ⏱ 경과 + 우 mmol 양측 정렬 (justify-content: space-between).
//
// 추가 (fixup 15r — rate 카드 배지+버튼 readouts 아래 이동 + spacing 균형, HTML+CSS only):
//   · 사용자 비판: "버튼과 알림 버튼(배지)을 숫자(readouts) 아래에 위치해주고 균형 있게 좀 떨어트려 놓고"
//   · vapor.html DOM 순서 (옵션 A — 자연):
//     15q: h4 → canvas → eq-row (배지+버튼) → readouts → note
//     15r: h4 → canvas → readouts → eq-row (배지+버튼) → note
//   · 학습 흐름 재정합: rate 그래프 시각 단서 → readouts 정량 확인 → 배지 색 변화 → [확정] 클릭.
//   · style.css spacing 균형: .vapor-rate-eq-row margin 8px → margin-top 16 + margin-bottom 12,
//                              gap 8 → 12, 버튼 padding 4×10 → 5×14, font 11 → 12 (CC 자율 균형값).
//
// 추가 (fixup 15p — 가스 입자 수 부활, T+P 카드 P 영역 하단 inline meta, 별도 카드 X):
//   · 사용자 비판: "압력 아래 빈 공간에 아까 삭제했던 입자 수 정보 여기 넣으면 되겠다"
//   · 의사결정 3단계 reversal:
//     - fixup 15g: 분자 수 카드 (.vapor-card-counter) 신규 (3 row: surface / gas / lattice + counts-note)
//     - fixup 15h: 분자 수 카드 통째 폐기 (시뮬 중심 단순화 흐름) + dom dict 3 항목 + readout 폐기
//     - fixup 15p: 가스 입자 수만 부활 (T+P 카드 P 영역 하단 inline, 별도 카드 X, surface/lattice 부활 X)
//   · 부활 위치: fixup 15m flex stretch + 15p P 영역 하단 inline → 빈 공간 자연 활용 (T+P 카드 height 자동).
//   · 학습 단서: 가스 입자 수 = 증기압 직접 source (정량 인지 보강). pressureKPa = total × ratio × k 식에서
//                 visible 입자 수가 학생에게 가시 정량값.
//   · vapor.html .vapor-pvap-particles 신규 (.vapor-pvap-meta 아래) + #vapor-gas-count strong.
//   · main.js dom dict gasCount 부활 + 200ms readout (world.gasParticles.length) + reset "—".
//   · style.css .vapor-pvap-particles small text + strong tabular-nums.
//   · world.gasCount getter (vapor.js, 15h 폐기 시 보존됨) 사용 가능 단 main.js 직접 world.gasParticles.length 호출.
//
// 추가 (fixup 15s — P 영역 그래픽화, 좌 SVG 압력계 + 우 LCD 시계 + 입자 막대, 시각 풍부 + Johnstone 통합):
//   · 사용자 비판: "뭔가 너무 비어보이는데 그래픽 써가면서 풍부하게"
//   · 사용자 명시: "입자 수와 압력을 동그란 아날로그 압력계로... 도달 시간은 전자시계 형태"
//   · Johnstone 3수준 통합 시각화: 시뮬 (입자 가시화) = 미시 / 측정 도구 (압력계 + 시계) = 거시 /
//                                    rate 그래프 + 비율 = 기호.
//   · vapor.html .vapor-tp-pressure 통째 교체:
//     - 폐기: .vapor-pvap-big / .vapor-pressure-bar-wrap / .vapor-pressure-bar / .vapor-pvap-meta /
//             .vapor-pvap-particles (15p 신규 → 15s 우측 영역으로 통합 이동).
//     - 신규: .vapor-tp-pressure-body (flex row 55:45) → .vapor-tp-pressure-left (SVG gauge) +
//             .vapor-tp-pressure-right (clock + particles).
//   · SVG 반원 압력계 (viewBox 200×120, 중심 pivot 100,105, arc radius 85):
//     - 배경 호 (회색 트랙) + 4 눈금 라벨 (0/10/20/30 kPa) + 바늘 + 중앙 큰 숫자.
//     - 바늘 동적 갱신: angle = (P/30)×180 - 90 clamp ±90° (CSS transform: rotate).
//     - 색: 호 #e2e8f0 / 바늘 #dc2626 (전통 압력계 정합) / pivot #1e293b / 라벨 #64748b.
//   · LCD 풍 전자시계 (어두운 배경 #0f172a + LED 진한 녹 #86efac + text-shadow 글로우):
//     - 형식 "MM:SS" padStart (예: "01:25"), 미도달 "—:—".
//     - monospace 폰트 + tabular-nums + 글자 spacing + 라벨 작은 대문자.
//   · 입자 수 막대 (정적 max 1000):
//     - 라벨 "가스 입자 N 개" (strong tabular-nums) + 막대 width = (n/1000)×100% clamp.
//     - 색 gradient #93c5fd → #60a5fa (가스 색 정합, 15o 단일 색).
//     - 정적 max 사유: 동적 max = visual jitter (입자 ↑↓ 시 막대 비례 흔들림) → 학습 가치 ↓.
//                      정적 1000 = T=65 평형 ~730 < 1000 안전 marg + 학생 T별 채움 시각 인지.
//   · main.js dom dict 변동: gaugeNeedle / particlesBar 신규, pressureBar 폐기.
//                            200ms readout: 바늘 angle + 시계 MM:SS + 막대 width 갱신.
//                            reset: 바늘 -90° + 시계 "—:—" + 막대 0% 정합.
//   · 768 미만 모바일 반응형: .vapor-tp-pressure-body flex-direction column (압력계 위 / 시계+막대 아래).
//   · 정공법 정합: 시각만 풍부, 데이터 source 그대로 (world.pressureKPa, world.equilibriumReachedAtSec,
//                  world.gasParticles.length). 모드 분기 (mock/real, 15j) 영향 X.
//
// docs/17 §6 참조.
// =============================================================

const VAPOR_DT_CAP = 0.05;
const VAPOR_MARGIN_PX = 12;

// ── 이론 p_vap 보간 (실측 표 기반) ──
function vaporInterpolatePvap(table, T_celsius) {
    if (!Array.isArray(table) || table.length === 0) return null;
    if (T_celsius <= table[0][0]) return table[0][1];
    if (T_celsius >= table[table.length - 1][0]) return table[table.length - 1][1];
    for (let i = 0; i < table.length - 1; i++) {
        const [T0, P0] = table[i];
        const [T1, P1] = table[i + 1];
        if (T_celsius >= T0 && T_celsius <= T1) {
            const t = (T_celsius - T0) / (T1 - T0);
            return P0 + t * (P1 - P0);
        }
    }
    return null;
}

// ── MB KE 샘플링 — 정규분포 근사 (mean=kT, stddev=kT/√2, max(0, .)) ──
function vaporSampleMBKE(kT) {
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, kT + z * kT / Math.SQRT2);
}

// ── KE → 색 (느림 진청 → 빠름 적, 단순 lerp) ──
function vaporColorFromKE(p, ke, slowColor, fastColor, keMin, keMax) {
    const t = Math.max(0, Math.min(1, (ke - keMin) / (keMax - keMin)));
    return p.lerpColor(slowColor, fastColor, t);
}

class VaporWorld {
    constructor(cfg, vFlaskMl, vLiquidMl, liquidType) {
        this.cfg = cfg;
        this.canvasW = cfg.canvas_width_px;
        this.canvasH = cfg.canvas_height_px;
        this.vFlaskMl = vFlaskMl;
        this.vLiquidMl = vLiquidMl;
        this.liquidType = liquidType || "water";

        // ── T 상태 (Boltzmann factor 기반 evap rate) ──
        this.T_celsius = cfg.T_default_celsius ?? 25.0;

        // ── 캔버스 = 시뮬 영역 전체 (rate 그래프는 별도 우측 카드 canvas 로 이동) ──
        this.box = {
            x: VAPOR_MARGIN_PX,
            y: VAPOR_MARGIN_PX,
            w: this.canvasW - 2 * VAPOR_MARGIN_PX,
            h: this.canvasH - 2 * VAPOR_MARGIN_PX,
        };

        const ratio = vLiquidMl / vFlaskMl;
        const liquidH = this.box.h * ratio;
        this.liquidTopY = this.box.y + this.box.h - liquidH;

        const r = cfg.molecule_radius_px ?? 4;
        this.r = r;
        const cellSize = 2 * r;
        const cols = Math.max(1, Math.floor(this.box.w / cellSize));

        const totalRows = Math.max(1, Math.floor(liquidH / cellSize));
        const liquidRows = Math.max(0, totalRows - 1);
        const surfaceRowIdx = liquidRows;

        // ── Liquid lattice (정적 격자) ──
        this.liquidLattice = [];
        for (let cy = 0; cy < liquidRows; cy++) {
            for (let cx = 0; cx < cols; cx++) {
                const x0 = this.box.x + (cx + 0.5) * cellSize;
                const y0 = this.box.y + this.box.h - (cy + 0.5) * cellSize;
                this.liquidLattice.push({ x0, y0, x: x0, y: y0 });
            }
        }

        // ── SurfaceParticle (KE = 시각용만, 비동기 Poisson 모델) ──
        // VISUAL_KT 는 시각 KE 분포 평균 (색 매핑용). 물리 게이트와 무관.
        const surfaceJitter = cfg.surface_jitter_amp_px ?? 2;
        this._visualKT = 1.0;
        this.surfaceParticles = [];
        for (let cx = 0; cx < cols; cx++) {
            const x0 = this.box.x + (cx + 0.5) * cellSize;
            const y0 = this.box.y + this.box.h - (surfaceRowIdx + 0.5) * cellSize;
            this.surfaceParticles.push(this._makeSurfaceParticle(x0, y0, surfaceJitter));
        }

        // ── Gas (시작 0, 증발만으로 생성) ──
        this.gasParticles = [];
        this.gasRadius = cfg.gas_particle_radius_px ?? 4;
        this.gasSpeedScale = cfg.gas_speed_scale ?? 50;
        this.gasDamping = cfg.gas_velocity_damping ?? 0.9995;
        this.gasGravity = cfg.gas_gravity ?? 0.0005;
        this.ceilingKERetention = cfg.ceiling_KE_retention ?? 0.85;

        // ── Ghost 풀 (보일 패턴 — 통계 안정성) ──
        // ghostSurface 800 + visible 80 = 880 표면, 모두 Boltzmann 게이트.
        // evap 시 visible_ratio (=0.1) 로 visible 분기, 나머지 ghost.
        // 통계 결합 (visible + ghost) × visible_ratio → 잡음 √0.1 감소.
        this.ghostVisibleRatio = cfg.ghost_gas_visible_ratio ?? 0.1;
        const ghostSurfaceN = cfg.ghost_surface_count ?? 800;
        this.ghostSurfaceParticles = [];
        for (let i = 0; i < ghostSurfaceN; i++) {
            // 위치 무관 (렌더 X). visual KE 만 의미 있음.
            this.ghostSurfaceParticles.push(this._makeSurfaceParticle(0, 0, 0));
        }
        this.ghostGasParticles = [];
        this._ghostEvapWin = 0;
        this._ghostCondWin = 0;

        // ── Flash queue (fixup 15a redo v4 — 매칭 폐기, 단순 자연 fade only) ──
        // hold (full alpha) + linear fade out → 자연 splice
        // 양쪽 독립 fade, 동시 visible 수 = 사건 빈도 비례
        this.flashes = [];

        // ── Condense location markers (표면 격자에 주황 ring 2초) ──
        this.condenseHighlights = [];

        // 시뮬 경과 시간 (학교 실험 정합 표시용)
        this.startT = performance.now();

        // 사건 누적
        this._evapWin = 0;
        this._condWin = 0;
        this._lastStatsT = performance.now();

        // 3초 raw rate 평활 버퍼 (rate_calc_window_sec)
        this._rateRawEvapBuf = [];
        this._rateRawCondBuf = [];

        // ── Rate 추적 (학습 핵심) ──
        this.rateHistory = [];          // {evap_raw, cond_raw, evap_ema, cond_ema}
        this.evapEMA = null;            // fixup 14: 워밍업 동안 null
        this.condEMA = null;
        this._emaPrimed = false;        // fixup 9: 첫 정상 tick 에 EMA prime (워밍업 lag 차단)
        this._ratePrimeBuf = null;      // fixup 15a: 첫 N tick raw 누적 → 평균 prime (잡음 prime 회피)
        // 평형 hysteresis 5-state (fixup 15d 4-state → fixup 15n 5-state, 학생 결정 분리)
        // state: "none" / "near" / "detected" (시뮬 hold 충족 자동) / "confirmed" (학생 [확정] 클릭) / "exited"
        this._equilibriumState = "none";
        this._equilibriumDetected = false;        // hold 10초 충족 = true (자동 감지)
        this._equilibriumConfirmed = false;       // 학생 [확정] 클릭 = true (학습 결정, 측정점 추가 트리거)
        this.equilibriumIdx = null;               // confirmed 시점에 set (rate ★ vertical line)
        this._equilibriumReachedAtSec = null;     // confirmed 시점에 set (도달 시각 표시)
        this._everReachedEquilibrium = false;     // boolean — 현재 detected 상태 (이탈 후 재감지 가능 위해 false)
        this._equilibriumHoldStart = null;        // 진입 zone hold 시작 시각 (performance.now ms)
        this._pressureSmoothed = 0;
        this._pressureSmoothedPrev = null;
        this._lastRelChange = 1.0;

        // mmol 계산
        this.N_total = this.liquidLattice.length + this.surfaceParticles.length;
    }

    // ── 외부 노출용 게터 (main.js DOM 갱신, real 모드 진입 시 사용) ──
    get pressureKPa() {
        // P = (visible + ghost) × visibleRatio × pressure_per_visible
        // 통계 결합으로 잡음 √visibleRatio (≈0.32) 만큼 감소
        const k = this.cfg.pressure_per_visible_gas_kPa ?? 0.06;
        const total = this.gasParticles.length + this.ghostGasParticles.length;
        return total * this.ghostVisibleRatio * k;
    }
    get pressureBarPct() {
        const max = this.cfg.pressure_gauge_max_kPa ?? 30;
        return Math.min(100, (this.pressureKPa / max) * 100);
    }
    get surfaceCount() { return this.surfaceParticles.length; }
    get gasCount() { return this.gasParticles.length; }
    get elapsedSec() { return (performance.now() - this.startT) / 1000; }
    get elapsedFormatted() {
        const sec = Math.max(0, Math.floor(this.elapsedSec));
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}분 ${String(s).padStart(2, "0")}초`;
    }

    // T 변경 (시뮬 리셋 X — 입자 그대로, 새 plateau 자연 도달)
    setTemperature(T_celsius) {
        this.T_celsius = T_celsius;
        // 평형 5-state reset (fixup 15n, T 변경 = 새 실험 조건 → detected + confirmed 모두 초기화)
        this._equilibriumState = "none";
        this._equilibriumDetected = false;
        this._equilibriumConfirmed = false;
        this.equilibriumIdx = null;
        this._equilibriumReachedAtSec = null;
        this._everReachedEquilibrium = false;
        this._equilibriumHoldStart = null;
        // fixup 15e: EMA 보존 (자연 수렴) — 시작 시점 prime 의도 (워밍업 lag 차단) 와
        // T 변경 시점 무관. 직전 EMA (3.5/s) 가 alpha 0.05 로 새 raw (11.1/s) 향해
        // 점진 수렴 (τ=20s, ~60s). 그래프 0 폭락 / spike 동시 해소.
        // 폐기: _emaPrimed / _ratePrimeBuf / evapEMA / condEMA reset (fixup 10 + 15a 재결정)
        // raw buf reset — 직전 T 잡음 잔재 회피 (3초 rolling buf 새 T 만 채움)
        this._rateRawEvapBuf = [];
        this._rateRawCondBuf = [];
        // fixup 10: relChange 점프 차단 (이전 T P 잔재 X)
        this._pressureSmoothedPrev = null;
        // pressure EMA 자체는 그대로 — 새 plateau 도달까지 자연 추적
        // fixup 15a redo v4 — T 변경 시 화살표 손대지 X (자연 fade 로 1초 내 정리)
    }

    // Boltzmann factor: rate(T) = base × exp(E_a × (1 - T_ref/T))
    // 정공법 회귀 — calibration 폐기. 시뮬 P 정량 정합 시도 X.
    evapRatePerParticlePerSec() {
        const base = this.cfg.base_evap_rate_per_particle_per_sec ?? 0.025;
        const E_a = this.cfg.E_a_normalized ?? 18.3;
        const T_ref_K = (this.cfg.reference_T_celsius ?? 25.0) + 273.15;
        const T_K = this.T_celsius + 273.15;
        return base * Math.exp(E_a * (1 - T_ref_K / T_K));
    }

    // 이론 p_vap (현재 T 와 액체 종류 기반 표 보간)
    get theoreticalPVap_kPa() {
        const tbl = this.cfg.liquids?.[this.liquidType]?.p_vap_table_celsius_to_kpa;
        return vaporInterpolatePvap(tbl, this.T_celsius);
    }

    // 평형도 % — ratio 기반 (fixup 13, 평형 판정 통일과 동일 metric)
    // 1.0 일 때 100%, ratio band 외 일수록 감소. 보존 (real 모드 재사용 가능).
    get equilibriumPercent() {
        if (this.evapEMA == null || this.evapEMA <= 0.05) return 0;
        const ratio = this.condEMA / this.evapEMA;
        const dist = Math.abs(ratio - 1.0);
        const band = Math.max(
            (this.cfg.equilibrium_ratio_max ?? 1.1) - 1.0,
            1.0 - (this.cfg.equilibrium_ratio_min ?? 0.9)
        );
        return Math.max(0, Math.min(100, (1 - dist / band) * 100));
    }

    // 평형 도달 시간 (학생 [확정] 시점 기록 — fixup 15n 학생 결정)
    get equilibriumReachedAtSec() {
        return this._equilibriumReachedAtSec ?? null;
    }
    // fixup 15n — 5-state getter (학생 결정 메커니즘)
    get equilibriumDetected() { return this._equilibriumDetected; }
    get equilibriumConfirmed() { return this._equilibriumConfirmed; }
    // legacy alias — drawVaporRateGraph2D ★ gate / main.js recordEquilibrium guard 등 backward compat.
    // 의미 = "학생 결정한 평형 시점" (confirmed=true, idx + reachedAtSec 모두 set 된 시점).
    get equilibriumReached() { return this._equilibriumConfirmed; }

    // 학생 [평형 확정] 클릭 핸들러 (fixup 15n).
    // 시뮬 detected 상태 (hold 10초 자동 충족) 일 때만 확정 가능.
    // 클릭 시: state="confirmed" + idx + reachedAtSec set → ★ 표시 + 측정점 추가 트리거.
    confirmEquilibrium() {
        if (!this._equilibriumDetected) return false;
        if (this._equilibriumConfirmed) return false;  // 이미 확정 시 재클릭 차단
        this._equilibriumState = "confirmed";
        this._equilibriumConfirmed = true;
        this.equilibriumIdx = this.rateHistory.length - 1;
        this._equilibriumReachedAtSec = this.elapsedSec;
        return true;
    }

    _makeSurfaceParticle(x0, y0, jitterAmp) {
        const ke = vaporSampleMBKE(this._visualKT);
        const targetChangeMs = (this.cfg.surface_KE_visual_target_change_sec ?? 2.0) * 1000;
        return {
            x0, y0,
            x: x0, y: y0,
            phase: Math.random() * Math.PI * 2,
            amp: jitterAmp,
            ke: ke,
            ke_target: ke,
            ke_target_next_change_t: performance.now() + Math.random() * targetChangeMs,
        };
    }

    update(dt) {
        const cap = Math.min(dt, VAPOR_DT_CAP);
        const tSec = performance.now() / 1000;

        // 1) Surface 매 frame: 위치 진동 + 시각 KE smooth update + Poisson 탈출 게이트
        this._updateSurfaceAndPoissonEvap(cap, tSec);

        // 2) Gas 자유 비행 + 충돌 + 벽 반사
        this._updateGas(cap);

        // 3) 응축 게이트
        this._evalCondensation();

        // 4) 매 frame P_internal EMA (평형 검출용 잡음 흡수)
        const P_alpha = this.cfg.p_internal_ema_alpha ?? 0.05;
        this._pressureSmoothed = P_alpha * this.pressureKPa + (1 - P_alpha) * this._pressureSmoothed;

        // 5) 매 1초: rate 샘플 + stats log
        this._maybeTickRateAndLog();
        // fixup 15a redo v4 — 매칭 로직 폐기 (drawFlashes 자연 fade only)
    }

    _updateSurfaceAndPoissonEvap(dt, tSec) {
        const cfg = this.cfg;
        const evapRate = this.evapRatePerParticlePerSec();
        const pEvapPerFrame = evapRate * dt;
        const smoothFactor = cfg.surface_KE_visual_smooth_factor ?? 0.05;
        const targetChangeMs = (cfg.surface_KE_visual_target_change_sec ?? 2.0) * 1000;
        const jitter = cfg.surface_jitter_amp_px ?? 2;
        const visualKT = this._visualKT;
        const visibleRatio = this.ghostVisibleRatio;
        const now = performance.now();

        // 가시 표면 — 위치/색 update + Poisson 게이트
        for (let i = 0; i < this.surfaceParticles.length; i++) {
            const sp = this.surfaceParticles[i];

            // 위치 좌우 진동
            sp.x = sp.x0 + sp.amp * Math.cos(2 * Math.PI * tSec + sp.phase);

            // 시각 KE smooth update
            if (now >= sp.ke_target_next_change_t) {
                sp.ke_target = vaporSampleMBKE(visualKT);
                sp.ke_target_next_change_t = now + targetChangeMs * (0.5 + Math.random());
            }
            sp.ke += (sp.ke_target - sp.ke) * smoothFactor + (Math.random() - 0.5) * 0.05;
            if (sp.ke < 0) sp.ke = 0;

            // Poisson 게이트
            if (Math.random() < pEvapPerFrame) {
                if (Math.random() < visibleRatio) {
                    this._spawnGasFromSurface(sp);  // visible
                } else {
                    this._spawnGasGhost();           // ghost
                }
                this.surfaceParticles[i] = this._makeSurfaceParticle(sp.x0, sp.y0, jitter);
            }
        }

        // Ghost 표면 — 위치/색 update X (렌더 X), 게이트만 평가
        for (let i = 0; i < this.ghostSurfaceParticles.length; i++) {
            if (Math.random() < pEvapPerFrame) {
                if (Math.random() < visibleRatio) {
                    // ghost 표면 → visible 가스. 위치는 random visible surface 에서 spawn
                    const idx = Math.floor(Math.random() * this.surfaceParticles.length);
                    this._spawnGasFromSurface(this.surfaceParticles[idx]);
                } else {
                    this._spawnGasGhost();
                }
                // ghost 표면 재샘플 (위치 무관, KE 시각 X)
                this.ghostSurfaceParticles[i] = this._makeSurfaceParticle(0, 0, 0);
            }
        }
    }

    // Ghost 가스 spawn (렌더 X, flash X, birth_time X)
    _spawnGasGhost() {
        const speedScale = this.gasSpeedScale;
        const keMin = this.cfg.gas_spawn_KE_min ?? 2.0;
        const keMax = this.cfg.gas_spawn_KE_max ?? 4.0;
        const ke = keMin + Math.random() * (keMax - keMin);
        const speed = Math.sqrt(2 * ke) * speedScale;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 4);
        const vx = speed * Math.cos(angle);
        const vy = speed * Math.sin(angle);
        const x = this.box.x + Math.random() * this.box.w;
        const y = this.liquidTopY - this.gasRadius - 1;
        this.ghostGasParticles.push({ x, y, vx, vy, ke_at_birth: ke });
        this._ghostEvapWin++;
    }

    _updateGas(dt) {
        const r = this.gasRadius;
        const z = this.box;
        const left = z.x + r, right = z.x + z.w - r;
        const top = z.y + r, bottom = z.y + z.h - r;
        const dampingFactor = Math.pow(this.gasDamping, dt);  // dt-scaled
        const ceilingVScale = Math.sqrt(this.ceilingKERetention); // KE retention → v scale
        const gravity = this.gasGravity;
        for (const g of this.gasParticles) {
            // 약한 중력 (per frame)
            g.vy += gravity;
            // 약한 점성 (dt-scaled)
            g.vx *= dampingFactor;
            g.vy *= dampingFactor;
            // 위치 갱신
            g.x += g.vx * dt;
            g.y += g.vy * dt;
            // 좌우 벽 (탄성)
            if (g.x < left  && g.vx < 0) g.vx = -g.vx;
            if (g.x > right && g.vx > 0) g.vx = -g.vx;
            // 천장 (KE 손실 — 응축 후보 ↑)
            if (g.y < top   && g.vy < 0) {
                g.vy = -g.vy * ceilingVScale;
                g.vx *= ceilingVScale;
            }
            // 바닥 (탄성, 정상 조건에선 응축 게이트가 먼저 처리)
            if (g.y > bottom && g.vy > 0) g.vy = -g.vy;
            // clamp
            if (g.x < left)        g.x = left;
            else if (g.x > right)  g.x = right;
            if (g.y < top)         g.y = top;
            else if (g.y > bottom) g.y = bottom;
        }
        // hard sphere 충돌 (등질량 impulse) — 가시 가스만 (ghost 가스 충돌 X, O(N²) 부담 회피)
        const n = this.gasParticles.length;
        const minD = 2 * r;
        const minD2 = minD * minD;
        for (let i = 0; i < n; i++) {
            const a = this.gasParticles[i];
            for (let j = i + 1; j < n; j++) {
                const b = this.gasParticles[j];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < minD2 && d2 > 1e-9) {
                    const d = Math.sqrt(d2);
                    const nx = dx / d, ny = dy / d;
                    const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
                    const vn = dvx * nx + dvy * ny;
                    if (vn < 0) {
                        const j_imp = -vn;
                        a.vx -= j_imp * nx; a.vy -= j_imp * ny;
                        b.vx += j_imp * nx; b.vy += j_imp * ny;
                        const overlap = (minD - d) * 0.5;
                        a.x -= nx * overlap; a.y -= ny * overlap;
                        b.x += nx * overlap; b.y += ny * overlap;
                    }
                }
            }
        }

        // Ghost 가스 — 단순 물리 (중력 + 점성 + 벽 + 천장 KE 손실), 충돌 X
        for (const g of this.ghostGasParticles) {
            g.vy += gravity;
            g.vx *= dampingFactor;
            g.vy *= dampingFactor;
            g.x += g.vx * dt;
            g.y += g.vy * dt;
            if (g.x < left  && g.vx < 0) g.vx = -g.vx;
            if (g.x > right && g.vx > 0) g.vx = -g.vx;
            if (g.y < top   && g.vy < 0) {
                g.vy = -g.vy * ceilingVScale;
                g.vx *= ceilingVScale;
            }
            if (g.y > bottom && g.vy > 0) g.vy = -g.vy;
            if (g.x < left)        g.x = left;
            else if (g.x > right)  g.x = right;
            if (g.y < top)         g.y = top;
            else if (g.y > bottom) g.y = bottom;
        }
    }

    // Gas spawn — 표면 시각 KE 와 무관하게 [min, max] uniform 샘플
    // (사용자 통찰: KE 시뮬 폐기, 사건 확률만 관리)
    _spawnGasFromSurface(sp) {
        const speedScale = this.gasSpeedScale;
        const keMin = this.cfg.gas_spawn_KE_min ?? 2.0;
        const keMax = this.cfg.gas_spawn_KE_max ?? 4.0;
        const ke = keMin + Math.random() * (keMax - keMin);
        const speed = Math.sqrt(2 * ke) * speedScale;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 4);
        const vx = speed * Math.cos(angle);
        const vy = speed * Math.sin(angle);
        this.gasParticles.push({
            x: sp.x, y: sp.y - this.gasRadius - 1,
            vx, vy,
            ke_at_birth: ke,
            birth_time: performance.now(),
        });
        this._evapWin++;
        this._addFlash(sp.x, sp.y, this.cfg.evap_flash_color || "#2563EB", "up");
    }

    _addFlash(x, y, colorStr, dir) {
        // fixup 15a redo v4 — 단순 push (매칭 / max cap 폐기, 자연 fade 만)
        this.flashes.push({
            x, y, color: colorStr,
            dir: dir || "up",  // "up" = 증발 / "down" = 응축
            t_start: performance.now(),
        });
    }

    _evalCondensation() {
        const E_capture = this.cfg.E_capture ?? 2.5;
        const speedScale = this.gasSpeedScale;
        const ssq = speedScale * speedScale;
        const liquidTop = this.liquidTopY;
        const condColor = this.cfg.cond_flash_color || "#EA580C";

        // Visible 가스 — flash + cond highlight 마커
        const remain = [];
        for (const g of this.gasParticles) {
            if (g.vy > 0 && g.y >= liquidTop - 5) {
                const ke = 0.5 * (g.vx * g.vx + g.vy * g.vy) / ssq;
                if (ke < E_capture) {
                    this._condWin++;
                    this._addFlash(g.x, liquidTop, condColor, "down");
                    const cellSize = 2 * this.r;
                    const colIdx = Math.floor((g.x - this.box.x) / cellSize);
                    const sp = this.surfaceParticles[
                        Math.max(0, Math.min(this.surfaceParticles.length - 1, colIdx))
                    ];
                    if (sp) {
                        this.condenseHighlights.push({
                            x: sp.x0, y: sp.y0,
                            t_start: performance.now(),
                        });
                    }
                    continue;
                } else {
                    g.vy = -g.vy;
                    g.y = liquidTop - 5;
                }
            }
            remain.push(g);
        }
        this.gasParticles = remain;

        // Ghost 가스 — 통계만 (flash X, marker X)
        const ghostRemain = [];
        for (const g of this.ghostGasParticles) {
            if (g.vy > 0 && g.y >= liquidTop - 5) {
                const ke = 0.5 * (g.vx * g.vx + g.vy * g.vy) / ssq;
                if (ke < E_capture) {
                    this._ghostCondWin++;
                    continue;
                } else {
                    g.vy = -g.vy;
                    g.y = liquidTop - 5;
                }
            }
            ghostRemain.push(g);
        }
        this.ghostGasParticles = ghostRemain;
    }

    _maybeTickRateAndLog() {
        const now = performance.now();
        const elapsed = now - this._lastStatsT;
        if (elapsed < 1000) return;
        const elapsedSec = elapsed / 1000;
        // 통계 결합 — visible + ghost 모두 포함, visible-equivalent 로 정규화 (× visibleRatio)
        // 잡음 √visibleRatio (≈0.32) 만큼 감소
        const totalEvap = this._evapWin + this._ghostEvapWin;
        const totalCond = this._condWin + this._ghostCondWin;
        const evap1s = totalEvap * this.ghostVisibleRatio / elapsedSec;
        const cond1s = totalCond * this.ghostVisibleRatio / elapsedSec;

        // 3초 rolling 평균 (rate_calc_window_sec) → 들쭉날쭉 평활
        const calcWin = Math.max(1, Math.round(this.cfg.rate_calc_window_sec ?? 3.0));
        this._rateRawEvapBuf.push(evap1s);
        this._rateRawCondBuf.push(cond1s);
        while (this._rateRawEvapBuf.length > calcWin) this._rateRawEvapBuf.shift();
        while (this._rateRawCondBuf.length > calcWin) this._rateRawCondBuf.shift();
        const evapRaw = this._rateRawEvapBuf.reduce((s, v) => s + v, 0) / this._rateRawEvapBuf.length;
        const condRaw = this._rateRawCondBuf.reduce((s, v) => s + v, 0) / this._rateRawCondBuf.length;

        // 워밍업 — 첫 W tick 폐기 (rate_warmup_ticks, 평균 시작 전 폐기, fixup 15a 의미 갱신)
        const warmupTicks = this.cfg.rate_warmup_ticks ?? 2;
        if (this.rateHistory.length < warmupTicks) {
            this.rateHistory.push({
                evap_raw: evapRaw, cond_raw: condRaw,
                evap_ema: null, cond_ema: null,
            });
            this._evapWin = 0; this._condWin = 0;
            this._ghostEvapWin = 0; this._ghostCondWin = 0;
            this._lastStatsT = now;
            return;
        }

        // EMA prime — 첫 N tick raw 평균으로 초기화 (fixup 15a — 잡음 prime 회피)
        // 평균 누적 동안 EMA null, N 도달 시 평균값으로 prime + 통상 push 진행
        if (!this._emaPrimed) {
            const primeTicks = this.cfg.rate_ema_prime_avg_ticks ?? 5;
            if (!this._ratePrimeBuf) this._ratePrimeBuf = { evap: [], cond: [] };
            this._ratePrimeBuf.evap.push(evapRaw);
            this._ratePrimeBuf.cond.push(condRaw);

            if (this._ratePrimeBuf.evap.length < primeTicks) {
                // 누적 중 — EMA null 유지
                this.rateHistory.push({
                    evap_raw: evapRaw, cond_raw: condRaw,
                    evap_ema: null, cond_ema: null,
                });
                this._evapWin = 0; this._condWin = 0;
                this._ghostEvapWin = 0; this._ghostCondWin = 0;
                this._lastStatsT = now;
                return;
            }
            // N tick 도달 — 평균으로 prime
            const evapAvg = this._ratePrimeBuf.evap.reduce((s, v) => s + v, 0) / primeTicks;
            const condAvg = this._ratePrimeBuf.cond.reduce((s, v) => s + v, 0) / primeTicks;
            this.evapEMA = evapAvg;
            this.condEMA = condAvg;
            this._emaPrimed = true;
            this._ratePrimeBuf = null;
        } else {
            const alpha = this.cfg.rate_ema_alpha ?? 0.1;
            this.evapEMA = alpha * evapRaw + (1 - alpha) * this.evapEMA;
            this.condEMA = alpha * condRaw + (1 - alpha) * this.condEMA;
        }

        // 누적 (sliding window 폐기) — 시작부터 max_time_sec 까지 보관
        this.rateHistory.push({
            evap_raw: evapRaw,
            cond_raw: condRaw,
            evap_ema: this.evapEMA,
            cond_ema: this.condEMA,
        });
        const maxTime = this.cfg.rate_graph_max_time_sec ?? 1800;
        while (this.rateHistory.length > maxTime) {
            this.rateHistory.shift();
            // index 무관 (eq line 은 max 도달 후에는 이미 한참 지난 시점이라 시각 영향 X)
        }

        // 평형 5-state (fixup 15n) — 진입 [0.9, 1.1] / 이탈 [0.85, 1.15] hysteresis 보존.
        // 5 상태: none / near / detected (시뮬 hold 자동) / confirmed (학생 결정) / exited.
        // detected → confirmed 는 학생 [확정] 클릭으로만 (confirmEquilibrium method).
        // confirmed = sticky (T 변경까지 학생 결정 보존). exit zone 외 시 state="exited" (★ 보존).
        // P_internal 변화율 보존 (real 모드 재사용 — 변경 X).
        const eqMin = this.cfg.equilibrium_ratio_min ?? 0.9;
        const eqMax = this.cfg.equilibrium_ratio_max ?? 1.1;
        const eqExitMin = this.cfg.equilibrium_exit_ratio_min ?? 0.85;
        const eqExitMax = this.cfg.equilibrium_exit_ratio_max ?? 1.15;
        const holdSec = this.cfg.equilibrium_hold_sec ?? 10;
        const ratio = (this.evapEMA != null && this.evapEMA > 0.05) ? (this.condEMA / this.evapEMA) : null;

        // 진단용 P 변화율 보존 (real 모드 재사용)
        const dP = this._pressureSmoothed - (this._pressureSmoothedPrev ?? this._pressureSmoothed);
        this._lastRelChange = this._pressureSmoothed > 0.01
            ? Math.abs(dP) / this._pressureSmoothed
            : 1.0;
        this._pressureSmoothedPrev = this._pressureSmoothed;

        const inEnterBand = ratio != null && ratio >= eqMin && ratio <= eqMax;
        const inExitBand = ratio != null && ratio >= eqExitMin && ratio <= eqExitMax;

        if (this._equilibriumConfirmed) {
            // 학생 결정 후 sticky — exit zone 안 = "confirmed" 유지, 외 = "exited" (★ 보존)
            this._equilibriumState = inExitBand ? "confirmed" : "exited";
            // _equilibriumDetected / idx / reachedAtSec 모두 confirmed 시점에 set, 변동 X.
        } else if (!this._everReachedEquilibrium) {
            // 미감지 또는 detected 후 이탈 → 재시도 모드
            if (inEnterBand) {
                if (this._equilibriumHoldStart == null) {
                    this._equilibriumHoldStart = now;
                }
                const heldSec = (now - this._equilibriumHoldStart) / 1000;
                if (heldSec >= holdSec) {
                    // 자동 감지 충족 — 학생 [확정] 대기 상태
                    this._equilibriumState = "detected";
                    this._equilibriumDetected = true;
                    this._everReachedEquilibrium = true;
                    // idx / reachedAtSec 는 confirm 시점에 set, 여기서 X.
                } else {
                    this._equilibriumState = "near";
                }
            } else if (inExitBand) {
                this._equilibriumHoldStart = null;
                this._equilibriumState = "near";
            } else {
                this._equilibriumHoldStart = null;
                this._equilibriumState = "none";
            }
        } else {
            // detected 상태 (자동 감지, 학생 미확정) — 이탈 band 안 시 유지, 외 시 "exited"
            if (inExitBand) {
                this._equilibriumState = "detected";  // 학생 확정 대기 유지
            } else {
                this._equilibriumState = "exited";
                this._everReachedEquilibrium = false;
                this._equilibriumDetected = false;  // 재감지 가능
                this._equilibriumHoldStart = null;
                // confirmed X 였으므로 idx / reachedAtSec 도 null 그대로.
            }
        }

        // 콘솔
        let dbg = "";
        if (this.gasParticles.length > 0) {
            const g0 = this.gasParticles[0];
            const ssq = this.gasSpeedScale * this.gasSpeedScale;
            const ke0 = 0.5 * (g0.vx * g0.vx + g0.vy * g0.vy) / ssq;
            dbg = ` · gas[0] KE=${ke0.toFixed(2)}`;
        }
        const eqTag = (this._equilibriumState === "confirmed") ? " · 평형 확정 ★"
                    : (this._equilibriumState === "detected") ? " · 평형 감지"
                    : (this._equilibriumState === "exited")   ? " · 평형 이탈"
                    : (this._equilibriumState === "near")     ? " · 평형 근접"
                    : "";
        const Pth = this.theoreticalPVap_kPa;
        const PthTag = (typeof Pth === "number") ? ` (이론 ${Pth.toFixed(1)})` : "";
        console.log(`[Vapor] T=${this.T_celsius.toFixed(0)}°C · evap=${evapRaw.toFixed(2)}/s (ema=${this.evapEMA.toFixed(2)}) · cond=${condRaw.toFixed(2)}/s (ema=${this.condEMA.toFixed(2)}) · gas=${this.gasParticles.length} · P=${this.pressureKPa.toFixed(2)}kPa${PthTag}${dbg}${eqTag}`);

        this._evapWin = 0;
        this._condWin = 0;
        this._ghostEvapWin = 0;
        this._ghostCondWin = 0;
        this._lastStatsT = now;
    }

    drawWalls(p) {
        p.noFill();
        p.stroke(180);
        p.strokeWeight(1);
        p.rect(this.box.x, this.box.y, this.box.w, this.box.h);

        p.stroke(120, 150, 200, 140);
        p.strokeWeight(1);
        if (p.drawingContext && typeof p.drawingContext.setLineDash === "function") {
            p.drawingContext.setLineDash([4, 4]);
            p.line(this.box.x, this.liquidTopY, this.box.x + this.box.w, this.liquidTopY);
            p.drawingContext.setLineDash([]);
        } else {
            p.line(this.box.x, this.liquidTopY, this.box.x + this.box.w, this.liquidTopY);
        }
    }

    drawMolecules(p) {
        const cfg = this.cfg;
        const r = this.r;
        const liquidColor = p.color(cfg.liquid_color || "#1E40AF");
        const liquidOpacity = cfg.liquid_opacity ?? 1.0;
        liquidColor.setAlpha(Math.max(0, Math.min(255, Math.round(liquidOpacity * 255))));
        const slow = p.color(cfg.color_KE_slow || "#1E3A8A");
        const fast = p.color(cfg.color_KE_fast || "#DC2626");
        const keMin = cfg.color_KE_min_for_HSB ?? 0.0;
        const keMax = cfg.color_KE_max_for_HSB ?? 5.0;

        // Liquid lattice (톤 다운된 단색 + opacity)
        p.noStroke();
        p.fill(liquidColor);
        for (const m of this.liquidLattice) {
            p.circle(m.x, m.y, r * 2);
        }

        // Surface particles (반투명, KE 색)
        const surfaceOpacity = cfg.surface_opacity ?? 0.55;
        const surfaceAlpha = Math.max(0, Math.min(255, Math.round(surfaceOpacity * 255)));
        for (const sp of this.surfaceParticles) {
            const col = vaporColorFromKE(p, sp.ke, slow, fast, keMin, keMax);
            col.setAlpha(surfaceAlpha);
            p.fill(col);
            p.circle(sp.x, sp.y, r * 2);
        }

        // Gas particles — fixup 15o: KE 매핑 폐기 → 단일 색 (cfg.gas_color, 액체보다 연한 파랑).
        //                  막 나온 입자는 형광 노랑 전체 색 (1.5s hold + 0.5s fade) + glow 보존.
        const gasR = this.gasRadius;
        const fluorYellowStr = cfg.gas_birth_color_fluorescent || "#FCD34D";
        const holdMs = (cfg.gas_birth_fluor_hold_sec ?? 1.5) * 1000;
        const fadeMs = (cfg.gas_birth_fluor_fade_sec ?? 0.5) * 1000;
        const totalMs = holdMs + fadeMs;
        const fluorStrokePx = cfg.gas_birth_stroke_px ?? 4.5;
        const fluorBlur = cfg.gas_birth_glow_blur_px ?? 25;
        const gasColor = p.color(cfg.gas_color || "#60a5fa");  // fixup 15o 단일 가스 색
        const now = performance.now();
        for (const g of this.gasParticles) {
            const ageMs = now - (g.birth_time || 0);
            let fillCol;
            let fluorAlpha = 0;
            if (ageMs < holdMs) {
                fillCol = p.color(fluorYellowStr);
                fluorAlpha = 1.0;
            } else if (ageMs < totalMs) {
                const t = (ageMs - holdMs) / fadeMs;
                fillCol = p.lerpColor(p.color(fluorYellowStr), gasColor, t);
                fluorAlpha = 1 - t;
            } else {
                fillCol = gasColor;
                fluorAlpha = 0;
            }

            if (fluorAlpha > 0) {
                if (p.drawingContext) {
                    p.drawingContext.shadowColor = fluorYellowStr;
                    p.drawingContext.shadowBlur = fluorBlur * fluorAlpha;
                }
                const stCol = p.color(fluorYellowStr);
                stCol.setAlpha(fluorAlpha * 255);
                p.stroke(stCol);
                p.strokeWeight(fluorStrokePx);
            } else {
                p.noStroke();
                if (p.drawingContext) {
                    p.drawingContext.shadowBlur = 0;
                }
            }
            p.fill(fillCol);
            p.circle(g.x, g.y, gasR * 2);
        }
        // Reset state after gas loop
        if (p.drawingContext) p.drawingContext.shadowBlur = 0;
        p.noStroke();
    }

    // ── Condense location markers (표면 격자에 형광 핑크 전체 색 + 외곽 펄스) ──
    drawCondenseHighlights(p) {
        const cfg = this.cfg;
        const holdMs = (cfg.condense_grid_fluor_hold_sec ?? 1.5) * 1000;
        const fadeMs = (cfg.condense_grid_fluor_fade_sec ?? 0.5) * 1000;
        const totalMs = holdMs + fadeMs;
        const sw = cfg.condense_grid_stroke_px ?? 4.5;
        const blur = cfg.condense_grid_glow_blur_px ?? 25;
        const colorStr = cfg.condense_grid_color_fluorescent || "#F472B6";
        const pulseDur = (cfg.condense_pulse_duration_sec ?? 1.0) * 1000;
        const pulseRMax = cfg.condense_pulse_radius_max_px ?? 24;
        const ringR = this.r + 1;
        const now = performance.now();
        const remain = [];

        for (const ch of this.condenseHighlights) {
            const elapsed = now - ch.t_start;
            if (elapsed >= totalMs) continue;

            // 외곽 펄스 (반경 r+1 → pulseRMax, 1초)
            if (elapsed < pulseDur) {
                const pt = elapsed / pulseDur;
                const pulseR = ringR + pt * (pulseRMax - ringR);
                const pulseCol = p.color(colorStr);
                pulseCol.setAlpha((1 - pt) * 200);
                p.noFill();
                p.stroke(pulseCol);
                p.strokeWeight(2);
                if (p.drawingContext) p.drawingContext.shadowBlur = 0;
                p.circle(ch.x, ch.y, pulseR * 2);
            }

            // 내부 형광 핑크 (1.5s hold + 0.5s fade) + glow + stroke
            let fillAlpha = 1.0;
            if (elapsed > holdMs) {
                fillAlpha = 1 - (elapsed - holdMs) / fadeMs;
            }
            const fillCol = p.color(colorStr);
            fillCol.setAlpha(fillAlpha * 255);
            const strokeCol = p.color(colorStr);
            strokeCol.setAlpha(fillAlpha * 255);
            if (p.drawingContext) {
                p.drawingContext.shadowColor = colorStr;
                p.drawingContext.shadowBlur = blur * fillAlpha;
            }
            p.stroke(strokeCol);
            p.strokeWeight(sw);
            p.fill(fillCol);
            p.circle(ch.x, ch.y, ringR * 2);

            remain.push(ch);
        }
        // Reset state
        if (p.drawingContext) p.drawingContext.shadowBlur = 0;
        p.noStroke();
        this.condenseHighlights = remain;
    }

    // ── Flash queue 렌더 (fixup 15a redo v4 — hold + linear fade, 양쪽 독립) ──
    drawFlashes(p) {
        const cfg = this.cfg;
        const durationMs = (cfg.flash_duration_sec ?? 1.0) * 1000;
        const holdMs = (cfg.flash_hold_sec ?? 0.5) * 1000;
        const fadeMs = Math.max(1, durationMs - holdMs);
        const arrowLen = cfg.flash_arrow_length_px ?? 30;
        const arrowThick = cfg.flash_arrow_thickness_px ?? 2.5;
        const headSize = 5;
        const now = performance.now();
        const remain = [];

        for (const f of this.flashes) {
            const elapsed = now - f.t_start;
            if (elapsed >= durationMs) continue;
            const alpha = (elapsed < holdMs)
                ? 255
                : Math.max(0, (1 - (elapsed - holdMs) / fadeMs)) * 255;
            const col = p.color(f.color);
            col.setAlpha(alpha);
            // 화살표
            //   up   (증발): tail 표면, tip 위 (기체 영역)
            //   down (응축): tail 표면 위 arrowLen px (기체 영역), tip 표면 살짝 위
            let tail, tip;
            if (f.dir === "down") {
                tail = f.y - arrowLen;
                tip = f.y - 1;
            } else {
                tail = f.y;
                tip = f.y - arrowLen;
            }
            p.noFill();
            p.stroke(col);
            p.strokeWeight(arrowThick);
            p.line(f.x, tail, f.x, tip);
            // 화살촉
            p.noStroke();
            const fillCol = p.color(f.color);
            fillCol.setAlpha(alpha);
            p.fill(fillCol);
            const baseY = f.dir === "down" ? tip - headSize : tip + headSize;
            p.triangle(f.x, tip, f.x - headSize * 0.7, baseY, f.x + headSize * 0.7, baseY);
            remain.push(f);
        }
        this.flashes = remain;
    }

}

// ── RateMiniGraph (학습 핵심: evap=일정, cond=점진 증가, 평형=만남) ──
// 우측 카드 안 별도 <canvas> 에 Canvas 2D API 로 직접 렌더 (sim 캔버스와 분리).
function vaporHexToRgba(hex, alpha) {
    const m = (hex || "#000000").replace("#", "");
    const r = parseInt(m.substring(0, 2), 16);
    const g = parseInt(m.substring(2, 4), 16);
    const b = parseInt(m.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawVaporRateGraph2D(ctx, world, cfg, W, H) {
    const evapColor = cfg.rate_color_evap || "#2563EB";
    const condColor = cfg.rate_color_cond || "#EA580C";
    const yMin = cfg.rate_y_min ?? 1.0;
    const scaleFactor = cfg.rate_y_auto_scale_factor ?? 1.2;
    const initialX = cfg.rate_graph_initial_x_sec ?? 60;

    // y 자동 스케일 (fixup 14 — 워밍업 동안 EMA null skip)
    let peak = 0;
    if (world.evapEMA != null) peak = Math.max(peak, world.evapEMA);
    if (world.condEMA != null) peak = Math.max(peak, world.condEMA);
    for (const r of world.rateHistory) {
        if (r.evap_ema != null) peak = Math.max(peak, r.evap_ema);
        if (r.cond_ema != null) peak = Math.max(peak, r.cond_ema);
    }
    const yMax = Math.max(yMin, peak * scaleFactor);

    // x 자동 스케일 — sliding window 폐기, 시작부터 누적
    // n 이 initialX 보다 작으면 0 ~ initialX 표시 (빈 영역 포함)
    // n >= initialX 면 0 ~ n (전체 timeline 압축)
    const n = world.rateHistory.length;
    const xMaxSec = Math.max(initialX, n);

    // 배경
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, W, H);

    const padL = 8, padR = 8, padT = 22, padB = 14;
    const innerX = padL;
    const innerY = padT;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    // 중간 보조선
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerX, innerY + innerH / 2);
    ctx.lineTo(innerX + innerW, innerY + innerH / 2);
    ctx.stroke();

    // 범례
    ctx.fillStyle = evapColor;
    ctx.fillRect(8, 7, 10, 4);
    ctx.fillStyle = "#1e293b";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("증발", 22, 4);

    ctx.fillStyle = condColor;
    ctx.fillRect(56, 7, 10, 4);
    ctx.fillStyle = "#1e293b";
    ctx.fillText("응축", 70, 4);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px sans-serif";
    ctx.fillText("rate /s (EMA)", 110, 5);

    // 데이터 부족
    if (!world.rateHistory || world.rateHistory.length < 1) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("데이터 수집 중...", W - 8, 5);
        return;
    }

    // 누적 x: index i (= 절대 시간 초) 를 0 ~ xMaxSec 로 매핑
    const denom = Math.max(1, xMaxSec - 1);
    const mapX = (i) => innerX + (innerW * i) / denom;
    const mapY = (rate) => innerY + innerH - (innerH * Math.min(rate, yMax)) / yMax;

    // fixup 14 — 워밍업 tick (evap_ema/cond_ema null) 건너뜀
    let firstIdx = 0;
    while (firstIdx < n && world.rateHistory[firstIdx].evap_ema == null) firstIdx++;
    if (firstIdx >= n) {
        // 전부 워밍업 — 그래프 데이터 X
        ctx.fillStyle = "#94a3b8";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("데이터 수집 중...", W - 8, 5);
        return;
    }

    // 두 곡선 사이 fill
    ctx.fillStyle = vaporHexToRgba(condColor, 0.16);
    ctx.beginPath();
    ctx.moveTo(mapX(firstIdx), mapY(world.rateHistory[firstIdx].evap_ema));
    for (let i = firstIdx + 1; i < n; i++) {
        ctx.lineTo(mapX(i), mapY(world.rateHistory[i].evap_ema));
    }
    for (let i = n - 1; i >= firstIdx; i--) {
        ctx.lineTo(mapX(i), mapY(world.rateHistory[i].cond_ema));
    }
    ctx.closePath();
    ctx.fill();

    // Evap 곡선
    ctx.strokeStyle = evapColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mapX(firstIdx), mapY(world.rateHistory[firstIdx].evap_ema));
    for (let i = firstIdx + 1; i < n; i++) {
        ctx.lineTo(mapX(i), mapY(world.rateHistory[i].evap_ema));
    }
    ctx.stroke();

    // Cond 곡선
    ctx.strokeStyle = condColor;
    ctx.beginPath();
    ctx.moveTo(mapX(firstIdx), mapY(world.rateHistory[firstIdx].cond_ema));
    for (let i = firstIdx + 1; i < n; i++) {
        ctx.lineTo(mapX(i), mapY(world.rateHistory[i].cond_ema));
    }
    ctx.stroke();

    // 평형 vertical line
    if (world.equilibriumReached && world.equilibriumIdx != null && world.equilibriumIdx >= 0) {
        const ex = mapX(world.equilibriumIdx);
        ctx.strokeStyle = "#16a34a";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(ex, innerY);
        ctx.lineTo(ex, innerY + innerH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#16a34a";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("평형 도달", ex + 4, innerY + 2);
    }

    // y 라벨
    ctx.fillStyle = "#94a3b8";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`${yMax.toFixed(1)}`, W - 4, innerY - 1);
    ctx.textBaseline = "alphabetic";
    ctx.fillText("0", W - 4, innerY + innerH + 9);

    // x 라벨 (시간축, 누적 스케일)
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText("0s", innerX, innerY + innerH + 11);
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(xMaxSec)}s`, innerX + innerW, innerY + innerH + 11);
}

function mountVaporSketch(world, container) {
    const sketch = (p) => {
        let lastT = performance.now();
        p.setup = () => {
            p.createCanvas(world.canvasW, world.canvasH);
            p.frameRate(50);
        };
        p.draw = () => {
            const now = performance.now();
            const dt = Math.min((now - lastT) / 1000, VAPOR_DT_CAP);
            lastT = now;
            world.update(dt);
            p.background(248, 250, 252);
            world.drawWalls(p);
            world.drawMolecules(p);
            world.drawCondenseHighlights(p);
            world.drawFlashes(p);
            // rate 그래프는 우측 카드 별도 canvas (drawVaporRateGraph2D) 로 이동.
        };
    };
    return new p5(sketch, container);
}
