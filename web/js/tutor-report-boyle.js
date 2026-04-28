// =============================================================
// tutor-report-boyle.js — 보일 탐구 보고서 docx 생성 (Phase 5.7 트랙 6-a-1)
// =============================================================
//
// `web/js/ai-tutor.js generateReport` (~272줄) 의 docx 조립 + AI prompt 분리.
// createTutor(config) 의 reportConfig.generateAndDownload callback 으로 등록 (a-2).
//
// 본 파일 = 함수 작성만. 보일 페이지 적용은 (a-2) 별 turn (boyle.html script
// 추가 + ai-tutor.js DOMContentLoaded 변경).
//
// 의존성:
//   - docx 라이브러리 (CDN unpkg, boyle.html script 로드 가정)
//   - window.PchemTutorModule.tutorCallAnthropic (tutor.js)
//   - window.PchemTutor.getDatapoints / addTokens / getApiKey / getModel
//
// 시그니처:
//   generateBoyleReport(ctx, conversations) => Promise<void>
//   - ctx: { dataSource, tempC, tempK, N, meanPV, maxDev, points: [{num,P,V,PV,...}] }
//   - conversations: { 1: {messages:[...]}, 2: ..., 3: ..., 4: ..., free: ... }
//   - 다운로드 자동 실행 (a.click() 패턴)
//   - 에러 시 alert + return (throw X)

async function generateBoyleReport(ctx, conversations) {
    if (typeof docx === "undefined") {
        alert("⚠️ docx 라이브러리 로드 실패. 페이지를 새로고침 후 다시 시도하세요.");
        return;
    }
    if (typeof window.PchemTutorModule === "undefined") {
        alert("⚠️ tutor 모듈 로드 실패.");
        return;
    }

    const T = window.PchemTutor;
    const { tutorCallAnthropic } = window.PchemTutorModule;

    // === 1. AI prompt — markdown 보고서 본문 생성 ===
    const datapoints = T?.getDatapoints ? T.getDatapoints() : [];

    // ai-tutor.js getConversationSummary 패턴 — visible messages 만 (closing 요약 포함)
    function getConvSummary() {
        const out = {};
        for (const [qid, conv] of Object.entries(conversations)) {
            out[qid] = (conv.messages || [])
                .filter(m => !m.isPromptInternal)
                .map(m => ({ role: m.role, content: m.content }));
        }
        return out;
    }
    const convSummary = getConvSummary();

    const LABELS = { "1": "Q1", "2": "Q2", "3": "Q3", "4": "Q4", "free": "자유 질문" };
    let convText = "";
    for (const [qid, msgs] of Object.entries(convSummary)) {
        convText += `\n[${LABELS[qid] || qid} 대화]\n`;
        msgs.forEach(m => {
            convText += `${m.role === "user" ? "학생" : "AI 튜터"}: ${m.content}\n`;
        });
    }
    const pointsText = (ctx.points || []).map(p =>
        `  ${p.num}번: P=${p.P}kPa, V=${p.V}mL, P·V=${p.PV}`
    ).join("\n");

    const systemPrompt = `당신은 영재 과학교육 보고서 작성 도우미입니다.
학생의 실험 데이터와 AI 튜터와의 탐구 대화를 바탕으로 탐구 보고서 초안을 작성하세요.

반드시 아래 ## 헤딩 형식 그대로 사용하세요:
## 1. 탐구 제목
## 2. 탐구 목표
## 3. 실험 조건
## 4. 데이터 분석
## 5. 결론
## 6. 더 탐구하고 싶은 것

원칙:
- 섹션 4 앞에는 [표와 그래프 자동 삽입] 이라는 텍스트를 출력하지 마세요. 표와 그래프는 코드가 자동으로 삽입합니다.
- 학생이 대화에서 직접 말한 표현을 최대한 인용하세요.
- 결론은 학생의 이해 수준에 맞게 학생 목소리로 작성하세요.
- 각 섹션 100자 내외로 간결하게.
- 한국어로 작성하세요.`;

    const userPrompt = `[실험 데이터]
[데이터 소스] ${ctx.dataSource}
온도: ${ctx.tempC}°C (${ctx.tempK}K)
측정점: ${ctx.N}개
평균 P·V: ${ctx.meanPV} kPa·mL
최대 편차: ${ctx.maxDev}%

측정점 상세:
${pointsText}
${convText}
위 데이터와 탐구 대화를 바탕으로 탐구 보고서 초안을 작성해주세요.`;

    let reportText = "";
    try {
        const result = await tutorCallAnthropic({
            apiKey: T.getApiKey(),
            model: T.getModel(),
            systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
        });
        reportText = result.content;
        T.addTokens(result.inputTokens, result.outputTokens);
    } catch (e) {
        const msg = e.type === "no_key"
            ? "API 키가 설정되지 않았습니다."
            : e.type === "api_error"
                ? `API 오류 (HTTP ${e.status})`
                : "네트워크 오류가 발생했습니다.";
        alert("⚠️ 보고서 생성 실패: " + msg);
        return;
    }

    // === 2. docx 조립 ===

    async function svgToPngArrayBuffer(svgEl) {
        return new Promise((resolve) => {
            try {
                const bb = svgEl.getBoundingClientRect();
                const w = Math.max(bb.width || 400, 100);
                const h = Math.max(bb.height || 200, 100);
                const svgData = new XMLSerializer().serializeToString(svgEl);
                const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
                const url = URL.createObjectURL(svgBlob);
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    canvas.width = w * 2;
                    canvas.height = h * 2;
                    const c = canvas.getContext("2d");
                    c.fillStyle = "#ffffff";
                    c.fillRect(0, 0, canvas.width, canvas.height);
                    c.scale(2, 2);
                    c.drawImage(img, 0, 0, w, h);
                    URL.revokeObjectURL(url);
                    canvas.toBlob(blob => {
                        if (!blob) { resolve(null); return; }
                        const fr = new FileReader();
                        fr.onload = () => resolve(fr.result);
                        fr.onerror = () => resolve(null);
                        fr.readAsArrayBuffer(blob);
                    }, "image/png");
                };
                img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
                img.src = url;
            } catch (err) { resolve(null); }
        });
    }

    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            ImageRun, HeadingLevel, AlignmentType, WidthType } = docx;

    function parseSections(text) {
        const map = {};
        const lines = text.split("\n");
        let current = null;
        let buf = [];
        const flush = () => { if (current) map[current] = buf.join("\n").trim(); };
        for (const line of lines) {
            const m = line.match(/^##\s+(\d+)\.\s+/);
            if (m) { flush(); current = m[1]; buf = []; }
            else if (current) { buf.push(line); }
        }
        flush();
        return map;
    }

    function textToParas(text) {
        const out = [];
        if (!text) return out;
        for (const line of text.split("\n")) {
            if (line.trim()) {
                out.push(new Paragraph({
                    children: [new TextRun({ text: line })],
                }));
            } else {
                out.push(new Paragraph(""));
            }
        }
        return out;
    }

    const sections = parseSections(reportText);
    const docChildren = [];

    docChildren.push(new Paragraph({
        text: "탐구 보고서",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
    }));
    docChildren.push(new Paragraph({
        children: [new TextRun({
            text: `작성 일시: ${new Date().toLocaleString("ko-KR")}`,
            size: 18, color: "888888",
        })],
        alignment: AlignmentType.CENTER,
    }));
    docChildren.push(new Paragraph(""));

    // §1-3 from AI (탐구 제목 / 탐구 목표 / 실험 조건)
    const aiLeadSections = [
        { num: "1", title: "1. 탐구 제목" },
        { num: "2", title: "2. 탐구 목표" },
        { num: "3", title: "3. 실험 조건" },
    ];
    for (const s of aiLeadSections) {
        docChildren.push(new Paragraph({
            text: s.title,
            heading: HeadingLevel.HEADING_2,
        }));
        docChildren.push(...textToParas(sections[s.num] || ""));
    }

    // §4 실험 결과 (code-inserted: measurement table + chart images)
    docChildren.push(new Paragraph({
        text: "4. 실험 결과",
        heading: HeadingLevel.HEADING_2,
    }));
    if (datapoints.length > 0) {
        const headers = ["#", "P (kPa)", "V (mL)", "P·V", "v̄ (px/s)", "충돌/s"];
        const headerRow = new TableRow({
            children: headers.map(h => new TableCell({
                children: [new Paragraph({
                    children: [new TextRun({ text: h, bold: true })],
                    alignment: AlignmentType.CENTER,
                })],
            })),
        });
        const dataRows = datapoints.map((d, i) => new TableRow({
            children: [
                String(i + 1),
                d.P.toFixed(1),
                d.V.toFixed(1),
                d.PV.toFixed(1),
                d.avgSpeed != null ? String(d.avgSpeed) : "—",
                d.collisions != null ? String(d.collisions) : "—",
            ].map(v => new TableCell({
                children: [new Paragraph({
                    children: [new TextRun({ text: v })],
                    alignment: AlignmentType.CENTER,
                })],
            })),
        }));
        docChildren.push(new Table({
            rows: [headerRow, ...dataRows],
            width: { size: 100, type: WidthType.PERCENTAGE },
        }));
        docChildren.push(new Paragraph(""));
    }
    const svgEls = document.querySelectorAll(".chart-wrap svg");
    for (const svg of svgEls) {
        const ab = await svgToPngArrayBuffer(svg);
        if (!ab) continue;
        docChildren.push(new Paragraph({
            children: [new ImageRun({
                data: ab,
                transformation: { width: 320, height: 160 },
            })],
            alignment: AlignmentType.CENTER,
        }));
        docChildren.push(new Paragraph(""));
    }

    // §5-7 remapped from AI's §4-6 (데이터 분석 / 결론 / 더 탐구하고 싶은 것)
    const aiTailSections = [
        { title: "5. 데이터 분석", srcIdx: "4" },
        { title: "6. 결론", srcIdx: "5" },
        { title: "7. 더 탐구하고 싶은 것", srcIdx: "6" },
    ];
    for (const s of aiTailSections) {
        docChildren.push(new Paragraph({
            text: s.title,
            heading: HeadingLevel.HEADING_2,
        }));
        docChildren.push(...textToParas(sections[s.srcIdx] || ""));
    }

    // §8 반성 (code-inserted guidance)
    docChildren.push(new Paragraph({
        text: "8. 반성",
        heading: HeadingLevel.HEADING_2,
    }));
    docChildren.push(new Paragraph({
        children: [new TextRun({
            text: "이 실험 결과로부터 알게 된 것, 생각이 변한 것 등을 자유롭게 써보세요.",
            italics: true,
            color: "AAAAAA",
        })],
    }));

    try {
        const doc = new Document({ sections: [{ children: docChildren }] });
        const blob = await Packer.toBlob(doc);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `탐구보고서_${new Date().toISOString().slice(0, 10)}.docx`;
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (err) {
        alert("⚠️ docx 생성 중 오류: " + err.message);
    }
}

// 전역 노출
if (typeof window !== "undefined") {
    window.PchemBoyleReport = { generateBoyleReport };
}
