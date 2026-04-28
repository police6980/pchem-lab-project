#!/usr/bin/env node
/**
 * Scenario batch runner — scenarios/ 폴더 모든 *.json 순차 실행.
 *
 * 사용:
 *   node run-all.js
 *
 * 출력 — 각 시나리오 한 줄 요약 + 합계 ("3/4 passed").
 * 종료 코드 — 모두 pass=0 / 1개라도 fail=1.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario } from './run-scenario.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

async function main() {
  const dir = path.join(__dirname, 'scenarios');
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.error('[run-all] scenarios/*.json 없음');
    process.exit(2);
  }

  console.error(`[run-all] ${files.length} 시나리오 순차 실행`);

  const results = [];
  for (const f of files) {
    const fullPath = path.join(dir, f);
    try {
      // run-scenario.js 가 stdout 으로 JSON dump → 파일별 분리 보존하려면 silence
      // 본 일괄 실행에선 진단 verbose 줄임 — 단순 pass/fail + 핵심 stats 만
      const passed = await runScenario(fullPath);
      results.push({ file: f, passed });
    } catch (err) {
      console.error(`[run-all] ${f} 에러: ${err.message}`);
      results.push({ file: f, passed: false, error: err.message });
    }
  }

  // 합계 출력 (stderr)
  const passCount = results.filter(r => r.passed).length;
  console.error('');
  console.error('═══ 합계 ═══');
  for (const r of results) {
    const tag = r.passed ? '✅ PASS' : '❌ FAIL';
    const errTag = r.error ? ` (${r.error})` : '';
    console.error(`  ${tag}  ${r.file}${errTag}`);
  }
  console.error(`${passCount}/${results.length} passed`);

  process.exit(passCount === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(`[run-all] error: ${err.message}`);
  process.exit(2);
});
