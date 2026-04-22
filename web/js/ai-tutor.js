// AI tutor conversation state and message rendering.
// Part 4 (step 1): Anthropic API caller added; dummy responses still active
// (replacement in next step).

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

// Q3 first turn is AI-initiated (student clicks "질문 생성"). Tracks whether
// the synthetic prompt-and-answer pair has been produced.
let q3QuestionGenerated = false;

// QUESTION_TEXT is owned by ui.js (createAnalysisPanel closure) and exposed
// via window.PchemTutor.QUESTION_TEXT. Access with optional chaining since
// ai-tutor.js may run before ui.js populates the surface.

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
        } else if (questionId === "3" && !q3QuestionGenerated) {
            emptyEl.innerHTML =
                '<p>AI가 내 측정 데이터를 분석해서<br>탐구 질문을 만들어줍니다.</p>' +
                '<button id="btn-generate-q3" class="btn-generate-question">🔍 질문 생성</button>';
            const genBtn = emptyEl.querySelector("#btn-generate-q3");
            if (genBtn) genBtn.addEventListener("click", generateQ3Question);
        } else {
            emptyEl.innerHTML =
                '<div class="prompt-question">' +
                `<strong>Q${questionId}</strong>에 대한 생각을 아래 입력창에 작성하세요.<br>` +
                'AI 튜터가 함께 깊이 있게 탐구합니다.' +
                '</div>' +
                `<div class="question-full">${window.PchemTutor?.QUESTION_TEXT?.[questionId] || ""}</div>`;
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
    });
    q3QuestionGenerated = false;
    renderConversation(activeQuestion);
    updateInputAvailability();
    updateEndControlsVisibility();
}

function resetQuestion(qid) {
    aiConversations[qid] = {
        messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null, isClosed: false,
    };
    if (String(qid) === "3") q3QuestionGenerated = false;
    updateTabClosedLabel(qid);
    if (String(activeQuestion) === String(qid)) {
        renderConversation(qid);
        updateInputAvailability();
        updateEndControlsVisibility();
    }
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

        renderConversation(qid);
        updateInputAvailability();
        updateTabClosedLabel(qid);
        updateEndControlsVisibility();
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
        renderConversation(qid);
        updateInputAvailability();
        updateEndControlsVisibility();
    } finally {
        if (closeBtn) closeBtn.disabled = false;
    }
}

// Q3 AI-generated question: AI produces the opening question from student
// data; stored as [synthetic user prompt (hidden) + assistant response].
async function generateQ3Question() {
    const T = window.PchemTutor;
    if (!T) return;

    const ctx = T.buildDataContext();
    const level = T.getLevel();
    const systemPrompt = T.buildSystemPrompt(level, "3");
    const userMsgContent = T.buildUserPrompt("3_generate", null, ctx);

    // Synthetic user message — sent to API, hidden from display
    aiConversations["3"].messages.push({
        role: "user",
        content: "",
        apiContent: userMsgContent,
        timestamp: Date.now(),
        isPromptInternal: true,
    });
    aiConversations["3"].contextSnapshot = ctx;

    const btn = document.getElementById("btn-generate-q3");
    if (btn) btn.disabled = true;

    showTypingIndicator();
    try {
        const result = await callAnthropicAPI(
            [{ role: "user", content: userMsgContent }],
            systemPrompt
        );
        hideTypingIndicator();

        aiConversations["3"].messages.push({
            role: "assistant",
            content: result.content,
            timestamp: Date.now(),
            tokensIn:  result.inputTokens,
            tokensOut: result.outputTokens,
            model:     result.model,
        });
        aiConversations["3"].tokensIn  += result.inputTokens;
        aiConversations["3"].tokensOut += result.outputTokens;
        T.addTokens(result.inputTokens, result.outputTokens);

        q3QuestionGenerated = true;
        renderConversation("3");
        updateInputAvailability();
    } catch (e) {
        hideTypingIndicator();
        // Roll back the synthetic user message so retry shows the generate button again
        aiConversations["3"].messages.pop();

        // Restore empty-state visibility and recreate the generate button.
        // showTypingIndicator() had set emptyEl display:none; renderConversation
        // undoes that and re-inserts a fresh button with its click handler.
        renderConversation("3");

        let errMsg;
        if (e.type === "no_key") {
            errMsg = "⚠️ API 키가 설정되지 않았습니다. 오른쪽 상단 설정 패널을 확인하세요.";
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

async function generateReport() {
    const T = window.PchemTutor;
    const modal = document.getElementById("report-modal");
    const loading = document.getElementById("report-loading");
    const textarea = document.getElementById("report-textarea");
    if (!modal || !loading || !textarea) return;

    modal.hidden = false;
    loading.hidden = false;
    textarea.value = "";
    textarea.disabled = true;

    if (!T) {
        loading.hidden = true;
        textarea.value = "⚠️ AI 설정이 준비되지 않았습니다. 페이지를 새로고침 후 다시 시도해주세요.";
        textarea.disabled = false;
        return;
    }

    const ctx = T.buildDataContext();
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
학생의 실험 데이터와 AI 튜터와의 탐구 대화를 바탕으로
탐구 보고서 초안을 작성하세요.

보고서 구조:
1. 탐구 제목
2. 탐구 목표
3. 실험 조건 (온도, 입자 수 등)
4. 측정 결과 (표 형식으로)
5. 데이터 분석 (P·V 관계, 편차 해석)
6. 결론 (보일 법칙 검증, 대화에서 도달한 핵심 이해 포함)
7. 더 탐구하고 싶은 것 (대화에서 나온 질문·아이디어 추출)

원칙:
- 학생이 대화에서 직접 말한 표현을 최대한 인용하세요.
- 결론은 학생의 이해 수준에 맞게 학생 목소리로 작성하세요.
- 7번은 탐구 대화에서 자연스럽게 나온 것만 포함, 없으면 생략.
- 전체 600자 이내로 간결하게.
- 한국어로 작성하세요.`;

    const userPrompt = `[실험 데이터]
온도: ${ctx.tempC}°C (${ctx.tempK}K)
측정점: ${ctx.N}개
평균 P·V: ${ctx.meanPV} kPa·mL
최대 편차: ${ctx.maxDev}%

측정점 상세:
${pointsText}
${convText}
위 데이터와 탐구 대화를 바탕으로 탐구 보고서 초안을 작성해주세요.`;

    try {
        const result = await callAnthropicAPI(
            [{ role: "user", content: userPrompt }],
            systemPrompt
        );
        loading.hidden = true;
        textarea.value = result.content;
        textarea.disabled = false;
        T.addTokens(result.inputTokens, result.outputTokens);
    } catch (e) {
        loading.hidden = true;
        let msg;
        if (e.type === "no_key") {
            msg = "⚠️ API 키가 설정되지 않았습니다. 설정 패널에서 키를 입력하세요.";
        } else if (e.type === "api_error") {
            if (e.status === 401)      msg = "⚠️ API 키가 유효하지 않습니다.";
            else if (e.status === 429) msg = "⚠️ 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
            else if (e.status === 529) msg = "⚠️ 서버가 일시적으로 과부하 상태입니다.";
            else                       msg = `⚠️ 오류 (HTTP ${e.status})`;
        } else {
            msg = "⚠️ 네트워크 오류가 발생했습니다.";
        }
        textarea.value = msg;
        textarea.disabled = false;
    }
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
        apiContent = window.PchemTutor.buildUserPrompt(qid, content, ctx);
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

        conv.messages.push({
            role: "assistant",
            content: result.content,
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
            msg = "⚠️ API 키가 설정되지 않았습니다. 오른쪽 상단 설정 패널을 확인하세요.";
        } else if (e.type === "api_error") {
            if (e.status === 401) {
                msg = "⚠️ API 키가 유효하지 않습니다. 설정 패널에서 키를 다시 확인하세요.";
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

    renderConversation(qid);
    updateInputAvailability();
    updateEndControlsVisibility();
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
        snippetEl.textContent = window.PchemTutor?.QUESTION_TEXT?.[questionId] || "";
        contextEl.classList.remove("context-free");
    }

    renderConversation(questionId);
    updateInputAvailability();
    updateEndControlsVisibility();
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

    // Report modal wiring
    const reportModal = document.getElementById("report-modal");
    document.getElementById("btn-report-close")?.addEventListener("click", () => {
        if (reportModal) reportModal.hidden = true;
    });
    reportModal?.addEventListener("click", (e) => {
        if (e.target === reportModal) reportModal.hidden = true;
    });
    document.getElementById("btn-report-copy")?.addEventListener("click", () => {
        const ta = document.getElementById("report-textarea");
        if (!ta || !ta.value) return;
        navigator.clipboard.writeText(ta.value).then(() => {
            const btn = document.getElementById("btn-report-copy");
            if (!btn) return;
            const orig = btn.textContent;
            btn.textContent = "✓ 복사됨";
            setTimeout(() => { btn.textContent = orig; }, 1500);
        });
    });
    document.getElementById("btn-report-download")?.addEventListener("click", () => {
        const ta = document.getElementById("report-textarea");
        if (!ta || !ta.value) return;
        const blob = new Blob([ta.value], { type: "text/plain;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `탐구보고서_${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(a.href);
    });
    document.getElementById("btn-generate-report")?.addEventListener("click", generateReport);

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
