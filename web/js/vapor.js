// =============================================================
// vapor.js — 증기압 시뮬 본체
// Phase 6.1-b finalization fixup 15d (rate ema 안정화 + 평형 hysteresis 4-state)
//
// 핵심 철학 (정공법):
//   학생 가시 = 실측 / 시뮬 = 미시 가시화 (정성적)
//   우측 상단 = "센서 영역" (T + P 카드 통합, fixup 12)
//     · mock 모드: T 입력 (number input + 5 프리셋, fixup 11+12 integrated) / P placeholder
//     · real 모드 (Phase 6.3+): T 실측 + P 실측 자동 표시 (DOM 보존, class 분기로 자연 전환)
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
// 폐기 (fixup 누적 1~15d):
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
        // 평형 hysteresis 4-state (fixup 15d)
        this.equilibriumReached = false;          // === (_equilibriumState === "reached")
        this.equilibriumIdx = null;               // 도달 시점 rateHistory index (rate ★ vertical line)
        this._equilibriumReachedAtSec = null;     // 도달 시각 (학생 표시용 — mock 비공개)
        this._equilibriumState = "none";          // "none" / "near" / "reached" / "exited"
        this._everReachedEquilibrium = false;     // boolean — 현재 평형 상태 (도달 후 이탈 시 false)
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
        // 평형 hysteresis 4-state reset (fixup 15d, T 변경 시 history 무관)
        this.equilibriumReached = false;
        this.equilibriumIdx = null;
        this._equilibriumReachedAtSec = null;
        this._equilibriumState = "none";
        this._everReachedEquilibrium = false;
        this._equilibriumHoldStart = null;
        // fixup 10: evap 곡선 자연 전환 보장 (10초 lag 차단)
        this._emaPrimed = false;
        // fixup 15a: T 변경 시 새 평형 향해 prime 평균 다시 (잡음 prime 회피)
        this._ratePrimeBuf = null;
        this.evapEMA = null;
        this.condEMA = null;
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

    // 평형 도달 시간 (자동 감지 시 기록)
    get equilibriumReachedAtSec() {
        return this._equilibriumReachedAtSec ?? null;
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

        // 평형 hysteresis 4-state (fixup 15d) — 진입 [0.9, 1.1] / 이탈 [0.85, 1.15]
        // 4 상태: none / near / reached / exited
        // sticky 폐기 — 이탈 zone 외 시 _everReachedEquilibrium = false → 재도달 시 hold 다시.
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

        if (!this._everReachedEquilibrium) {
            // 도달 전 또는 이탈 후 재시도 모드
            if (inEnterBand) {
                if (this._equilibriumHoldStart == null) {
                    this._equilibriumHoldStart = now;
                }
                const heldSec = (now - this._equilibriumHoldStart) / 1000;
                if (heldSec >= holdSec) {
                    this._equilibriumState = "reached";
                    this._everReachedEquilibrium = true;
                    this.equilibriumReached = true;
                    this.equilibriumIdx = this.rateHistory.length - 1;
                    this._equilibriumReachedAtSec = this.elapsedSec;
                } else {
                    this._equilibriumState = "near";
                }
            } else if (inExitBand) {
                // 진입 band 외, 이탈 band 안 → "근접" (hold reset)
                this._equilibriumHoldStart = null;
                this._equilibriumState = "near";
            } else {
                this._equilibriumHoldStart = null;
                this._equilibriumState = "none";
            }
        } else {
            // 도달 상태 — 이탈 band 안 시 유지, 외 시 이탈
            if (inExitBand) {
                this._equilibriumState = "reached";
            } else {
                this._equilibriumState = "exited";
                this._everReachedEquilibrium = false;
                this._equilibriumHoldStart = null;
                this.equilibriumReached = false;
                this.equilibriumIdx = null;
                this._equilibriumReachedAtSec = null;
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
        const eqTag = (this._equilibriumState === "reached") ? " · 평형 ★"
                    : (this._equilibriumState === "exited")  ? " · 평형 이탈"
                    : (this._equilibriumState === "near")    ? " · 평형 근접"
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

        // Gas particles — 막 나온 입자는 형광 노랑 전체 색 (1.5s hold + 0.5s fade) + glow
        const gasR = this.gasRadius;
        const ssq = this.gasSpeedScale * this.gasSpeedScale;
        const fluorYellowStr = cfg.gas_birth_color_fluorescent || "#FCD34D";
        const holdMs = (cfg.gas_birth_fluor_hold_sec ?? 1.5) * 1000;
        const fadeMs = (cfg.gas_birth_fluor_fade_sec ?? 0.5) * 1000;
        const totalMs = holdMs + fadeMs;
        const fluorStrokePx = cfg.gas_birth_stroke_px ?? 4.5;
        const fluorBlur = cfg.gas_birth_glow_blur_px ?? 25;
        const now = performance.now();
        for (const g of this.gasParticles) {
            const ke = 0.5 * (g.vx * g.vx + g.vy * g.vy) / ssq;
            const baseCol = vaporColorFromKE(p, ke, slow, fast, keMin, keMax);
            const ageMs = now - (g.birth_time || 0);
            let fillCol;
            let fluorAlpha = 0;
            if (ageMs < holdMs) {
                fillCol = p.color(fluorYellowStr);
                fluorAlpha = 1.0;
            } else if (ageMs < totalMs) {
                const t = (ageMs - holdMs) / fadeMs;
                fillCol = p.lerpColor(p.color(fluorYellowStr), baseCol, t);
                fluorAlpha = 1 - t;
            } else {
                fillCol = baseCol;
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
