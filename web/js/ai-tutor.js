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
    1:    { messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null },
    2:    { messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null },
    3:    { messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null },
    free: { messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null },
};

let activeQuestion = "free";

const QUESTION_TEXT = {
    1: "측정점마다 P·V 값이 거의 일정하게 나왔습니다. 이런 관계가 성립하는 이유를 기체 입자의 움직임으로 설명해보세요.",
    2: "만약 압력을 400 kPa까지 올려 측정하면 부피는 어떻게 될지 예측해보세요. 이런 극단적 조건에서도 같은 규칙이 성립할까요? 그 이유는?",
    3: "다음 실험에서 바꿔보고 싶은 조건이 있다면 무엇인가요?",
};

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
    if (!conv || conv.messages.length === 0) {
        emptyEl.style.display = "block";
        listEl.style.display = "none";
        listEl.innerHTML = "";
        if (questionId === "free") {
            emptyEl.innerHTML =
                '실험하다 궁금한 게 생겼나요?<br>' +
                '아래 입력창에 자유롭게 질문해보세요.<br><br>' +
                '<small style="color:#999">예: "왜 입자 색깔이 다른가요?"<br>' +
                '"온도가 더 높으면 어떻게 되나요?"</small>';
        } else {
            emptyEl.innerHTML =
                '<div class="prompt-question">' +
                `<strong>Q${questionId}</strong>에 대한 생각을 아래 입력창에 작성하세요.<br>` +
                'AI 튜터가 함께 깊이 있게 탐구합니다.' +
                '</div>' +
                `<div class="question-full">${QUESTION_TEXT[questionId] || ""}</div>`;
        }
        return;
    }

    emptyEl.style.display = "none";
    listEl.style.display = "flex";
    listEl.innerHTML = "";
    conv.messages.forEach(msg => listEl.appendChild(createMessageElement(msg)));

    scroll.scrollTop = scroll.scrollHeight;
}

function createMessageElement(msg) {
    const wrap = document.createElement("div");
    wrap.className = `message ${msg.role === "user" ? "user-message" : "ai-message"}`;

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
    [1, 2, 3].forEach(q => {
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

// === Dummy responses (real API in Part 4) ===
function fakeApiDelay() {
    return new Promise(r => setTimeout(r, 1500));
}

function generateDummyAiResponse(questionId, userMsg) {
    const responses = {
        1: "학생님의 답변에서 **입자 운동**에 주목한 점이 좋네요. 한 걸음 더 들어가볼까요? 부피가 줄어들면 입자가 벽에 부딪히는 '횟수'가 변할까요, '강도'가 변할까요, 아니면 둘 다일까요?",
        2: "흥미로운 예측이에요. 그런데 실제 기체는 이상기체와 다르게 행동할 수 있습니다. 400 kPa에서 입자들이 서로 아주 가까워진다면, 입자 사이의 힘이 무시 가능할까요?",
        3: "좋은 제안이에요. 그 조건을 바꾸면 이번 실험에서 관찰한 관계가 어떻게 달라질지 먼저 예측해볼 수 있을까요?",
        free: "질문 감사해요. 이것에 대한 답은... (더미 응답입니다. Part 4에서 실제 API 연동 시 교체됩니다.)",
    };

    aiConversations[questionId].messages.push({
        role: "assistant",
        content: responses[questionId] || responses.free,
        timestamp: Date.now(),
        tokensIn: 200,
        tokensOut: 150,
        model: "dummy-mode",
    });
}

function resetAllConversations() {
    ["1", "2", "3", "free"].forEach(q => {
        aiConversations[q] = { messages: [], tokensIn: 0, tokensOut: 0 };
    });
    renderConversation(activeQuestion);
}

async function sendMessage() {
    const input = document.getElementById("message-input");
    const btn = document.getElementById("btn-send-message");
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;

    const qid = activeQuestion;

    aiConversations[qid].messages.push({
        role: "user",
        content,
        timestamp: Date.now(),
    });
    input.value = "";
    if (btn) btn.disabled = true;
    renderConversation(qid);
    updateInputAvailability();

    await fakeApiDelay();
    generateDummyAiResponse(qid, content);
    renderConversation(qid);
    updateInputAvailability();
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

    const enabled = hasApiKey && tabReady;
    input.disabled = !enabled;
    btn.disabled = !enabled || !input.value.trim();

    if (!hasApiKey) {
        input.placeholder = "먼저 설정에서 API 키를 입력하세요";
    } else if (!tabReady) {
        input.placeholder = "측정점 3개를 기록한 뒤 사용할 수 있습니다";
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
        snippetEl.textContent = QUESTION_TEXT[questionId] || "";
        contextEl.classList.remove("context-free");
    }

    renderConversation(questionId);
    updateInputAvailability();
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

    // main.js createAnalysisPanel runs asynchronously after a fetch; setting
    // initial tab state here avoids a brief flash where Q1-Q3 look enabled
    // before refresh() updates them with the real datapoint count.
    updateTabAvailability(0);
    switchToQuestion("free");
});
