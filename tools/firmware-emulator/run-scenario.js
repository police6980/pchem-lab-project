#!/usr/bin/env node
/**
 * Scenario runner — 노이즈 회귀 테스트 (Phase 5.4 옵션 B (A))
 *
 * 사용:
 *   node run-scenario.js scenarios/quiet-60s.json
 *
 * 흐름:
 *   1. JSON 시나리오 로드 ({ preset, duration, channel, expect: {...} })
 *   2. emulator child spawn (--mode dalton --noise <preset>)
 *   3. baseline.js collect 재사용 (WebSocket 데이터 수집)
 *   4. emulator kill (Windows fallback 포함)
 *   5. computeStats → judge → stdout JSON + 종료 코드 (pass=0 / fail=1)
 *
 * judge 항목 (시나리오 expect 안에 있는 키만 검증):
 *   - sigma_max_pa       : stats.sigma <= 임계값
 *   - maxSpike_max_pa    : stats.maxSpike <= 임계값
 *   (drift 검증 X — head/tail slice artifact)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect, computeStats } from './baseline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const EMU_STARTUP_GRACE_MS = 800;   // emulator 가 listen 시작할 시간
const KILL_TIMEOUT_MS      = 3000;  // SIGTERM 후 SIGKILL 까지 대기

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function loadScenario(scenarioPath) {
  const abs = path.resolve(scenarioPath);
  const raw = fs.readFileSync(abs, 'utf8');
  const scn = JSON.parse(raw);
  // 필수 필드 검증
  if (!scn.preset || !scn.duration) {
    throw new Error(`scenario 누락 필드 (preset / duration): ${scenarioPath}`);
  }
  scn.channel = scn.channel ?? 0;
  scn.expect = scn.expect || {};
  return scn;
}

function spawnEmulator(preset) {
  const emuPath = path.join(__dirname, 'emulator.js');
  const args = [emuPath, '--mode', 'dalton', '--noise', preset];
  const emu = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  // stderr / stdout 진단 — 실패 시 원인 추적용
  emu.stderr.on('data', (d) => process.stderr.write(`[emu:err] ${d}`));
  // emu stdout 은 주기적 printState 가 \r 로 갱신 — 시나리오 모드는 표시 X (verbose 회피)
  emu.on('error', (err) => console.error(`[runner] emulator spawn 실패: ${err.message}`));
  return emu;
}

async function killEmulator(emu) {
  if (emu.exitCode !== null || emu.killed) return;
  // 1차: SIGTERM (POSIX). Windows 는 SIGTERM 무시 가능 — kill() 호출 자체가 immediate force
  emu.kill();
  // exit 대기
  const exited = await Promise.race([
    new Promise(r => emu.once('exit', () => r(true))),
    sleep(KILL_TIMEOUT_MS).then(() => false),
  ]);
  if (!exited) {
    // fallback — SIGKILL (Node Windows 에선 동일 force kill, POSIX 에선 강제)
    try { emu.kill('SIGKILL'); } catch (_) { /* ignore */ }
    await Promise.race([
      new Promise(r => emu.once('exit', () => r(true))),
      sleep(1000),
    ]);
  }
}

function judge(stats, expect) {
  const checks = [];
  let allPass = true;

  if (typeof expect.sigma_max_pa === 'number') {
    const pass = stats.sigma <= expect.sigma_max_pa;
    checks.push({ key: 'sigma_max_pa', threshold: expect.sigma_max_pa, actual: stats.sigma, pass });
    if (!pass) allPass = false;
  }
  if (typeof expect.maxSpike_max_pa === 'number') {
    const pass = stats.maxSpike <= expect.maxSpike_max_pa;
    checks.push({ key: 'maxSpike_max_pa', threshold: expect.maxSpike_max_pa, actual: stats.maxSpike, pass });
    if (!pass) allPass = false;
  }

  return { pass: allPass, checks };
}

async function runScenario(scenarioPath) {
  const scn = loadScenario(scenarioPath);
  console.error(`[runner] scenario: ${scn.name} (preset=${scn.preset}, duration=${scn.duration}s, channel=${scn.channel})`);

  const emu = spawnEmulator(scn.preset);

  // emulator listen 시작 대기 (hello 도착 전 collect 호출 시 connect 실패 가능)
  await sleep(EMU_STARTUP_GRACE_MS);

  let samplesByCh, hello;
  try {
    ({ samplesByCh, hello } = await collect({ url: 'ws://localhost:8787', duration: scn.duration }));
  } catch (err) {
    await killEmulator(emu);
    throw new Error(`collect 실패: ${err.message}`);
  }
  await killEmulator(emu);

  const ch = scn.channel;
  const samples = samplesByCh[ch] || [];
  if (samples.length === 0) {
    throw new Error(`채널 ${ch} samples 0`);
  }

  const stats = computeStats(samples, scn.duration);
  const judgment = judge(stats, scn.expect);

  // stdout JSON (pretty)
  const out = {
    scenario: scn.name,
    preset: scn.preset,
    duration: scn.duration,
    channel: ch,
    sampleCount: samples.length,
    helloFw: hello?.fw,
    stats,
    expect: scn.expect,
    judgment,
  };
  console.log(JSON.stringify(out, null, 2));

  // 콘솔 PASS/FAIL 표시 (stderr — JSON stdout 과 분리)
  const tag = judgment.pass ? '✅ PASS' : '❌ FAIL';
  console.error(`[runner] ${tag} ${scn.name}`);
  for (const c of judgment.checks) {
    const ok = c.pass ? 'ok' : 'FAIL';
    console.error(`         ${ok}  ${c.key}: actual=${c.actual} threshold=${c.threshold}`);
  }

  return judgment.pass;
}

// entry-point
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const scenarioArg = process.argv[2];
  if (!scenarioArg) {
    console.error('Usage: node run-scenario.js <scenarios/xxx.json>');
    process.exit(2);
  }
  runScenario(scenarioArg).then(
    (passed) => process.exit(passed ? 0 : 1),
    (err) => {
      console.error(`[runner] error: ${err.message}`);
      process.exit(2);
    }
  );
}

export { runScenario };
