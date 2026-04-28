// AI tutor conversation state and message rendering.
// Part 4: Anthropic API wired; docx report direct download (no modal).

// === Anthropic Messages API ===
// Accesses ui.js via window.PchemTutor surface (exposed inside
// createAnalysisPanel closure after loadAISettings/updateUsageDisplay).
async function callAnthropicAPI(messages, systemPrompt) {
    const apiKey = window.PchemTutor.getApiKey();
    const model  = window.PchemTutor.getModel();
    if (!apiKey) throw { type: "no_key" };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
            model,
            max_tokens: 1024,
            system: systemPrompt,
            messages,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw { type: "api_error", status: res.status, err };
    }

    const data = await res.json();
    return {
        content: data.content[0].text,
        inputTokens:  data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        model,
    };
}

// === State ===
const aiConversations = {
    1:    { messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null, isClosed: false },
    2:    { messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null, isClosed: false },
    3:    { messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null, isClosed: false },
    4:    { messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null, isClosed: false },
    free: { messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null, isClosed: false },
};

// Soft turn-limit threshold for Q1-Q4 (student turns). At or above, the
// input placeholder nudges the student toward the [✓ 대화 마무리] button
// but does not block sending.
const SOFT_TURN_LIMIT = 8;

let activeQuestion = "free";

// Q4 first turn is AI-initiated (student clicks "질문 생성"). Tracks whether
// the synthetic prompt-and-answer pair has been produced.
let q4QuestionGenerated = false;

// QUESTION_TEXT is owned by ui.js (createAnalysisPanel closure) and accessed
// via window.PchemTutor.getQuestionText(level, qid). Uses optional chaining
// since ai-tutor.js may run before ui.js populates the surface.
function getQuestionText(qid) {
    const T = window.PchemTutor;
    const level = T?.getLevel() ?? "high";
    return T?.getQuestionText(level, qid) ?? "";
}

// === HTML safety + minimal markdown ===
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function renderMinimalMarkdown(text) {
    const escaped = escapeHtml(text);
    const paragraphs = escaped.split(/\n\n+/);
    return paragraphs.map(p => {
        const inline = p
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
            .replace(/\n/g, "<br>");
        return `<p>${inline}</p>`;
    }).join("");
}

// === Rendering ===
function renderConversation(questionId) {
    const scroll = document.getElementById("conversation-scroll");
    const emptyEl = document.getElementById("conversation-empty");
    const listEl = document.getElementById("messages-list");
    if (!scroll || !emptyEl || !listEl) return;

    const conv = aiConversations[questionId];
    const visibleMessages = conv ? conv.messages.filter(m => !m.isPromptInternal) : [];

    if (!conv || visibleMessages.length === 0) {
        emptyEl.style.display = "block";
        listEl.style.display = "none";
        listEl.innerHTML = "";
        if (questionId === "free") {
            emptyEl.innerHTML =
                '실험하다 궁금한 게 생겼나요?<br>' +
                '아래 입력창에 자유롭게 질문해보세요.<br><br>' +
                '<small style="color:#999">예: "왜 입자 색깔이 다른가요?"<br>' +
                '"온도가 더 높으면 어떻게 되나요?"</small>';
        } else if (questionId === "4" && !q4QuestionGenerated) {
            emptyEl.innerHTML =
                '<p>AI가 내 측정 데이터를 분석해서<br>탐구 질문을 만들어줍니다.</p>' +
                '<button id="btn-generate-q4" class="btn-generate-question">🔍 질문 생성</button>';
            const genBtn = emptyEl.querySelector("#btn-generate-q4");
            if (genBtn) genBtn.addEventListener("click", generateQ4Question);
        } else {
            emptyEl.innerHTML =
                '<div class="prompt-question">' +
                `<strong>Q${questionId}</strong>에 대한 생각을 아래 입력창에 작성하세요.<br>` +
                'AI 튜터가 함께 깊이 있게 탐구합니다.' +
                '</div>' +
                `<div class="question-full">${getQuestionText(questionId)}</div>`;
        }
        return;
    }

    emptyEl.style.display = "none";
    listEl.style.display = "flex";
    listEl.innerHTML = "";
    visibleMessages.forEach(msg => listEl.appendChild(createMessageElement(msg)));

    scroll.scrollTop = scroll.scrollHeight;
}

function createMessageElement(msg) {
    const wrap = document.createElement("div");
    const roleCls = msg.role === "user" ? "user-message" : "ai-message";
    const errorCls = msg.isError ? " is-error" : "";
    wrap.className = `message ${roleCls}${errorCls}`;

    const avatar = msg.role === "user" ? "👤" : "🤖";
    const bodyHtml = msg.role === "user"
        ? escapeHtml(msg.content).replace(/\n/g, "<br>")
        : renderMinimalMarkdown(msg.content);

    const metaHtml = msg.role === "assistant" && msg.tokensIn
        ? `<div class="message-meta">${escapeHtml(msg.model || "AI")} · 입력 ${msg.tokensIn} · 출력 ${msg.tokensOut} 토큰</div>`
        : "";

    wrap.innerHTML = `
        <div class="avatar">${avatar}</div>
        <div class="content">
            <div class="bubble">${bodyHtml}</div>
            ${metaHtml}
        </div>
    `;
    return wrap;
}

// === Tab availability + disabled hint ===
function updateTabAvailability(datapointCount) {
    const count = typeof datapointCount === "number" ? datapointCount : 0;
    const hasEnoughData = count >= 3;
    [1, 2, 3, 4].forEach(q => {
        const tabBtn = document.querySelector(`.ai-sidebar .tab-btn[data-q="${q}"]`);
        if (!tabBtn) return;
        tabBtn.setAttribute("aria-disabled", String(!hasEnoughData));
    });
    const freeBtn = document.querySelector('.ai-sidebar .tab-btn[data-q="free"]');
    if (freeBtn) freeBtn.setAttribute("aria-disabled", "false");
    updateInputAvailability();
}

function showTabDisabledToast(q) {
    const tabsEl = document.querySelector(".ai-sidebar .question-tabs");
    if (!tabsEl) return;
    document.querySelectorAll(".tab-disabled-hint").forEach(el => el.remove());

    const msg = document.createElement("div");
    msg.className = "tab-disabled-hint";
    msg.textContent = "측정점을 3개 이상 기록한 뒤 사용할 수 있습니다";
    tabsEl.after(msg);
    setTimeout(() => msg.remove(), 2500);
}

const LEVEL_LABELS = {
    elem: "초등학교",
    middle: "중학교",
    high: "고등학교",
    univ: "대학교",
};

function showLevelChangedToast(level) {
    const existing = document.querySelector(".level-changed-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "level-changed-toast";
    toast.innerHTML =
        `🎯 학생 수준을 <strong>${LEVEL_LABELS[level] || level}</strong>으로 자동 조정했습니다.`;

    const sidebar = document.querySelector(".ai-sidebar");
    if (sidebar) sidebar.prepend(toast);
    setTimeout(() => toast.remove(), 4000);
}

// === Cost warning banner ===
// 한 임계값당 1회만 노출. 페이지 재로드 시 초기화됨.
const _costWarningShown = { 100: false, 500: false };

function triggerCostWarning(krw) {
    const thresholds = [
        { krw: 500, cls: "cost-warn-red",    msg: "⚠️ 누적 비용이 500원을 넘었습니다. API 사용량을 확인하세요." },
        { krw: 100, cls: "cost-warn-orange", msg: "💡 누적 비용이 100원을 넘었습니다." },
    ];
    for (const t of thresholds) {
        if (krw >= t.krw && !_costWarningShown[t.krw]) {
            _costWarningShown[t.krw] = true;
            showCostBanner(t.msg, t.cls);
            break;
        }
    }
}

function showCostBanner(msg, cls) {
    const old = document.getElementById("cost-warning-banner");
    if (old) old.remove();

    const banner = document.createElement("div");
    banner.id = "cost-warning-banner";
    banner.className = `cost-warning-banner ${cls}`;
    banner.innerHTML = `
        <span>${msg}</span>
        <button type="button" aria-label="닫기">✕</button>
    `;
    banner.querySelector("button").addEventListener("click", () => banner.remove());
    const sidebar = document.querySelector(".ai-sidebar");
    if (sidebar) sidebar.prepend(banner);
}

function resetAllConversations() {
    ["1", "2", "3", "4", "free"].forEach(q => {
        aiConversations[q] = {
            messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null, isClosed: false,
        };
        updateTabClosedLabel(q);
        clearTabNew(q);
    });
    q4QuestionGenerated = false;
    renderConversation(activeQuestion);
    updateInputAvailability();
    updateEndControlsVisibility();
    updateReportButtonState();
}

function resetQuestion(qid) {
    aiConversations[qid] = {
        messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null, isClosed: false,
    };
    if (String(qid) === "4") q4QuestionGenerated = false;
    updateTabClosedLabel(qid);
    clearTabNew(qid);
    if (String(activeQuestion) === String(qid)) {
        renderConversation(qid);
        updateInputAvailability();
        updateEndControlsVisibility();
    }
    updateReportButtonState();
}

function countStudentTurns(qid) {
    const conv = aiConversations[qid];
    if (!conv) return 0;
    return conv.messages.filter(m => m.role === "user" && !m.isPromptInternal).length;
}

function updateTabClosedLabel(qid) {
    const tabBtn = document.querySelector(`.ai-sidebar .tab-btn[data-q="${qid}"]`);
    if (!tabBtn) return;
    tabBtn.classList.toggle("closed", !!aiConversations[qid]?.isClosed);
}

// Tab "new message" dot: set when an async tab update finishes while the
// student is viewing a different tab; cleared on tab switch or reset.
const _tabNewFlags = {};

function markTabNew(qid) {
    _tabNewFlags[qid] = true;
    const tabBtn = document.querySelector(
        `.ai-sidebar .tab-btn[data-q="${qid}"]`
    );
    if (tabBtn) tabBtn.classList.add("has-new");
}

function clearTabNew(qid) {
    _tabNewFlags[qid] = false;
    const tabBtn = document.querySelector(
        `.ai-sidebar .tab-btn[data-q="${qid}"]`
    );
    if (tabBtn) tabBtn.classList.remove("has-new");
}

function updateEndControlsVisibility() {
    const controls = document.getElementById("conversation-end-controls");
    if (!controls) return;
    const qid = activeQuestion;
    const conv = aiConversations[qid];
    const isStructured = qid !== "free";
    const visibleCount = conv ? conv.messages.filter(m => !m.isPromptInternal).length : 0;
    const show = isStructured && visibleCount > 0 && !conv.isClosed;
    controls.hidden = !show;
}

// Close a Q-tab conversation with an AI-generated 2–3줄 summary.
async function closeQuestion(qid) {
    const conv = aiConversations[qid];
    if (!conv || conv.isClosed) return;
    const visibleCount = conv.messages.filter(m => !m.isPromptInternal).length;
    if (visibleCount === 0) return;

    const T = window.PchemTutor;
    if (!T) return;

    const closingSystem = "당신은 영재 과학교육 튜터입니다. 학생과의 탐구 대화를 마무리하는 시간입니다. 대화 전체를 바탕으로 2~3줄 요약을 작성하세요: 학생이 도달한 핵심 이해 + 추가로 생각해볼 여지. 한국어로 답변하세요.";
    const closingUserPrompt = "지금까지의 탐구 대화를 2~3줄로 짧게 정리해주세요.";

    // Hidden synthetic user message for the summary request
    conv.messages.push({
        role: "user",
        content: "",
        apiContent: closingUserPrompt,
        timestamp: Date.now(),
        isPromptInternal: true,
    });

    const apiMessages = conv.messages.map(msg => ({
        role: msg.role,
        content: msg.apiContent ?? msg.content,
    }));

    const closeBtn = document.getElementById("btn-close-q");
    if (closeBtn) closeBtn.disabled = true;
    showTypingIndicator();
    try {
        const result = await callAnthropicAPI(apiMessages, closingSystem);
        hideTypingIndicator();

        conv.messages.push({
            role: "assistant",
            content: "📝 **대화 요약**\n\n" + result.content,
            timestamp: Date.now(),
            tokensIn:  result.inputTokens,
            tokensOut: result.outputTokens,
            model:     result.model,
            isClosing: true,
        });
        conv.tokensIn  += result.inputTokens;
        conv.tokensOut += result.outputTokens;
        T.addTokens(result.inputTokens, result.outputTokens);
        conv.isClosed = true;

        if (String(activeQuestion) === String(qid)) {
            renderConversation(qid);
            updateInputAvailability();
            updateEndControlsVisibility();
        } else {
            markTabNew(qid);
        }
        updateTabClosedLabel(qid);
        updateReportButtonState();
    } catch (e) {
        hideTypingIndicator();
        conv.messages.pop();
        let errMsg;
        if (e.type === "no_key") {
            errMsg = "⚠️ API 키가 설정되지 않아 요약을 생성할 수 없습니다.";
        } else if (e.type === "api_error") {
            errMsg = `⚠️ 요약 생성 중 오류 (HTTP ${e.status}). 잠시 후 다시 시도해주세요.`;
        } else {
            errMsg = "⚠️ 네트워크 오류로 요약을 받지 못했습니다.";
        }
        conv.messages.push({
            role: "assistant",
            content: errMsg,
            timestamp: Date.now(),
            isError: true,
        });
        if (String(activeQuestion) === String(qid)) {
            renderConversation(qid);
            updateInputAvailability();
            updateEndControlsVisibility();
        } else {
            markTabNew(qid);
        }
    } finally {
        if (closeBtn) closeBtn.disabled = false;
    }
}

// Q4 AI-generated question: AI produces the opening question from student
// data; stored as [synthetic user prompt (hidden) + assistant response].
async function generateQ4Question() {
    const T = window.PchemTutor;
    if (!T) return;

    const ctx = T.buildDataContext();
    const level = T.getLevel();
    const systemPrompt = T.buildSystemPrompt(level, "4");
    const userMsgContent = T.buildUserPrompt("4_generate", null, ctx, T.getLevel());

    // Synthetic user message — sent to API, hidden from display
    aiConversations["4"].messages.push({
        role: "user",
        content: "",
        apiContent: userMsgContent,
        timestamp: Date.now(),
        isPromptInternal: true,
    });
    aiConversations["4"].contextSnapshot = ctx;

    const btn = document.getElementById("btn-generate-q4");
    if (btn) btn.disabled = true;

    showTypingIndicator();
    try {
        const result = await callAnthropicAPI(
            [{ role: "user", content: userMsgContent }],
            systemPrompt
        );
        hideTypingIndicator();

        aiConversations["4"].messages.push({
            role: "assistant",
            content: result.content,
            timestamp: Date.now(),
            tokensIn:  result.inputTokens,
            tokensOut: result.outputTokens,
            model:     result.model,
        });
        aiConversations["4"].tokensIn  += result.inputTokens;
        aiConversations["4"].tokensOut += result.outputTokens;
        T.addTokens(result.inputTokens, result.outputTokens);

        q4QuestionGenerated = true;
        if (String(activeQuestion) === "4") {
            renderConversation("4");
            updateInputAvailability();
        } else {
            markTabNew("4");
        }
        updateReportButtonState();
    } catch (e) {
        hideTypingIndicator();
        // Roll back the synthetic user message so retry shows the generate button again
        aiConversations["4"].messages.pop();

        // If the student navigated away, don't touch the current view; surface
        // the error later by flagging Q4 as having new activity.
        if (String(activeQuestion) !== "4") {
            markTabNew("4");
            return;
        }

        // Restore empty-state visibility and recreate the generate button.
        // showTypingIndicator() had set emptyEl display:none; renderConversation
        // undoes that and re-inserts a fresh button with its click handler.
        renderConversation("4");

        let errMsg;
        if (e.type === "no_key") {
            errMsg = "⚠️ API 키가 설정되지 않았습니다. 🏠 홈 페이지에서 먼저 입력해주세요.";
        } else if (e.type === "api_error") {
            if (e.status === 401)      errMsg = "⚠️ API 키가 유효하지 않습니다.";
            else if (e.status === 429) errMsg = "⚠️ 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
            else if (e.status === 529) errMsg = "⚠️ 서버가 일시적으로 과부하 상태입니다.";
            else                       errMsg = `⚠️ 오류가 발생했습니다. (HTTP ${e.status})`;
        } else {
            errMsg = "⚠️ 네트워크 오류가 발생했습니다. 인터넷 연결을 확인하세요.";
        }
        const emptyEl = document.getElementById("conversation-empty");
        if (emptyEl) {
            const errP = document.createElement("p");
            errP.style.color = "#a00";
            errP.style.marginTop = "12px";
            errP.textContent = errMsg;
            emptyEl.appendChild(errP);
        }
    }
}

// === Report draft (analysis panel integration) ===
function getConversationSummary() {
    const result = {};
    ["1", "2", "3", "4", "free"].forEach(q => {
        const conv = aiConversations[q];
        if (!conv || conv.messages.length === 0) return;
        const visible = conv.messages.filter(m => !m.isPromptInternal);
        if (visible.length === 0) return;
        result[q] = visible.map(m => ({
            role: m.role,
            content: m.content,
        }));
    });
    return result;
}

function updateReportButtonState() {
    const btnDocx = document.getElementById("btn-generate-report");
    const btnPdf  = document.getElementById("btn-generate-pdf-report");
    if (!btnDocx && !btnPdf) return;
    const visibleCount = (qid) => (aiConversations[qid]?.messages
        .filter(m => !m.isPromptInternal).length ?? 0);
    const q1ok = visibleCount("1") > 0;
    const q2ok = visibleCount("2") > 0;
    const q3ok = visibleCount("3") > 0;
    const ready = q1ok && q2ok && q3ok;
    for (const btn of [btnDocx, btnPdf]) {
        if (!btn) continue;
        btn.disabled = !ready;
        btn.title = btn.disabled
            ? "Q1, Q2, Q3 탐구를 모두 진행한 후 활성화됩니다"
            : "탐구 보고서 초안 생성";
    }
}

function downloadConversations() {
    const LABELS = {
        "1": "Q1 — 메커니즘 설명",
        "2": "Q2 — 극단 조건 외삽",
        "3": "Q3 — 다음 실험 설계",
        "4": "Q4 — AI 탐구 질문",
        "free": "자유 질문",
    };

    let text = "=== 탐구 대화 기록 ===\n";
    text += `저장 시각: ${new Date().toLocaleString("ko-KR")}\n\n`;

    let hasAny = false;
    ["1", "2", "3", "4", "free"].forEach(qid => {
        const conv = aiConversations[qid];
        if (!conv) return;
        const visible = conv.messages.filter(m => !m.isPromptInternal);
        if (visible.length === 0) return;
        hasAny = true;
        text += `${"=".repeat(40)}\n${LABELS[qid] || qid}\n${"=".repeat(40)}\n`;
        visible.forEach(m => {
            const speaker = m.role === "user" ? "학생" : "AI 튜터";
            const time = new Date(m.timestamp).toLocaleTimeString("ko-KR");
            text += `[${speaker}] (${time})\n${m.content}\n\n`;
        });
    });

    if (!hasAny) {
        alert("저장할 대화가 없습니다.");
        return;
    }

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `탐구대화_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// === Report: fetch AI draft + embed into docx directly (no modal) ===
async function generateReport() {
    const btn = document.getElementById("btn-generate-report");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ 보고서 생성 중..."; }

    const T = window.PchemTutor;
    if (!T) { restoreReportBtn(); return; }

    const ctx = T.buildDataContext();
    const datapoints = T.getDatapoints ? T.getDatapoints() : [];
    const conversations = getConversationSummary();

    const LABELS = { "1": "Q1", "2": "Q2", "3": "Q3", "4": "Q4", "free": "자유 질문" };
    let convText = "";
    for (const [qid, msgs] of Object.entries(conversations)) {
        convText += `\n[${LABELS[qid] || qid} 대화]\n`;
        msgs.forEach(m => {
            convText += `${m.role === "user" ? "학생" : "AI 튜터"}: ${m.content}\n`;
        });
    }
    const pointsText = ctx.points.map(p =>
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
        const result = await callAnthropicAPI(
            [{ role: "user", content: userPrompt }],
            systemPrompt
        );
        reportText = result.content;
        T.addTokens(result.inputTokens, result.outputTokens);
    } catch (e) {
        let msg;
        if (e.type === "no_key")         msg = "API 키가 설정되지 않았습니다.";
        else if (e.type === "api_error") msg = `API 오류 (HTTP ${e.status})`;
        else                             msg = "네트워크 오류가 발생했습니다.";
        alert("⚠️ 보고서 생성 실패: " + msg);
        restoreReportBtn();
        return;
    }

    if (typeof docx === "undefined") {
        alert("⚠️ docx 라이브러리 로드 실패. 페이지를 새로고침 후 다시 시도하세요.");
        restoreReportBtn();
        return;
    }

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
        const flush = () => {
            if (current) map[current] = buf.join("\n").trim();
        };
        for (const line of lines) {
            const m = line.match(/^##\s+(\d+)\.\s+/);
            if (m) {
                flush();
                current = m[1];
                buf = [];
            } else if (current) {
                buf.push(line);
            }
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
        // NB: local var is `doc`, not `document`, to avoid shadowing the
        // global `document` used on the next line for createElement.
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
    restoreReportBtn();
}

function restoreReportBtn() {
    const btn = document.getElementById("btn-generate-report");
    if (btn) {
        btn.textContent = "📄 탐구 보고서 초안 (docx)";
        updateReportButtonState();
    }
}

function restorePdfReportBtn() {
    const btn = document.getElementById("btn-generate-pdf-report");
    if (btn) {
        btn.textContent = "📄 탐구 보고서 초안 (PDF)";
        updateReportButtonState();
    }
}

// === Report (PDF): AI draft + html2pdf — Phase 5.5 트랙 5 ===
async function generatePdfReport() {
    const btn = document.getElementById("btn-generate-pdf-report");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ PDF 생성 중..."; }

    if (typeof html2pdf === "undefined") {
        alert("⚠️ html2pdf 라이브러리 로드 실패. 페이지를 새로고침 후 다시 시도하세요.");
        restorePdfReportBtn();
        return;
    }

    const T = window.PchemTutor;
    if (!T) { restorePdfReportBtn(); return; }

    const ctx = T.buildDataContext();
    const datapoints = T.getDatapoints ? T.getDatapoints() : [];
    const conversations = getConversationSummary();

    // docx 와 동일 prompt 흐름
    const LABELS = { "1": "Q1", "2": "Q2", "3": "Q3", "4": "Q4", "free": "자유 질문" };
    let convText = "";
    for (const [qid, msgs] of Object.entries(conversations)) {
        convText += `\n[${LABELS[qid] || qid} 대화]\n`;
        msgs.forEach(m => { convText += `${m.role === "user" ? "학생" : "AI 튜터"}: ${m.content}\n`; });
    }
    const pointsText = ctx.points.map(p =>
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
- 섹션 4 앞에는 [표와 그래프 자동 삽입] 이라는 텍스트를 출력하지 마세요.
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
        const result = await callAnthropicAPI(
            [{ role: "user", content: userPrompt }],
            systemPrompt
        );
        reportText = result.content;
        T.addTokens(result.inputTokens, result.outputTokens);
    } catch (e) {
        let msg;
        if (e.type === "no_key")         msg = "API 키가 설정되지 않았습니다.";
        else if (e.type === "api_error") msg = `API 오류 (HTTP ${e.status})`;
        else                             msg = "네트워크 오류가 발생했습니다.";
        alert("⚠️ PDF 보고서 생성 실패: " + msg);
        restorePdfReportBtn();
        return;
    }

    // markdown → 단순 HTML (## 헤딩 + 단락)
    function mdToHtml(text) {
        const lines = text.split("\n");
        const out = [];
        for (const line of lines) {
            const m = line.match(/^##\s+(.+)$/);
            if (m) out.push(`<h2 style="margin-top:1.2em;color:#1F2937;">${escapeHtml(m[1])}</h2>`);
            else if (line.trim()) out.push(`<p style="margin:0.4em 0;line-height:1.6;">${escapeHtml(line)}</p>`);
            else out.push('<br>');
        }
        return out.join('\n');
    }

    // 측정점 표 (HTML)
    const tableRows = datapoints.map((d, i) =>
        `<tr><td>${i + 1}</td><td>${(+d.P).toFixed(1)}</td><td>${(+d.V).toFixed(1)}</td><td>${(+d.PV).toFixed(1)}</td></tr>`
    ).join('');
    const tableHtml = `
        <h2 style="margin-top:1.2em;">측정 데이터</h2>
        <table style="border-collapse:collapse;width:100%;font-size:0.9em;">
            <thead><tr style="background:#f3f4f6;">
                <th style="border:1px solid #d1d5db;padding:6px;">번호</th>
                <th style="border:1px solid #d1d5db;padding:6px;">P (kPa)</th>
                <th style="border:1px solid #d1d5db;padding:6px;">V (mL)</th>
                <th style="border:1px solid #d1d5db;padding:6px;">P·V (kPa·mL)</th>
            </tr></thead>
            <tbody>${tableRows.replace(/<td>/g, '<td style="border:1px solid #d1d5db;padding:6px;text-align:center;">')}</tbody>
        </table>`;

    // 차트 캡처 — section-analysis 의 charts-row 를 그대로 캡처 (html2canvas 가 자동 처리)
    const chartsArea = document.querySelector(".analysis-verification .charts-row");
    const chartsHtml = chartsArea ? chartsArea.outerHTML : '<p style="color:#6b7280;">차트 영역 없음</p>';

    // 보고서 본문 조립
    const dateStr = new Date().toISOString().slice(0, 10);
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "padding:20px;font-family:'Noto Sans KR','Malgun Gothic',sans-serif;color:#111827;background:#ffffff;";
    wrapper.innerHTML = `
        <h1 style="text-align:center;color:#111827;border-bottom:2px solid #374151;padding-bottom:8px;">탐구 보고서</h1>
        <p style="text-align:center;color:#6b7280;font-size:0.9em;">생성일: ${dateStr}</p>
        ${mdToHtml(reportText)}
        ${tableHtml}
        <h2 style="margin-top:1.2em;">차트</h2>
        <div>${chartsHtml}</div>
    `;
    // viewport 안 + opacity:0 — html2canvas 가 off-screen (top:-9999px) element
    // 캡처 실패하는 케이스 회피. data-attribute 로 onclone 에서 강제 가시화.
    wrapper.setAttribute("data-pdf-wrapper", "1");
    wrapper.style.position = "absolute";
    wrapper.style.left = "0";
    wrapper.style.top = "0";
    wrapper.style.width = "800px";
    wrapper.style.opacity = "0";
    wrapper.style.pointerEvents = "none";
    wrapper.style.zIndex = "-1";
    document.body.appendChild(wrapper);

    try {
        await html2pdf().set({
            margin:       [15, 12, 15, 12],
            filename:     `탐구보고서_${dateStr}.pdf`,
            image:        { type: 'jpeg', quality: 0.95 },
            html2canvas:  {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                // clone document 안 wrapper 의 가시성 강제 (원본의 opacity:0 무시)
                onclone: (clonedDoc) => {
                    const w = clonedDoc.querySelector('[data-pdf-wrapper]');
                    if (w) {
                        w.style.position = 'static';
                        w.style.opacity = '1';
                        w.style.zIndex = 'auto';
                        w.style.pointerEvents = 'auto';
                    }
                },
            },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] },
        }).from(wrapper).save();
    } catch (err) {
        alert("⚠️ PDF 생성 중 오류: " + err.message);
    } finally {
        // .save() resolve 후 약간 지연 — 일부 html2pdf 버전은 download trigger 후
        // 즉시 resolve. wrapper 제거가 download blob 생성 전이면 빈 PDF 위험.
        setTimeout(() => {
            if (wrapper.parentNode) document.body.removeChild(wrapper);
        }, 200);
    }
    restorePdfReportBtn();
}

// === Typing indicator ===
function showTypingIndicator() {
    const listEl = document.getElementById("messages-list");
    if (!listEl) return;
    if (listEl.querySelector(".typing-indicator")) return;

    const wrap = document.createElement("div");
    wrap.className = "message ai-message typing-indicator";
    wrap.innerHTML = `
        <div class="avatar">🤖</div>
        <div class="content">
            <div class="bubble typing-dots"><span></span><span></span><span></span></div>
        </div>
    `;
    listEl.appendChild(wrap);
    listEl.style.display = "flex";
    const empty = document.getElementById("conversation-empty");
    if (empty) empty.style.display = "none";
    const scroll = document.getElementById("conversation-scroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
}

function hideTypingIndicator() {
    const el = document.querySelector(".typing-indicator");
    if (el) el.remove();
}

async function sendMessage() {
    const input = document.getElementById("message-input");
    const btn   = document.getElementById("btn-send-message");
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;

    const qid = activeQuestion;
    const conv = aiConversations[qid];
    const isFirstTurn  = conv.messages.length === 0;
    const isStructured = qid !== "free";

    // 첫 턴 Q1/Q2/Q3: 실험 데이터 스냅샷 + buildUserPrompt 감싸기.
    // display용(content)와 API 전송용(apiContent)을 분리해 학생은 날것 답변만 보고,
    // API에는 컨텍스트가 포함된 전체 프롬프트를 전송한다.
    let apiContent = content;
    if (isFirstTurn && isStructured) {
        const ctx = window.PchemTutor.buildDataContext();
        conv.contextSnapshot = ctx;
        apiContent = window.PchemTutor.buildUserPrompt(qid, content, ctx, window.PchemTutor.getLevel());
    }

    conv.messages.push({
        role: "user",
        content,
        apiContent,
        timestamp: Date.now(),
    });
    input.value = "";
    if (btn) btn.disabled = true;
    renderConversation(qid);
    updateInputAvailability();

    const apiMessages = conv.messages.map(msg => ({
        role: msg.role,
        content: msg.apiContent ?? msg.content,
    }));

    const level        = window.PchemTutor.getLevel();
    const systemPrompt = window.PchemTutor.buildSystemPrompt(level, qid);

    showTypingIndicator();
    try {
        const result = await callAnthropicAPI(apiMessages, systemPrompt);
        hideTypingIndicator();

        const LEVEL_SIGNAL_RE = /\[\[LEVEL:(elem|middle|high|univ)\]\]/i;
        const levelMatch = result.content.match(LEVEL_SIGNAL_RE);
        const cleanContent = result.content.replace(LEVEL_SIGNAL_RE, "").trimEnd();

        if (levelMatch) {
            const detectedLevel = levelMatch[1].toLowerCase();
            const currentLevel = window.PchemTutor.getLevel();
            if (detectedLevel !== currentLevel) {
                sessionStorage.setItem("pchem_ai_level", detectedLevel);
                const levelSelect = document.getElementById("ai-student-level");
                if (levelSelect) levelSelect.value = detectedLevel;
                showLevelChangedToast(detectedLevel);
            }
        }

        conv.messages.push({
            role: "assistant",
            content: cleanContent,
            timestamp: Date.now(),
            tokensIn:  result.inputTokens,
            tokensOut: result.outputTokens,
            model:     result.model,
        });
        conv.tokensIn  += result.inputTokens;
        conv.tokensOut += result.outputTokens;
        window.PchemTutor.addTokens(result.inputTokens, result.outputTokens);

    } catch (e) {
        hideTypingIndicator();
        let msg;
        if (e.type === "no_key") {
            msg = "⚠️ API 키가 설정되지 않았습니다. 🏠 홈 페이지에서 먼저 입력해주세요.";
        } else if (e.type === "api_error") {
            if (e.status === 401) {
                msg = "⚠️ API 키가 유효하지 않습니다. 🏠 홈 페이지에서 키를 다시 확인하세요.";
            } else if (e.status === 429) {
                msg = "⚠️ 요청이 너무 많습니다. 잠시 후 다시 시도해주세요. (Rate limit)";
            } else if (e.status === 529) {
                msg = "⚠️ 서버가 일시적으로 과부하 상태입니다. 1~2분 후 다시 시도해주세요.";
            } else {
                msg = `⚠️ 오류가 발생했습니다. (HTTP ${e.status}) 잠시 후 다시 시도해주세요.`;
            }
        } else {
            msg = "⚠️ 네트워크 오류가 발생했습니다. 인터넷 연결을 확인하세요.";
        }
        conv.messages.push({
            role: "assistant",
            content: msg,
            timestamp: Date.now(),
            isError: true,
        });
    }

    if (String(activeQuestion) === String(qid)) {
        renderConversation(qid);
        updateInputAvailability();
        updateEndControlsVisibility();
    } else {
        markTabNew(qid);
    }
    updateReportButtonState();
}

function updateInputAvailability() {
    const input = document.getElementById("message-input");
    const btn = document.getElementById("btn-send-message");
    if (!input || !btn) return;

    const hasApiKey = Boolean(sessionStorage.getItem("pchem_api_key"));
    const currentTab = document.querySelector(
        `.ai-sidebar .tab-btn[data-q="${activeQuestion}"]`
    );
    const tabReady = currentTab && currentTab.getAttribute("aria-disabled") !== "true";
    const conv = aiConversations[activeQuestion];
    const isClosed = !!conv?.isClosed;
    const isStructured = activeQuestion !== "free";
    const studentTurns = countStudentTurns(activeQuestion);

    const enabled = hasApiKey && tabReady && !isClosed;
    input.disabled = !enabled;
    btn.disabled = !enabled || !input.value.trim();

    if (isClosed) {
        input.placeholder = "✓ 대화 마무리됨. [↺]로 재시작 가능";
    } else if (!hasApiKey) {
        input.placeholder = "먼저 설정에서 API 키를 입력하세요";
    } else if (!tabReady) {
        input.placeholder = "측정점 3개를 기록한 뒤 사용할 수 있습니다";
    } else if (isStructured && studentTurns >= SOFT_TURN_LIMIT) {
        input.placeholder = "💡 충분히 탐구했어요. [✓ 마무리]로 요약받기 권장";
    } else {
        input.placeholder = "메시지 입력 (Enter 전송, Shift+Enter 줄바꿈)";
    }
}

// === Tab switching ===
function switchToQuestion(questionId) {
    activeQuestion = questionId;
    clearTabNew(questionId);

    document.querySelectorAll(".ai-sidebar .tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.q === String(questionId));
    });

    const contextEl = document.getElementById("question-context");
    const snippetEl = document.getElementById("question-snippet");
    if (!contextEl || !snippetEl) return;
    const contextLabel = contextEl.querySelector("small");

    if (questionId === "free") {
        if (contextLabel) contextLabel.textContent = "모드:";
        snippetEl.textContent = "자유 질문 — 실험·탐구와 관련된 무엇이든 물어보세요";
        contextEl.classList.add("context-free");
    } else {
        if (contextLabel) contextLabel.textContent = "현재 대화 주제:";
        snippetEl.textContent = getQuestionText(questionId);
        contextEl.classList.remove("context-free");
    }

    renderConversation(questionId);
    updateInputAvailability();
    updateEndControlsVisibility();
    updateReportButtonState();
}

// === Init ===
document.addEventListener("DOMContentLoaded", () => {
    const settingsPanel = document.getElementById("ai-settings-panel");
    const toggleBtn = document.getElementById("btn-toggle-settings");
    if (toggleBtn && settingsPanel) {
        toggleBtn.addEventListener("click", () => {
            settingsPanel.classList.toggle("open");
        });
        // First-time user (no saved key) → auto-open to guide setup
        if (!sessionStorage.getItem("pchem_api_key")) {
            settingsPanel.classList.add("open");
        }
    }

    document.querySelectorAll(".ai-sidebar .tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const q = btn.dataset.q;
            if (!q) return;
            if (q === "free") {
                switchToQuestion("free");
                return;
            }
            if (btn.getAttribute("aria-disabled") === "true") {
                showTabDisabledToast(q);
                return;
            }
            switchToQuestion(q);
        });
    });

    // 탭별 초기화 버튼 (탭 전환 이벤트 차단)
    document.querySelectorAll(".ai-sidebar .tab-reset").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const qid = btn.dataset.resetQ;
            if (!qid) return;
            const label = qid === "free" ? "자유" : `Q${qid}`;
            if (!confirm(`${label} 탭의 대화를 초기화하시겠습니까?\n(누적 비용 표시는 유지됩니다)`)) return;
            resetQuestion(qid);
        });
    });

    const messageInput = document.getElementById("message-input");
    const sendBtn = document.getElementById("btn-send-message");
    if (messageInput && sendBtn) {
        messageInput.addEventListener("input", updateInputAvailability);
        messageInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        sendBtn.addEventListener("click", sendMessage);
    }

    const closeBtn = document.getElementById("btn-close-q");
    if (closeBtn) {
        closeBtn.addEventListener("click", () => closeQuestion(activeQuestion));
    }

    // Event delegation — the target buttons (generate-report, download-conversations)
    // are inserted into the DOM after this handler runs by createAnalysisPanel
    // in ui.js (which is called from main.js's async DOMContentLoaded handler,
    // after a fetch). Delegation works regardless of when the buttons appear.
    document.addEventListener("click", (e) => {
        if (e.target?.closest?.("#btn-generate-report")) generateReport();
        else if (e.target?.closest?.("#btn-generate-pdf-report")) generatePdfReport();
        else if (e.target?.closest?.("#btn-download-conversations")) downloadConversations();
    });

    // Attach getConversationSummary to PchemTutor if the surface is ready
    // (ui.js's createAnalysisPanel may populate window.PchemTutor after
    //  this handler runs; generateReport still works via direct reference).
    if (window.PchemTutor) {
        window.PchemTutor.getConversationSummary = getConversationSummary;
    }

    // main.js createAnalysisPanel runs asynchronously after a fetch; setting
    // initial tab state here avoids a brief flash where Q1-Q3 look enabled
    // before refresh() updates them with the real datapoint count.
    updateTabAvailability(0);
    switchToQuestion("free");
});
