#!/usr/bin/env node
/**
 * Sequence replay runner — Phase 5.4 옵션 B
 *
 * JSON 시퀀스 파일을 emulator 에 주입 → ws 데이터 수집 → 입력 sequence 와
 * 출력 일치 여부 검증 (각 step 의 t_ms 시점 ±tolerance 내에서 p_pa 값 도달).
 *
 * 사용:
 *   node run-replay.js scenarios/replay/injection-sample.json
 *
 * 흐름:
 *   1. sequence JSON 로드 (step 배열)
 *   2. emulator child spawn (--mode dalton --sequence <path>)
 *   3. ws 연결 + duration = 마지막 step.t_ms + grace(2s) 동안 수집
 *   4. 각 step 의 t_ms +grace 시점에 ch.pressurePa = step.p_pa 일치 확인
 *      (수신 sample 중 step 시점 ±300ms 윈도우 안에 step.p_pa 와 일치하는 것)
 *   5. stdout JSON + 종료 코드 (모두 일치 → 0 / 1개라도 불일치 → 1)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect } from './baseline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const EMU_STARTUP_GRACE_MS = 800;
const EMU_TAIL_GRACE_MS    = 2000;  // 마지막 step 이후 추가 수집 시간
const STEP_MATCH_WINDOW_MS = 2000;  // step.t_ms ~+window 안에 첫 일치 sample. ws connection latency (process start 기준 첫 sample ~1000ms) 흡수.
const KILL_TIMEOUT_MS      = 3000;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadSequence(seqPath) {
  const raw = fs.readFileSync(path.resolve(seqPath), 'utf8');
  const steps = JSON.parse(raw);
  if (!Array.isArray(steps)) throw new Error('sequence root must be array');
  for (const s of steps) {
    if (typeof s.t_ms !== 'number' || typeof s.p_pa !== 'number') {
      throw new Error(`invalid step: ${JSON.stringify(s)}`);
    }
    s.ch = s.ch ?? 0;
  }
  return steps;
}

function spawnEmulator(seqPath) {
  const emuPath = path.join(__dirname, 'emulator.js');
  const args = [emuPath, '--mode', 'dalton', '--sequence', seqPath];
  const emu = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  emu.stderr.on('data', (d) => process.stderr.write(`[emu:err] ${d}`));
  emu.on('error', (err) => console.error(`[runner] emulator spawn 실패: ${err.message}`));
  return emu;
}

async function killEmulator(emu) {
  if (emu.exitCode !== null || emu.killed) return;
  emu.kill();
  const exited = await Promise.race([
    new Promise(r => emu.once('exit', () => r(true))),
    sleep(KILL_TIMEOUT_MS).then(() => false),
  ]);
  if (!exited) {
    try { emu.kill('SIGKILL'); } catch (_) {}
    await Promise.race([
      new Promise(r => emu.once('exit', () => r(true))),
      sleep(1000),
    ]);
  }
}

// 각 step 의 t_ms 시점 ±window 안에 ch 의 sample 중 p_pa 일치 검색
function judgeSequence(steps, samplesByCh) {
  const results = [];
  let allPass = true;
  // sample.ts 는 emulator startedAt 기준 (Date.now() - startedAt). sequence 의 t_ms 와 동일 기준
  for (const step of steps) {
    const arr = samplesByCh[step.ch] || [];
    const tMin = step.t_ms;
    const tMax = step.t_ms + STEP_MATCH_WINDOW_MS;
    let matched = null;
    for (const s of arr) {
      if (s.ts >= tMin && s.ts <= tMax) {
        // tolerance — emulator 가 step 즉시 적용 → p 값 정확
        if (s.p === step.p_pa) {
          matched = s;
          break;
        }
      }
    }
    const pass = matched !== null;
    if (!pass) allPass = false;
    results.push({
      step,
      matched: matched ? { ts: matched.ts, p: matched.p } : null,
      pass,
    });
  }
  return { pass: allPass, results };
}

async function runReplay(seqPath) {
  const steps = loadSequence(seqPath);
  const lastT = Math.max(...steps.map(s => s.t_ms));
  const duration = (lastT + EMU_TAIL_GRACE_MS) / 1000;

  console.error(`[runner] sequence: ${path.basename(seqPath)} (${steps.length} steps, last t_ms=${lastT}, duration=${duration}s)`);

  const emu = spawnEmulator(path.resolve(seqPath));
  await sleep(EMU_STARTUP_GRACE_MS);

  let samplesByCh, hello;
  try {
    ({ samplesByCh, hello } = await collect({ url: 'ws://localhost:8787', duration }));
  } catch (err) {
    await killEmulator(emu);
    throw new Error(`collect 실패: ${err.message}`);
  }
  await killEmulator(emu);

  const judgment = judgeSequence(steps, samplesByCh);

  const out = {
    sequence: path.basename(seqPath),
    stepCount: steps.length,
    duration,
    sampleCount: { ch0: (samplesByCh[0] || []).length, ch1: (samplesByCh[1] || []).length },
    helloFw: hello?.fw,
    judgment,
  };
  console.log(JSON.stringify(out, null, 2));

  const tag = judgment.pass ? '✅ PASS' : '❌ FAIL';
  console.error(`[runner] ${tag} ${path.basename(seqPath)} (${judgment.results.filter(r=>r.pass).length}/${steps.length} steps matched)`);
  for (const r of judgment.results) {
    if (!r.pass) {
      console.error(`         FAIL  step t_ms=${r.step.t_ms} ch=${r.step.ch} p_pa=${r.step.p_pa} — matched=${r.matched ? JSON.stringify(r.matched) : 'null'}`);
    }
  }

  return judgment.pass;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const seqArg = process.argv[2];
  if (!seqArg) {
    console.error('Usage: node run-replay.js <scenarios/replay/xxx.json>');
    process.exit(2);
  }
  runReplay(seqArg).then(
    (passed) => process.exit(passed ? 0 : 1),
    (err) => {
      console.error(`[runner] error: ${err.message}`);
      process.exit(2);
    }
  );
}

export { runReplay };
