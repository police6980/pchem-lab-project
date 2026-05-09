// =============================================================
// vapor.js — 증기압 시뮬 본체 (Phase 6.1-b sub-step B-2 fixup)
//             Schroeder LJ + Velocity Verlet base + 중력 / spring 바닥
//
// 출처 attribution (MIT License, sub-step B-1 검증):
//   Daniel V. Schroeder, "Interactive molecular dynamics,"
//   American Journal of Physics 83(3), 210–218 (2015).
//   arXiv:1502.06169 [physics.ed-ph].
//   https://physics.weber.edu/schroeder/md/InteractiveMD.html
//   Copyright 2013-2014, Daniel V. Schroeder. License: MIT-like
//   (free use/copy/modify/redistribute, attribution 필수,
//    저자 이름 광고 금지).
//
// 본 파일에 포팅된 Schroeder 본체 (그대로):
//   · LJ 12-6 force: attract=r⁻⁶, repel=attract², fOverR=24(2·repel-attract)/r²
//   · Velocity Verlet 적분 (half-step pos+vel → force → half-step vel)
//   · Cell list O(N) — N≥100 + boxWidth ≥ 4·forceCutoff 자동
//   · 격자 + jitter 초기 배치 (cellSize=1.3 sigma, addAtoms 알고리즘 모사)
//   · Polar Box-Muller MB velocity
//
// 본 프로젝트 변형 (Schroeder UI 통째 폐기 + 우리 특화):
//   · Schroeder presets/sliders/save·load/data export 등 모두 제거
//   · p5 instance mode wrapping (mountVaporSketch 인터페이스 유지)
//   · 박스 영역 분할: 옆·위 hard wall + 바닥 spring-like 반발 (B-2 fixup,
//     클러스터 통째 튕김 차단). 액체 박스 위 경계 (V_liquid:V_gas 비율) =
//     시각 점선만 (통과 자유, LJ + KE 자연 게이트로 표면 입자만 증발)
//   · 균일 -y 중력 (gravity_g) — Schroeder 단일 박스 가정 위배 보정 (B-2 fixup)
//   · LJ 인력 강화 (schroeder_epsilon=1.5) + T 낮춤 (init_temp=0.25) —
//     내부 입자 탈출 차단, 표면 입자만 자연 증발 (B-2 fixup)
//   · Sigma 단위 → 캔버스 px 변환 (pxPerUnit = canvasW/boxWidth)
//   · 색은 단색 (molecule_color) — sub-step B-3 에서 자동 매핑
//   · 사건 카운터·rate 그래프·학생 패널·자동 보정·4 모드 — sub-step B-4 ~ B-5
//
// Sub-step B-2 fixup 검증 기준: 클러스터 침전 (떠오름 X) + 표면 입자만 가끔 탈출 + 50fps.
// 폐기된 자체 시도들 (응집영역 + 가속도장, LJ-like piecewise, 자유낙하,
// 격자 진동, 표면 추상화) docs/17 §6 참조.
// =============================================================

const VAPOR_DT_CAP = 0.05;   // p5 dt 인자 cap (Schroeder dt 별도)

class VaporWorld {
    constructor(cfg, vFlaskMl, vLiquidMl) {
        this.cfg = cfg;
        this.canvasW = cfg.canvas_width_px;
        this.canvasH = cfg.canvas_height_px;
        this.vFlaskMl = vFlaskMl;
        this.vLiquidMl = vLiquidMl;

        // ── Schroeder 자연 단위 ──
        this.cutoff   = cfg.schroeder_cutoff ?? 3.0;
        this.cutoff2  = this.cutoff * this.cutoff;
        this.pEatCutoff = 4 * (Math.pow(this.cutoff, -12) - Math.pow(this.cutoff, -6));
        this.dt       = cfg.schroeder_dt ?? 0.005;
        this.initT    = cfg.schroeder_init_temp ?? 0.25;
        this.stepsPerFrame = cfg.schroeder_steps_per_frame ?? 25;
        this.gravity  = cfg.gravity_g ?? 0.001;          // 균일 -y 가속도 (B-2 fixup)
        this.epsilon  = cfg.schroeder_epsilon ?? 1.5;    // LJ 인력 강화 (B-2 fixup)
        this.bottomSoftness    = cfg.bottom_wall_softness ?? 5.0;  // spring 강도
        this.bottomThreshold   = cfg.bottom_wall_threshold_sigma ?? 0.5; // 깊이 임계 (sigma)

        // ── 박스 크기 (sigma 단위) ──
        // canvas 가로:세로 비율 따라 자동. boxWidth 는 cfg 에서.
        this.boxWidth  = cfg.schroeder_box_width_sigma ?? 60;
        this.boxHeight = this.boxWidth * (this.canvasH / this.canvasW);
        this.pxPerUnit = this.canvasW / this.boxWidth;  // 1 sigma = ? px

        // ── 액체 박스 영역 (Schroeder y ↑ 좌표, V_liquid 비율) ──
        // Schroeder 좌표: 원점 좌하단, y ↑. 캔버스: 원점 좌상단, y ↓ → 렌더 시 flip.
        this.liquidYTop = this.boxHeight * (this.vLiquidMl / this.vFlaskMl);

        // ── 입자 배열 (SoA) ──
        this.N = cfg.N_molecules ?? 200;
        this.x  = new Array(this.N);
        this.y  = new Array(this.N);
        this.vx = new Array(this.N);
        this.vy = new Array(this.N);
        this.ax = new Array(this.N);
        this.ay = new Array(this.N);

        this._initAtoms();
        this._computeAccelerations();

        this._lastStatsT = performance.now();
    }

    _initAtoms() {
        // Schroeder addAtoms 격자 배치 변형 — 좌하단부터 채우고 위로 확장.
        // V_liquid 영역에 우선 채우되 부족 시 위로 (사용자 V_liquid 작은 경우 대비).
        const cellSize = 1.3;
        const nCellsX = Math.floor(this.boxWidth / cellSize);
        const epsilon = 0.01;
        // MB velocity scale: <v_x²> = T → speedScale = √T
        const speedScale = Math.sqrt(this.initT);

        let n = 0;
        let cellY = 0;
        while (n < this.N) {
            const yPos = (cellY + 0.5) * cellSize;
            if (yPos > this.boxHeight - cellSize / 2) break;
            for (let cellX = 0; cellX < nCellsX && n < this.N; cellX++) {
                this.x[n] = (cellX + 0.5) * cellSize + (Math.random() - 0.5) * epsilon;
                this.y[n] = yPos + (Math.random() - 0.5) * epsilon;
                // Polar Box-Muller (Schroeder 패턴)
                let x1, x2, w;
                do {
                    x1 = 2 * Math.random() - 1;
                    x2 = 2 * Math.random() - 1;
                    w = x1 * x1 + x2 * x2;
                } while (w >= 1.0 || w === 0);
                const u = Math.sqrt(-2 * Math.log(w) / w);
                this.vx[n] = u * x1 * speedScale;
                this.vy[n] = u * x2 * speedScale;
                this.ax[n] = 0;
                this.ay[n] = 0;
                n++;
            }
            cellY++;
        }
        if (n < this.N) {
            console.warn(`[Vapor] _initAtoms: ${n}/${this.N} 만 배치됨 (박스 부족 — schroeder_box_width_sigma 또는 N_molecules 조정)`);
            this.N = n;
        }
    }

    _computeAccelerations() {
        const N = this.N;
        const cutoff2 = this.cutoff2;
        // 균일 중력 (-y) — B-2 fixup. 단일 박스 가정 위배 보정 (액체 = 무거움 학습 직관).
        for (let i = 0; i < N; i++) {
            this.ax[i] = 0;
            this.ay[i] = -this.gravity;
        }

        // Cell list 조건 — Schroeder 그대로
        const useCellList = (N >= 100) && (this.boxWidth >= 4 * this.cutoff);

        if (!useCellList) {
            // O(N²) 단순 — Schroeder 코드 그대로
            for (let i = 0; i < N; i++) {
                for (let j = 0; j < i; j++) {
                    const dx = this.x[i] - this.x[j];
                    const dx2 = dx * dx;
                    if (dx2 < cutoff2) {
                        const dy = this.y[i] - this.y[j];
                        const dy2 = dy * dy;
                        if (dy2 < cutoff2) {
                            const rSquared = dx2 + dy2;
                            if (rSquared < cutoff2) {
                                const rSqInv = 1.0 / rSquared;
                                const attract = rSqInv * rSqInv * rSqInv;
                                const repel = attract * attract;
                                const fOverR = 24.0 * this.epsilon * ((2.0 * repel) - attract) * rSqInv;
                                const fx = fOverR * dx;
                                const fy = fOverR * dy;
                                this.ax[i] += fx; this.ay[i] += fy;
                                this.ax[j] -= fx; this.ay[j] -= fy;
                            }
                        }
                    }
                }
            }
        } else {
            // Cell list O(N) — Schroeder 알고리즘 모사
            const forceCutoff = this.cutoff;
            const nCells  = Math.floor(this.boxWidth  / forceCutoff);
            const nCellsY = Math.floor(this.boxHeight / forceCutoff);
            const cellW = this.boxWidth  / nCells;
            const cellH = this.boxHeight / nCellsY;
            const total = nCells * nCellsY;
            const listHeader = new Array(total);
            for (let c = 0; c < total; c++) listHeader[c] = -1;
            const linkedList = new Array(N);
            for (let i = 0; i < N; i++) {
                let cx = Math.floor(this.x[i] / cellW);
                let cy = Math.floor(this.y[i] / cellH);
                if (cx < 0) cx = 0; else if (cx >= nCells)  cx = nCells  - 1;
                if (cy < 0) cy = 0; else if (cy >= nCellsY) cy = nCellsY - 1;
                const ci = cx + nCells * cy;
                linkedList[i] = listHeader[ci];
                listHeader[ci] = i;
            }
            // Schroeder neighborOffset: self + E + NE + N + NW (5 cells, Newton 3rd)
            const neighborOffset = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1},{x:-1,y:1}];
            for (let cy = 0; cy < nCellsY; cy++) {
                for (let cx = 0; cx < nCells; cx++) {
                    const thisCell = cx + nCells * cy;
                    for (const off of neighborOffset) {
                        const nx2 = cx + off.x;
                        const ny2 = cy + off.y;
                        if (nx2 < 0 || nx2 >= nCells || ny2 < 0 || ny2 >= nCellsY) continue;
                        const neigh = nx2 + nCells * ny2;
                        for (let i = listHeader[thisCell]; i >= 0; i = linkedList[i]) {
                            const startJ = (off.x === 0 && off.y === 0) ? linkedList[i] : listHeader[neigh];
                            for (let j = startJ; j >= 0; j = linkedList[j]) {
                                if (off.x === 0 && off.y === 0 && j >= i) continue;
                                const dx = this.x[i] - this.x[j];
                                const dx2 = dx * dx;
                                if (dx2 >= cutoff2) continue;
                                const dy = this.y[i] - this.y[j];
                                const dy2 = dy * dy;
                                if (dy2 >= cutoff2) continue;
                                const rSquared = dx2 + dy2;
                                if (rSquared >= cutoff2) continue;
                                const rSqInv = 1.0 / rSquared;
                                const attract = rSqInv * rSqInv * rSqInv;
                                const repel = attract * attract;
                                const fOverR = 24.0 * this.epsilon * ((2.0 * repel) - attract) * rSqInv;
                                const fx = fOverR * dx;
                                const fy = fOverR * dy;
                                this.ax[i] += fx; this.ay[i] += fy;
                                this.ax[j] -= fx; this.ay[j] -= fy;
                            }
                        }
                    }
                }
            }
        }
        this._applyBottomSpring();
    }

    // Spring-like 바닥 반발 — B-2 fixup. 클러스터 통째 튕김 차단.
    // 입자가 y < threshold 깊이에 들어가면 깊이 비례 위 방향 force.
    _applyBottomSpring() {
        const N = this.N;
        const k = this.bottomSoftness;
        const th = this.bottomThreshold;
        for (let i = 0; i < N; i++) {
            if (this.y[i] < th) {
                const depth = th - this.y[i];
                this.ay[i] += k * depth;
            }
        }
    }

    // 단일 Verlet step — Schroeder doStep() 그대로
    _doStep() {
        const halfdt = 0.5 * this.dt;
        const halfdt2 = halfdt * this.dt;
        const N = this.N;
        for (let i = 0; i < N; i++) {
            this.x[i]  += this.vx[i] * this.dt + this.ax[i] * halfdt2;
            this.y[i]  += this.vy[i] * this.dt + this.ay[i] * halfdt2;
            this.vx[i] += this.ax[i] * halfdt;
            this.vy[i] += this.ay[i] * halfdt;
        }
        // 박스 사방 반사 (입자 가둠 — 우리 변형. Schroeder 원본은 동일 처리)
        for (let i = 0; i < N; i++) {
            if (this.x[i] < 0) {
                this.x[i] = -this.x[i];
                this.vx[i] = -this.vx[i];
            } else if (this.x[i] > this.boxWidth) {
                this.x[i] = 2 * this.boxWidth - this.x[i];
                this.vx[i] = -this.vx[i];
            }
            // 위 (y > boxHeight) hard wall 유지. 바닥 (y < 0) 은 spring 으로 처리.
            // 안전 클램프만 — 반사 X (클러스터 통째 추진 방지, B-2 fixup).
            if (this.y[i] < 0) {
                this.y[i] = 0;
                if (this.vy[i] < 0) this.vy[i] = 0;
            }
            if (this.y[i] > this.boxHeight) {
                this.y[i] = 2 * this.boxHeight - this.y[i];
                this.vy[i] = -this.vy[i];
            }
        }
        this._computeAccelerations();
        for (let i = 0; i < N; i++) {
            this.vx[i] += this.ax[i] * halfdt;
            this.vy[i] += this.ay[i] * halfdt;
        }
    }

    // p5 draw 콜백마다 호출 — stepsPerFrame 회 doStep
    update(_dt) {
        for (let s = 0; s < this.stepsPerFrame; s++) {
            this._doStep();
        }
        this._maybeLogStats();
    }

    _maybeLogStats() {
        const now = performance.now();
        if (now - this._lastStatsT < 1000) return;
        let inBox = 0, outBox = 0;
        for (let i = 0; i < this.N; i++) {
            if (this.y[i] <= this.liquidYTop) inBox++;
            else outBox++;
        }
        console.log(`[Vapor] sub-step B-2 (Schroeder LJ) · in_box=${inBox} · out_box=${outBox}`);
        this._lastStatsT = now;
    }

    drawWalls(p) {
        // 박스 사방 테두리 (캔버스 외곽 = 박스 외곽 — 강한 반사 영역)
        p.noFill();
        p.stroke(180);
        p.strokeWeight(1);
        p.rect(0, 0, this.canvasW, this.canvasH);

        // 액체 박스 위 경계 — 점선 (V_liquid 영역 표시. 통과 자유)
        const liquidPxY = this.canvasH - this.liquidYTop * this.pxPerUnit;
        p.stroke(120, 150, 200, 140);
        p.strokeWeight(1);
        if (p.drawingContext && typeof p.drawingContext.setLineDash === "function") {
            p.drawingContext.setLineDash([4, 4]);
            p.line(0, liquidPxY, this.canvasW, liquidPxY);
            p.drawingContext.setLineDash([]);
        } else {
            p.line(0, liquidPxY, this.canvasW, liquidPxY);
        }
    }

    drawMolecules(p) {
        // 단색 — sub-step B-3 에서 자동 매핑 추가
        const c = p.color(this.cfg.molecule_color || "#1E3A8A");
        p.noStroke();
        p.fill(c);
        // Schroeder 분자 시각 직경 = pxPerUnit (1 sigma). 우리 cfg.molecule_radius_scale 로 micro-tune.
        const radiusPx = (this.pxPerUnit / 2) * (this.cfg.molecule_radius_scale ?? 1.0);
        const diam = radiusPx * 2;
        for (let i = 0; i < this.N; i++) {
            const px = this.x[i] * this.pxPerUnit;
            const py = this.canvasH - this.y[i] * this.pxPerUnit; // y ↑ → ↓ flip
            p.circle(px, py, diam);
        }
    }
}

// =============================================================
// p5 instance mount — vapor.html #vapor-canvas-container 부착.
// (인터페이스 유지: main.js 의 mountVaporSketch(world, container) 호출 그대로)
// =============================================================
function mountVaporSketch(world, container) {
    const sketch = (p) => {
        p.setup = () => {
            p.createCanvas(world.canvasW, world.canvasH);
            p.frameRate(50);
        };
        p.draw = () => {
            world.update(VAPOR_DT_CAP);
            p.background(248, 250, 252);
            world.drawWalls(p);
            world.drawMolecules(p);
        };
    };
    return new p5(sketch, container);
}
