// AI tutor conversation state and message rendering.
// (Part 2 of sidebar redesign — dummy data for visual verification;
//  real API calls land in Part 3.)

// === State ===
const aiConversations = {
    1: { messages: [], tokensIn: 0, tokensOut: 0 },
    2: { messages: [], tokensIn: 0, tokensOut: 0 },
    3: { messages: [], tokensIn: 0, tokensOut: 0 },
};

let activeQuestion = 1;

const QUESTION_TEXT = {
    1: "측정점마다 P·V 값이 거의 일정하게 나왔습니다. 이런 관계가 성립하는 이유를 기체 입자의 움직임으로 설명해보세요.",
    2: "만약 압력을 400 kPa까지 올려 측정하면 부피는 어떻게 될지 예측해보세요. 이런 극단적 조건에서도 같은 규칙이 성립할까요? 그 이유는?",
    3: "다음 실험에서 바꿔보고 싶은 조건이 있다면 무엇인가요?",
};

// === Dummy data (removed in Part 3) ===
function seedDummyMessages() {
    const now = Date.now();
    aiConversations[1].messages = [
        {
            role: "user",
            content: "부피가 줄어들면 입자들이 벽에 부딪히는 횟수가 많아져서 압력이 높아지는 것 같다.",
            timestamp: now - 60000,
        },
        {
            role: "assistant",
            content: "**좋은 관찰이에요.** 부피가 줄어들면 같은 수의 입자가 더 좁은 공간에 갇히니, 벽에 부딪히는 횟수가 늘어나는 것은 맞습니다.\n\n그런데 한 발 더 들어가 볼까요? 부피가 절반이 되면 단순히 충돌 '횟수'만 2배가 될까요? 아니면 충돌의 '강도' 같은 다른 요소도 관련이 있을까요?",
            timestamp: now - 30000,
            tokensIn: 280,
            tokensOut: 195,
            model: "claude-sonnet-4-6",
        },
        {
            role: "user",
            content: "속도가 더 빨라지지는 않을 것 같아요. 온도가 일정하니까.",
            timestamp: now - 10000,
        },
    ];
    // Q2, Q3 은 초기값 그대로 (빈 배열) — 빈 상태 시각 검증용
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
function renderConversation(questionNum) {
    const scroll = document.getElementById("conversation-scroll");
    const emptyEl = document.getElementById("conversation-empty");
    const listEl = document.getElementById("messages-list");
    if (!scroll || !emptyEl || !listEl) return;

    const conv = aiConversations[questionNum];
    if (!conv || conv.messages.length === 0) {
        emptyEl.style.display = "block";
        listEl.style.display = "none";
        listEl.innerHTML = "";
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

// === Tab switching ===
function switchToQuestion(questionNum) {
    activeQuestion = questionNum;

    document.querySelectorAll(".ai-sidebar .tab-btn").forEach(btn => {
        btn.classList.toggle("active", parseInt(btn.dataset.q, 10) === questionNum);
    });

    const snippetEl = document.getElementById("question-snippet");
    if (snippetEl) snippetEl.textContent = QUESTION_TEXT[questionNum] || "";

    renderConversation(questionNum);
}

// === Init ===
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".ai-sidebar .tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const q = parseInt(btn.dataset.q, 10);
            if (q) switchToQuestion(q);
        });
    });

    seedDummyMessages();   // Part 3에서 제거
    switchToQuestion(1);
});
