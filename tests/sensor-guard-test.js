// Phase 5.4: outlier 가드 5 단계 단위 검증 (Node.js node:test 단독 실행)
//
// 권위 = web/js/serial.js manager._dispatchData 안의 _applyOutlierGuard.
// 본 파일은 가드 로직을 자립형으로 복사 (dalton-collision-test 패턴) — 브라우저
// 의존성 회피. 가드 동작 변경 시 양쪽 동기화 필수 (commit message + docs/03 §3.8 참조).
//
// 실행:
//   node --test tests/sensor-guard-test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ─────────────────────────────────────────────────────────
// 가드 로직 복사 (web/js/serial.js:5-15 + manager._applyOutlierGuard)
// ─────────────────────────────────────────────────────────

const GUARD_NEGATIVE_THRESHOLD_KPA = 0;
const GUARD_SATURATION_KPA         = 1600;
const GUARD_MEDIAN_WINDOW          = 3;
const GUARD_WARN_INTERVAL_MS       = 1000;

function median3(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function createGuard() {
    return {
        _lastValidValue: {},
        _medianBuffer: {},
        _lastWarnTime: {},
        warnCount: 0,  // 테스트 검증용 — 실 코드 X

        _rateLimitedWarn(ch, type, _msg) {
            const key = `${ch}_${type}`;
            const now = Date.now();
            const last = this._lastWarnTime[key] || 0;
            if (now - last >= GUARD_WARN_INTERVAL_MS) {
                this.warnCount++;
                this._lastWarnTime[key] = now;
            }
        },

        apply(rawData) {
            const ch = rawData.ch ?? 0;
            if (rawData.value == null || isNaN(rawData.value)) return null;
            if (rawData.value <= GUARD_NEGATIVE_THRESHOLD_KPA) {
                this._rateLimitedWarn(ch, 'negative', `ch${ch} 음수 reject`);
                if (this._lastValidValue[ch] != null) {
                    rawData.value = this._lastValidValue[ch];
                } else {
                    return null;
                }
            }
            if (rawData.value >= GUARD_SATURATION_KPA) {
                this._rateLimitedWarn(ch, 'saturation', `ch${ch} saturation clip`);
                rawData.value = GUARD_SATURATION_KPA;
            }
            if (!this._medianBuffer[ch]) this._medianBuffer[ch] = [];
            this._medianBuffer[ch].push(rawData.value);
            if (this._medianBuffer[ch].length > GUARD_MEDIAN_WINDOW) this._medianBuffer[ch].shift();
            if (this._medianBuffer[ch].length === GUARD_MEDIAN_WINDOW) {
                rawData.value = median3(this._medianBuffer[ch]);
            }
            this._lastValidValue[ch] = rawData.value;
            return rawData;
        },
    };
}

const sample = (value, ch = 0) => ({ value, ch, sensor: 'pressure', unit: 'kPa', timestamp: 0 });

// ─────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────

test('1단계 — NaN drop', () => {
    const g = createGuard();
    assert.strictEqual(g.apply(sample(NaN)), null);
    assert.strictEqual(g.apply(sample(undefined)), null);
    assert.strictEqual(g.apply(sample(null)), null);
});

test('2단계 — 음수 reject (이전 값 유지)', () => {
    const g = createGuard();
    // 첫 음수 = drop (lastValidValue 없음)
    assert.strictEqual(g.apply(sample(-5)), null);
    // 정상 값 누적 → median 적용 후 lastValid = 101 (median of [100,101,102])
    g.apply(sample(100));
    g.apply(sample(101));
    g.apply(sample(102));
    const res = g.apply(sample(-50));
    assert.notStrictEqual(res, null);
    assert.strictEqual(res.value, 101);
});

test('2단계 — 0 도 음수로 처리 (≤ 0)', () => {
    const g = createGuard();
    g.apply(sample(100));
    g.apply(sample(101));
    g.apply(sample(102));  // median = 101, lastValid = 101
    const res = g.apply(sample(0));
    assert.notStrictEqual(res, null);
    assert.strictEqual(res.value, 101);
});

test('3단계 — saturation clip 1600 kPa', () => {
    const g = createGuard();
    g.apply(sample(100));
    g.apply(sample(200));
    const res = g.apply(sample(1700));
    // saturation 후 median(3) 적용 — buffer = [100, 200, 1600]
    // median = 200
    assert.strictEqual(res.value, 200);
});

test('3단계 — 정확히 1600 도 clip', () => {
    const g = createGuard();
    g.apply(sample(100));
    g.apply(sample(200));
    const res = g.apply(sample(1600));
    // buffer = [100, 200, 1600] → median = 200
    assert.strictEqual(res.value, 200);
});

test('4단계 — median(3) spike filter (1-sample spike 차단)', () => {
    const g = createGuard();
    g.apply(sample(100));
    g.apply(sample(101));
    g.apply(sample(99));  // median = 100, buffer 채워짐
    const res = g.apply(sample(500));  // spike — buffer = [101, 99, 500]
    // sorted = [99, 101, 500] → median = 101 (spike 차단)
    assert.strictEqual(res.value, 101);
});

test('4단계 — median 윈도우 채우기 전 (n < 3) 은 raw 통과', () => {
    const g = createGuard();
    const r1 = g.apply(sample(100));
    assert.strictEqual(r1.value, 100);  // buffer = [100], median 미적용
    const r2 = g.apply(sample(200));
    assert.strictEqual(r2.value, 200);  // buffer = [100, 200], median 미적용
    // 3번째부터 median 적용
    const r3 = g.apply(sample(150));
    assert.strictEqual(r3.value, 150);  // sorted [100, 150, 200] median = 150
});

test('5단계 — _lastValidValue 채널별 분리', () => {
    const g = createGuard();
    // ch0 채움
    g.apply(sample(100, 0));
    g.apply(sample(101, 0));
    g.apply(sample(102, 0));
    // ch1 첫 음수 = drop (ch1 lastValid 없음, ch0 와 무관)
    assert.strictEqual(g.apply(sample(-1, 1)), null);
    // ch1 정상 채움 (50, 51, 52) → median(3) = 51 → lastValid = 51
    g.apply(sample(50, 1));
    g.apply(sample(51, 1));
    g.apply(sample(52, 1));  // buffer [50,51,52] → median=51 → lastValid=51
    // 음수 입력 시 fallback = lastValid (51)
    const res = g.apply(sample(-1, 1));
    assert.strictEqual(res.value, 51);
});

test('정상 흐름 — 모든 단계 통과', () => {
    const g = createGuard();
    const samples = [100, 101, 99, 102, 100, 103];
    const results = samples.map(v => g.apply(sample(v)));
    // 모두 valid → null 0
    assert.strictEqual(results.filter(r => r === null).length, 0);
    // 마지막 lastValidValue = median of [100, 103] 위치 — buffer state 확인
    assert.strictEqual(g._lastValidValue[0], results[results.length - 1].value);
});

test('rate-limit warn — 1초 안 1회만 카운트 (ch_type 별)', () => {
    const g = createGuard();
    g.apply(sample(100));
    g.apply(sample(101));
    g.apply(sample(102));
    // 음수 연속 5회 — 1회 warn 만
    for (let i = 0; i < 5; i++) g.apply(sample(-10));
    assert.strictEqual(g.warnCount, 1);  // negative 1회
    // saturation 연속 5회 — saturation 1회 warn 추가 (다른 type)
    for (let i = 0; i < 5; i++) g.apply(sample(2000));
    assert.strictEqual(g.warnCount, 2);
});

test('mock 영향 X — σ=0.1 kPa 같은 작은 noise 는 가드 발동 X', () => {
    const g = createGuard();
    // 정상 압력 + σ=0.1 노이즈 (mock 모드 시뮬)
    const baseline = 101.325;
    const samples = Array.from({ length: 20 }, (_, i) => baseline + (Math.random() - 0.5) * 0.2);
    const results = samples.map(v => g.apply(sample(v)));
    // 모두 통과, warn 0
    assert.strictEqual(results.filter(r => r === null).length, 0);
    assert.strictEqual(g.warnCount, 0);
});
