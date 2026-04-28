#!/usr/bin/env node
/**
 * Baseline 측정 스크립트 — 노이즈 특성 정량화
 *
 * Phase 5 A-2 신규. 에뮬레이터 / 실물 센서의 raw 데이터를 일정 시간 수집해
 * σ / maxSpike / drift 통계를 계산, JSON 으로 저장. 회귀 테스트 baseline.
 *
 * 사용:
 *   node baseline.js --duration 60 --out baseline.json --label "emu-normal"
 *
 * 인자:
 *   --url       WebSocket URL (기본 ws://localhost:8787)
 *   --duration  수집 시간 (초, 기본 60)
 *   --out       출력 JSON 경로 (기본 baseline.json)
 *   --label     식별자 (기본 "")
 *   --no-raw    raw samples 제외, stats 만 저장
 *
 * 메시지 protocol (v1.2 emulator):
 *   - hello: {"t":"s","sensor":"...","fw":"...","channels":[{"ch":0,...},...]}
 *   - data:  {"t":"d","p":<Pa>,"T":<°C>,"ts":<ms>,"ch":<0|1>}  (채널별 별도 패킷)
 *
 * 출력 JSON:
 *   { label, url, duration, sampleCount: {ch0, ch1}, hello, timestamp,
 *     stats: { ch0: {n, mean, sigma, maxSpike, driftPerMin}, ch1: {...} },
 *     samples: { ch0: [{ts, p, T}, ...], ch1: [...] }   // --no-raw 시 생략
 *   }
 *
 * 실물 모드 — Node SerialPort 의존성 필요. 도착 후 추가 (TODO).
 *   docs/19-real-sensor-integration-checklist.md §8 참조.
 */

import WebSocket from 'ws';
import fs from 'node:fs';

// --- argparse (의존성 회피, process.argv 직접 처리)
function parseArgs() {
  const args = {
    url: 'ws://localhost:8787',
    duration: 60,
    out: 'baseline.json',
    label: '',
    includeRaw: true,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--duration') args.duration = parseFloat(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--label') args.label = argv[++i];
    else if (a === '--no-raw') args.includeRaw = false;
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node baseline.js [--url ws://localhost:8787] [--duration 60]\n' +
          '                       [--out baseline.json] [--label "..."] [--no-raw]'
      );
      process.exit(0);
    } else {
      console.warn(`[baseline] unknown arg ignored: ${a}`);
    }
  }
  return args;
}

// --- 데이터 수집
async function collect({ url, duration }) {
  return new Promise((resolve, reject) => {
    const samplesByCh = { 0: [], 1: [] };
    let hello = null;
    let startWall = null;
    let stopTimer = null;

    const ws = new WebSocket(url);

    ws.on('open', () => {
      console.log(`[baseline] connected: ${url}`);
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn(`[baseline] parse error: ${data.toString().slice(0, 80)}`);
        return;
      }

      // hello (t=s) — 1회만, 도착 시 측정 타이머 시작
      if (msg.t === 's' && !hello) {
        hello = msg;
        const chs = (msg.channels || []).length;
        console.log(`[baseline] hello: sensor=${msg.sensor} fw=${msg.fw} channels=${chs}`);
        startWall = Date.now();
        stopTimer = setTimeout(() => {
          ws.close();
          resolve({ samplesByCh, hello });
        }, duration * 1000);
        return;
      }

      // data (t=d) — ch별로 분리 누적
      if (hello && msg.t === 'd' && typeof msg.ch === 'number') {
        const arr = samplesByCh[msg.ch];
        if (arr) {
          arr.push({ ts: msg.ts, p: msg.p, T: msg.T });
          const total = samplesByCh[0].length + samplesByCh[1].length;
          if (total % 100 === 0) {
            const elapsed = ((Date.now() - startWall) / 1000).toFixed(1);
            process.stdout.write(
              `\r[baseline] elapsed ${elapsed}s, ch0=${samplesByCh[0].length} ch1=${samplesByCh[1].length}    `
            );
          }
        }
      }
    });

    ws.on('close', () => {
      if (!hello) reject(new Error('connection closed before hello'));
    });

    ws.on('error', (err) => {
      if (stopTimer) clearTimeout(stopTimer);
      reject(err);
    });
  });
}

// --- 통계 (단일 채널 samples 배열, p 필드 사용)
function computeStats(samples, durationSec) {
  const xs = samples.map((s) => s.p).filter((x) => Number.isFinite(x));
  if (xs.length === 0) return null;
  const n = xs.length;

  // 평균 / σ
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / n;
  const sigma = Math.sqrt(variance);

  // max spike — rolling median (window=5) 대비 최대 절댓값 편차
  const w = 5;
  let maxSpike = 0;
  if (n > w) {
    for (let i = w; i < n; i++) {
      const window = xs.slice(i - w, i).slice().sort((a, b) => a - b);
      const median = window[Math.floor(w / 2)];
      const spike = Math.abs(xs[i] - median);
      if (spike > maxSpike) maxSpike = spike;
    }
  }

  // drift / 분 — 첫 10% 평균과 마지막 10% 평균 차이를 분 단위로 환산
  const slice = Math.max(1, Math.floor(n * 0.1));
  const head = xs.slice(0, slice);
  const tail = xs.slice(-slice);
  const headAvg = head.reduce((a, b) => a + b, 0) / head.length;
  const tailAvg = tail.reduce((a, b) => a + b, 0) / tail.length;
  const totalMin = durationSec / 60;
  const driftPerMin = totalMin > 0 ? (tailAvg - headAvg) / totalMin : 0;

  const round = (x) => Math.round(x * 100) / 100;
  return {
    n,
    mean: round(mean),
    sigma: round(sigma),
    maxSpike: round(maxSpike),
    driftPerMin: round(driftPerMin),
  };
}

// --- main
async function main() {
  const args = parseArgs();
  console.log(
    `[baseline] duration=${args.duration}s, out=${args.out}, label="${args.label}"`
  );

  const { samplesByCh, hello } = await collect(args);
  const total = samplesByCh[0].length + samplesByCh[1].length;
  console.log(`\n[baseline] total samples: ch0=${samplesByCh[0].length} ch1=${samplesByCh[1].length} (sum=${total})`);

  if (total === 0) {
    console.error('[baseline] no samples collected — emulator running?');
    process.exit(2);
  }

  const stats0 = computeStats(samplesByCh[0], args.duration);
  const stats1 = computeStats(samplesByCh[1], args.duration);

  const result = {
    label: args.label,
    url: args.url,
    duration: args.duration,
    sampleCount: { ch0: samplesByCh[0].length, ch1: samplesByCh[1].length },
    hello,
    timestamp: new Date().toISOString(),
    stats: { ch0: stats0, ch1: stats1 },
  };
  if (args.includeRaw) result.samples = { ch0: samplesByCh[0], ch1: samplesByCh[1] };

  fs.writeFileSync(args.out, JSON.stringify(result, null, 2));
  console.log(`[baseline] saved: ${args.out}`);
  console.log('[baseline] stats (Pa):');
  if (stats0) console.log(`  ch0: mean=${stats0.mean}, σ=${stats0.sigma}, maxSpike=${stats0.maxSpike}, drift/min=${stats0.driftPerMin}`);
  if (stats1) console.log(`  ch1: mean=${stats1.mean}, σ=${stats1.sigma}, maxSpike=${stats1.maxSpike}, drift/min=${stats1.driftPerMin}`);
}

main().catch((err) => {
  console.error(`[baseline] error: ${err.message}`);
  process.exit(1);
});
