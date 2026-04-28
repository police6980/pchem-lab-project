// =============================================================
// tutor.js — AI 튜터 통합 모듈 (Phase 5.7 트랙 6 별 브랜치)
// =============================================================
//
// 목적: 보일 (ai-tutor.js 모듈 전역) / 입자운동 (createAdvAiTutor closure)
// / 돌턴 (createDaltonTutor nested closure) 의 3 패턴 분산 통합.
// 단일 factory `createTutor(config)` + 공통 상수 + 헬퍼.
//
// 본 모듈 = factory + 공통 logic 만. 시뮬별 적용 (보일/입자/돌턴) 은
// 별 commit (단계 (a)/(b)/(c) 회귀 검증 후 진행).
//
// 권위 비교 (변경 시 양쪽 동기화 필수 — 단계 (a)~(c) 진행 중):
//   - 보일: web/js/ai-tutor.js (1123 줄)
//   - 입자운동: web/js/ui.js createAdvAiTutor (~500 줄)
//   - 돌턴: web/js/main.js createDaltonTutor (~500 줄)
//
// 분산 → 통합:
//   - MODEL_PRICING (3 곳 중복) → TUTOR_MODELS
//   - LEVEL_GUIDES / LEVEL_LABELS (3 곳 중복) → TUTOR_LEVELS / TUTOR_LEVEL_LABELS
//   - aiConversations 패턴 (3 곳) → factory closure state
//   - escapeHtml / renderMinimalMarkdown (3 곳) → 공통 헬퍼
//   - callAnthropicAPI (3 곳, 시그니처 약간 차이) → 단일
//   - computeCost / USD_TO_KRW (3 곳) → 공통

// =============================================================
// §1. 공통 상수
// =============================================================

const TUTOR_MODELS = {
    "claude-sonnet-4-6": { inputPerMTok: 3,    outputPerMTok: 15, label: "Sonnet 4.6 (기본)" },
    "claude-opus-4-7":   { inputPerMTok: 5,    outputPerMTok: 25, label: "Opus 4.7 (정밀)" },
    "claude-haiku-4-5":  { inputPerMTok: 0.8,  outputPerMTok: 4,  label: "Haiku 4.5 (빠름)" },
};

const TUTOR_LEVELS = ["elem", "middle", "high", "univ"];
const TUTOR_LEVEL_LABELS = {
    elem:   "초등",
    middle: "중등",
    high:   "고등 (기본)",
    univ:   "대학",
};

const USD_TO_KRW = 1400;
const SOFT_TURN_LIMIT = 8;       // Q1~Q4 학생 turn ≥ 8 시 소프트 경고 (block X)
const COST_WARN_THRESHOLDS = [100, 500];  // 원화 누적 경고 시점

const SESSION_KEY_API   = "pchem_api_key";
const SESSION_KEY_LEVEL = "pchem_ai_level";
const SESSION_KEY_MODEL = "pchem_ai_model";

// =============================================================
// §2. 공통 헬퍼
// =============================================================

function tutorEscapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// **bold** + *italic* + 단락 \n\n + 줄바꿈 \n→<br> (3 패턴 공통 최소 markdown)
function tutorRenderMinimalMarkdown(text) {
    const escaped = tutorEscapeHtml(text);
    const paragraphs = escaped.split(/\n\n+/);
    return paragraphs.map(p => {
        const inline = p
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.+?)\*/g, "<em>$1</em>")
            .replace(/\n/g, "<br>");
        return `<p>${inline}</p>`;
    }).join("");
}

// Anthropic Messages API 호출 — 3 패턴 단일화. err.type / err.status 패턴 보존
async function tutorCallAnthropic({ apiKey, model, systemPrompt, messages, maxTokens = 1024 }) {
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
            max_tokens: maxTokens,
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

function tutorComputeCost(model, inputTokens, outputTokens) {
    const p = TUTOR_MODELS[model];
    if (!p) return 0;
    const usd = (inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1e6;
    return Math.round(usd * USD_TO_KRW);
}

function tutorFormatApiError(status, message) {
    switch (status) {
        case 401: return "API 키가 유효하지 않습니다. 다시 확인해주세요.";
        case 429: return "요청이 많습니다. 잠시 후 다시 시도해주세요.";
        case 529: return "서버가 혼잡합니다. 잠시 후 다시 시도해주세요.";
        case 0:   return "네트워크 연결을 확인해주세요.";
        default:  return `오류 ${status}: ${message || ""}`;
    }
}

// [[LEVEL:xxx]] 마커 추출 — AI 응답 본문에서 학생 수준 자동 감지 (보일/돌턴 패턴)
function tutorExtractLevelMarker(text) {
    const m = text.match(/\[\[LEVEL:(elem|middle|high|univ)\]\]/);
    return m ? m[1] : null;
}

// =============================================================
// §3. createTutor factory — 통합 인터페이스
// =============================================================
//
// config schema:
//   simName: string                    필수 - 'boyle' | 'particles' | 'dalton'
//   sidebarSelector: string            필수 - '#ai-sidebar' | '#adv-ai-sidebar' | ...
//   tabIds: string[]                   필수 - ['1', '2', '3', '4', 'free']
//   metaTabId: string|null             필수 - '4' (보일/돌턴) | null (입자, free 가 메타 X)
//
//   getQuestionText: (level, qid) => string                필수 - 시뮬별 질문 본문
//   buildSystemPrompt: (level, qid, ctx) => string         필수 - AI prompt 시스템
//   buildDataContext: () => object                         필수 - 측정/시뮬 상태
//
//   reportEnabled: boolean                                 옵션 - 보일 only true
//   reportConfig: { generateAndDownload: (ctx, conv) => Promise } - reportEnabled 시
//
//   onLevelDetect: (level) => void                         옵션 - [[LEVEL:xxx]] 수신
//   onTokenUsage: (model, inputT, outputT, costKrw) => void 옵션 - 토큰/비용 표시
//
//   domSelectors: {                                        옵션 - 기본값 = boyle 패턴
//       settingsToggle, settingsPanel, levelSelect, modelSelect,
//       tokensUsed, costEstimate, tabBtns, tabResetBtns,
//       questionContext, questionSnippet, messagesList,
//       conversationEmpty, conversationEnd, btnEndConversation,
//       messageInput, btnSendMessage,
//   }
//
// returns: { init, switchToQuestion, sendMessage, getConversations,
//            resetAll, resetTab, generateReport, updateTabAvailability,
//            getTokenUsage, getActiveQuestion }

function createTutor(config) {
    // --- config 검증 (필수 필드만)
    const required = ["simName", "sidebarSelector", "tabIds", "getQuestionText",
                      "buildSystemPrompt", "buildDataContext"];
    for (const k of required) {
        if (config[k] === undefined) {
            throw new Error(`createTutor: config.${k} 필수`);
        }
    }

    // --- closure state
    const conversations = {};
    for (const qid of config.tabIds) {
        conversations[qid] = {
            messages: [],
            tokensIn: 0,
            tokensOut: 0,
            contextSnapshot: null,
            isClosed: false,
        };
    }

    let activeQuestion = config.tabIds.includes("free") ? "free" : config.tabIds[0];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const costWarningShown = {};
    for (const t of COST_WARN_THRESHOLDS) costWarningShown[t] = false;
    const tabNewFlags = {};   // { [qid]: bool } — cross-tab "new" 뱃지
    let q4Generated = false;  // 메타 탭 첫 질문 생성 여부 (config.metaTabId 한정)

    // --- DOM refs (config.domSelectors 또는 기본값)
    const sidebar = document.querySelector(config.sidebarSelector);
    if (!sidebar) {
        console.error(`[tutor:${config.simName}] sidebar 못 찾음: ${config.sidebarSelector}`);
        return null;
    }

    const sel = config.domSelectors || {};
    const dom = {
        settingsToggle:    document.querySelector(sel.settingsToggle    || `${config.sidebarSelector} #btn-toggle-settings`),
        settingsPanel:     document.querySelector(sel.settingsPanel     || `${config.sidebarSelector} #ai-settings-panel`),
        levelSelect:       document.querySelector(sel.levelSelect       || `${config.sidebarSelector} #ai-student-level`),
        modelSelect:       document.querySelector(sel.modelSelect       || `${config.sidebarSelector} #ai-model`),
        tokensUsed:        document.querySelector(sel.tokensUsed        || `${config.sidebarSelector} #tokens-used`),
        costEstimate:      document.querySelector(sel.costEstimate      || `${config.sidebarSelector} #cost-estimate`),
        questionSnippet:   document.querySelector(sel.questionSnippet   || `${config.sidebarSelector} #question-snippet`),
        messagesList:      document.querySelector(sel.messagesList      || `${config.sidebarSelector} #messages-list`),
        conversationEmpty: document.querySelector(sel.conversationEmpty || `${config.sidebarSelector} #conversation-empty`),
        messageInput:      document.querySelector(sel.messageInput      || `${config.sidebarSelector} #message-input`),
        btnSendMessage:    document.querySelector(sel.btnSendMessage    || `${config.sidebarSelector} #btn-send-message`),
        // 대화 마무리 버튼 영역 (closeConfig 활성 시 visibility 토글) — Phase 5.7 (a-2) 회귀 신규
        endControls:       document.querySelector(sel.endControls       || `${config.sidebarSelector} #conversation-end-controls`),
        tabBtns:           sidebar.querySelectorAll(sel.tabBtns         || ".tab-btn"),
        tabResetBtns:      sidebar.querySelectorAll(sel.tabResetBtns    || ".tab-reset"),
    };

    // --- 핵심 함수
    function getApiKey()    { return sessionStorage.getItem(SESSION_KEY_API); }
    function getLevel()     { return dom.levelSelect?.value || sessionStorage.getItem(SESSION_KEY_LEVEL) || "high"; }
    function getModel()     { return dom.modelSelect?.value || sessionStorage.getItem(SESSION_KEY_MODEL) || "claude-sonnet-4-6"; }
    function getActiveQuestion() { return activeQuestion; }
    function getConversations()  { return conversations; }
    function getTokenUsage()     { return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }; }

    function updateUsageDisplay() {
        if (dom.tokensUsed) {
            dom.tokensUsed.textContent = (totalInputTokens + totalOutputTokens).toLocaleString("en-US");
        }
        const cost = tutorComputeCost(getModel(), totalInputTokens, totalOutputTokens);
        if (dom.costEstimate) dom.costEstimate.textContent = cost;
        // 누적 비용 경고 — 100원 / 500원 시점 (한 번씩만)
        for (const t of COST_WARN_THRESHOLDS) {
            if (!costWarningShown[t] && cost >= t) {
                costWarningShown[t] = true;
                console.warn(`[tutor:${config.simName}] 비용 ${cost}원 (≥ ${t}원) 도달`);
            }
        }
        // onTokenUsage 는 addTokens 안에서 호출 (deltaIn/deltaOut 정확 전달)
    }

    function addTokens(inputT, outputT) {
        totalInputTokens += inputT;
        totalOutputTokens += outputT;
        updateUsageDisplay();
        // onTokenUsage callback — deltaIn/deltaOut 별도 (외부 누적 source 동기화 위함)
        if (typeof config.onTokenUsage === "function") {
            const cost = tutorComputeCost(getModel(), totalInputTokens, totalOutputTokens);
            config.onTokenUsage(getModel(), inputT, outputT, totalInputTokens, totalOutputTokens, cost);
        }
    }

    function updateInputAvailability() {
        const hasKey = Boolean(getApiKey());
        const hasText = (dom.messageInput?.value || "").trim().length > 0;
        const conv = conversations[activeQuestion];
        const closed = conv?.isClosed;
        if (dom.messageInput) {
            dom.messageInput.disabled = !hasKey || closed;
            dom.messageInput.placeholder = !hasKey
                ? "🏠 홈 페이지에서 API 키를 먼저 입력하세요"
                : closed
                    ? "이 대화는 마무리되었습니다. [↺ 초기화] 후 새로 시작하세요."
                    : (countStudentTurns(activeQuestion) >= SOFT_TURN_LIMIT
                        ? `대화가 ${SOFT_TURN_LIMIT}턴을 넘었습니다. [✓ 대화 마무리] 권장.`
                        : "메시지 입력 (Enter 전송, Shift+Enter 줄바꿈)");
        }
        if (dom.btnSendMessage) {
            dom.btnSendMessage.disabled = !hasKey || !hasText || closed;
        }
    }

    function countStudentTurns(qid) {
        return (conversations[qid]?.messages || []).filter(m => m.role === "user").length;
    }

    // 대화 마무리 버튼 영역 visibility — closeConfig 활성 + structured 탭 + 메시지 ≥ 1 + !isClosed
    // (ai-tutor.js dead code updateEndControlsVisibility:310-318 패턴 통합)
    function updateEndControlsVisibility() {
        if (!dom.endControls) return;
        if (!config.closeConfig) { dom.endControls.hidden = true; return; }
        const qid = activeQuestion;
        const conv = conversations[qid];
        const isStructured = qid !== "free" && qid !== config.metaTabId;
        const visibleCount = conv ? conv.messages.filter(m => !m.isPromptInternal).length : 0;
        const show = isStructured && visibleCount > 0 && !conv.isClosed;
        dom.endControls.hidden = !show;
    }

    // empty state default HTML — config.emptyStateBuilder 로 override 가능
    function defaultEmptyStateHtml(qid) {
        if (qid === "free") {
            return '실험하다 궁금한 게 생겼나요?<br>'
                 + '아래 입력창에 자유롭게 질문해보세요.<br><br>'
                 + '<small style="color:#999">예: "왜 입자 색깔이 다른가요?"<br>'
                 + '"온도가 더 높으면 어떻게 되나요?"</small>';
        }
        if (qid === config.metaTabId) {
            return '<p>AI가 내 측정 데이터를 분석해서<br>탐구 질문을 만들어줍니다.</p>'
                 + '<button id="btn-generate-q4" class="btn-generate-question">🔍 질문 생성</button>';
        }
        // Q1~Q3 default — prompt-question + question-full
        const qText = config.getQuestionText(getLevel(), qid);
        return '<div class="prompt-question">'
             + `<strong>Q${qid}</strong>에 대한 생각을 아래 입력창에 작성하세요.<br>`
             + 'AI 튜터가 함께 깊이 있게 탐구합니다.'
             + '</div>'
             + `<div class="question-full">${qText}</div>`;
    }

    function renderConversation() {
        const conv = conversations[activeQuestion];
        if (!dom.messagesList) return;
        dom.messagesList.innerHTML = "";
        const visible = conv.messages.filter(m => !m.isPromptInternal);
        if (visible.length === 0 && dom.conversationEmpty) {
            // empty state innerHTML 동적 생성 (보일 패턴 — Q1~Q3 question-full / Q4 [질문 생성] / free 안내)
            const html = (typeof config.emptyStateBuilder === "function")
                ? config.emptyStateBuilder(activeQuestion, getLevel(), config.getQuestionText)
                : defaultEmptyStateHtml(activeQuestion);
            dom.conversationEmpty.innerHTML = html;
            dom.conversationEmpty.style.display = "";
        } else if (dom.conversationEmpty) {
            dom.conversationEmpty.style.display = "none";
        }
        for (const msg of visible) {
            const wrap = document.createElement("div");
            wrap.className = `message ${msg.role === "user" ? "user-message" : "ai-message"}`;
            const avatar = document.createElement("div");
            avatar.className = "avatar";
            avatar.textContent = msg.role === "user" ? "👤" : "🤖";
            const bubble = document.createElement("div");
            bubble.className = "bubble";
            bubble.innerHTML = tutorRenderMinimalMarkdown(msg.content);
            wrap.appendChild(avatar);
            wrap.appendChild(bubble);
            dom.messagesList.appendChild(wrap);
        }
        // auto-scroll
        if (dom.messagesList.parentElement) {
            dom.messagesList.parentElement.scrollTop = dom.messagesList.parentElement.scrollHeight;
        }
    }

    function switchToQuestion(qid) {
        if (!conversations[qid]) return;
        activeQuestion = qid;
        // 탭 active 토글 + new 뱃지 clear
        dom.tabBtns.forEach(b => b.classList.toggle("active", b.dataset.q === qid));
        clearTabNew(qid);
        // 본문 snippet 갱신
        if (dom.questionSnippet) {
            dom.questionSnippet.textContent = config.getQuestionText(getLevel(), qid);
        }
        renderConversation();
        updateInputAvailability();
        updateEndControlsVisibility();
        // 자동 질문 생성 (config.autoQuestionTabIds 활성 시) — 첫 진입 시만
        if (config.autoQuestionTabIds?.includes(qid)) {
            const conv = conversations[qid];
            if (conv && conv.messages.length === 0 && getApiKey()) {
                generateAutoQuestion(qid);
            }
        }
    }

    function markTabNew(qid) {
        if (qid === activeQuestion) return;
        tabNewFlags[qid] = true;
        const btn = sidebar.querySelector(`.tab-btn[data-q="${qid}"]`);
        if (btn) btn.classList.add("has-new");
    }

    function clearTabNew(qid) {
        tabNewFlags[qid] = false;
        const btn = sidebar.querySelector(`.tab-btn[data-q="${qid}"]`);
        if (btn) btn.classList.remove("has-new");
    }

    // === Typing indicator (sendMessage / closeConversation / generateMetaQuestion 공통) ===
    function showTypingIndicator() {
        if (!dom.messagesList) return;
        if (dom.messagesList.querySelector(".typing-indicator")) return;
        const wrap = document.createElement("div");
        wrap.className = "message ai-message typing-indicator";
        wrap.innerHTML = `
            <div class="avatar">🤖</div>
            <div class="bubble typing-dots"><span></span><span></span><span></span></div>
        `;
        dom.messagesList.appendChild(wrap);
        if (dom.messagesList.parentElement) {
            dom.messagesList.parentElement.scrollTop = dom.messagesList.parentElement.scrollHeight;
        }
    }

    function hideTypingIndicator() {
        if (!dom.messagesList) return;
        const ind = dom.messagesList.querySelector(".typing-indicator");
        if (ind) ind.remove();
    }

    function resetTab(qid) {
        if (!conversations[qid]) return;
        conversations[qid] = { messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null, isClosed: false };
        if (qid === config.metaTabId) q4Generated = false;
        if (qid === activeQuestion) renderConversation();
        updateInputAvailability();
        updateEndControlsVisibility();
    }

    function resetAll() {
        for (const qid of config.tabIds) resetTab(qid);
        totalInputTokens = 0;
        totalOutputTokens = 0;
        for (const t of COST_WARN_THRESHOLDS) costWarningShown[t] = false;
        updateUsageDisplay();
        renderConversation();
    }

    async function sendMessage(content) {
        if (!content || !content.trim()) return;
        const startQid = activeQuestion;  // ★ 회귀 4 정정: 호출 시점 탭 캡처. await 중 탭 전환 시 누수 회피
        const conv = conversations[startQid];
        if (!conv || conv.isClosed) return;

        // user 말풍선 추가 — 현재 탭 시점에만 즉시 렌더 (다른 탭이면 messages 만 push)
        conv.messages.push({ role: "user", content: content.trim(), timestamp: Date.now() });
        if (activeQuestion === startQid) {
            renderConversation();
            if (dom.messageInput) dom.messageInput.value = "";
            updateInputAvailability();
            updateEndControlsVisibility();
        }

        // 시스템 prompt + 데이터 컨텍스트
        const ctx = config.buildDataContext();
        const level = getLevel();
        const systemPrompt = config.buildSystemPrompt(level, startQid, ctx);

        // contextSnapshot 첫 turn 만 저장 (보고서 등 후속 사용)
        if (!conv.contextSnapshot) conv.contextSnapshot = ctx;

        // typing indicator (현재 탭에서만 표시) + 호출
        if (activeQuestion === startQid) showTypingIndicator();
        let result;
        try {
            const apiMessages = conv.messages
                .filter(m => !m.isPromptInternal)
                .map(m => ({ role: m.role, content: m.apiContent ?? m.content }));
            result = await tutorCallAnthropic({
                apiKey: getApiKey(),
                model: getModel(),
                systemPrompt,
                messages: apiMessages,
            });
        } catch (e) {
            if (activeQuestion === startQid) hideTypingIndicator();
            const msg = e.type === "no_key"
                ? "API 키가 설정되지 않았습니다."
                : e.type === "api_error"
                    ? tutorFormatApiError(e.status, e.err?.error?.message)
                    : "네트워크 오류가 발생했습니다.";
            conv.messages.push({ role: "assistant", content: `⚠️ ${msg}`, timestamp: Date.now(), isError: true });
            if (activeQuestion === startQid) {
                renderConversation();
                updateInputAvailability();
                updateEndControlsVisibility();
            } else {
                markTabNew(startQid);  // 다른 탭으로 전환했으면 startQid 에 new 뱃지
            }
            return;
        }
        if (activeQuestion === startQid) hideTypingIndicator();

        // [[LEVEL:xxx]] 마커 처리 — 본문에서 제거 + onLevelDetect callback
        let cleanContent = result.content;
        const detectedLevel = tutorExtractLevelMarker(result.content);
        if (detectedLevel) {
            cleanContent = result.content.replace(/\[\[LEVEL:[^\]]+\]\]/g, "").trim();
            sessionStorage.setItem(SESSION_KEY_LEVEL, detectedLevel);
            if (dom.levelSelect) dom.levelSelect.value = detectedLevel;
            if (typeof config.onLevelDetect === "function") config.onLevelDetect(detectedLevel);
        }

        conv.messages.push({ role: "assistant", content: cleanContent, timestamp: Date.now(), model: result.model });
        conv.tokensIn  += result.inputTokens;
        conv.tokensOut += result.outputTokens;
        addTokens(result.inputTokens, result.outputTokens);

        if (activeQuestion === startQid) {
            renderConversation();
            updateInputAvailability();
            updateEndControlsVisibility();
        } else {
            // ★ 회귀 1 정정: 다른 탭으로 전환했으면 startQid 에 has-new 뱃지
            markTabNew(startQid);
        }
    }

    // === closeConversation — 대화 마무리 [✓] (config.closeConfig 활성 시) ===
    // ai-tutor.js closeQuestion (~83줄) 통합. AI 호출 → 2~3줄 요약 → conv.isClosed = true.
    async function closeConversation(qid = activeQuestion) {
        if (!config.closeConfig) return;
        const conv = conversations[qid];
        if (!conv || conv.isClosed) return;
        const visibleCount = conv.messages.filter(m => !m.isPromptInternal).length;
        if (visibleCount === 0) return;

        const closingSystem = config.closeConfig.systemPrompt
            ?? "당신은 영재 과학교육 튜터입니다. 학생과의 탐구 대화를 마무리하는 시간입니다. 대화 전체를 바탕으로 2~3줄 요약을 작성하세요: 학생이 도달한 핵심 이해 + 추가로 생각해볼 여지. 한국어로 답변하세요.";
        const closingUserPrompt = config.closeConfig.userPrompt
            ?? "지금까지의 탐구 대화를 2~3줄로 짧게 정리해주세요.";

        // 가짜 user 메시지 (API 송신용, 표시 X)
        conv.messages.push({
            role: "user", content: "", apiContent: closingUserPrompt,
            timestamp: Date.now(), isPromptInternal: true,
        });

        showTypingIndicator();
        let result;
        try {
            const apiMessages = conv.messages.map(m => ({
                role: m.role, content: m.apiContent ?? m.content,
            }));
            result = await tutorCallAnthropic({
                apiKey: getApiKey(), model: getModel(),
                systemPrompt: closingSystem, messages: apiMessages,
            });
        } catch (e) {
            hideTypingIndicator();
            conv.messages.pop();  // 가짜 user 롤백
            const msg = e.type === "no_key"
                ? "API 키 없음"
                : e.type === "api_error"
                    ? `요약 오류 (HTTP ${e.status})`
                    : "네트워크 오류";
            conv.messages.push({ role: "assistant", content: `⚠️ ${msg}`, timestamp: Date.now(), isError: true });
            renderConversation();
            updateInputAvailability();
            return;
        }
        hideTypingIndicator();

        conv.messages.push({
            role: "assistant",
            content: "📝 **대화 요약**\n\n" + result.content,
            timestamp: Date.now(),
            tokensIn: result.inputTokens, tokensOut: result.outputTokens,
            model: result.model, isClosing: true,
        });
        conv.tokensIn  += result.inputTokens;
        conv.tokensOut += result.outputTokens;
        addTokens(result.inputTokens, result.outputTokens);
        conv.isClosed = true;
        if (qid === activeQuestion) renderConversation();
        else markTabNew(qid);
        updateInputAvailability();
        updateEndControlsVisibility();
    }

    // === generateMetaQuestion — Q4 메타 [질문 생성] (config.metaTabId 활성 시) ===
    // ai-tutor.js generateQ4Question (~90줄) 통합. AI 호출 → 가짜 user prompt + 응답.
    async function generateMetaQuestion() {
        if (!config.metaTabId) return;
        const qid = config.metaTabId;
        const conv = conversations[qid];
        if (!conv) return;

        const ctx = config.buildDataContext();
        const level = getLevel();
        const systemPrompt = config.buildSystemPrompt(level, qid, ctx);
        const userMsgContent = config.metaUserPromptBuilder
            ? config.metaUserPromptBuilder(ctx, level)
            : "위 데이터를 바탕으로 학생이 추가로 탐구하면 좋을 질문을 1개 제안해주세요.";

        // 가짜 user 메시지 (API 송신용, 표시 X)
        conv.messages.push({
            role: "user", content: "", apiContent: userMsgContent,
            timestamp: Date.now(), isPromptInternal: true,
        });
        conv.contextSnapshot = ctx;

        showTypingIndicator();
        let result;
        try {
            result = await tutorCallAnthropic({
                apiKey: getApiKey(), model: getModel(),
                systemPrompt, messages: [{ role: "user", content: userMsgContent }],
            });
        } catch (e) {
            hideTypingIndicator();
            conv.messages.pop();  // 가짜 user 롤백
            if (qid !== activeQuestion) { markTabNew(qid); return; }
            renderConversation();
            const msg = e.type === "no_key"
                ? "API 키가 설정되지 않았습니다."
                : e.type === "api_error"
                    ? `질문 생성 오류 (HTTP ${e.status})`
                    : "네트워크 오류";
            conv.messages.push({ role: "assistant", content: `⚠️ ${msg}`, timestamp: Date.now(), isError: true });
            renderConversation();
            return;
        }
        hideTypingIndicator();

        conv.messages.push({
            role: "assistant", content: result.content,
            timestamp: Date.now(),
            tokensIn: result.inputTokens, tokensOut: result.outputTokens,
            model: result.model,
        });
        conv.tokensIn  += result.inputTokens;
        conv.tokensOut += result.outputTokens;
        addTokens(result.inputTokens, result.outputTokens);
        if (qid === activeQuestion) renderConversation();
        else markTabNew(qid);
        updateInputAvailability();
    }

    // === generateAutoQuestion — config.autoQuestionTabIds 안의 탭 첫 진입 시 AI 자동 질문 생성 ===
    // 보일 Q3 패턴 — 측정 데이터 기반 탐구 질문 자동 생성. config.autoQuestionTabIds=['3'] 시 활성.
    async function generateAutoQuestion(qid) {
        if (!config.autoQuestionTabIds?.includes(qid)) return;
        // (a-2) 회귀 2차 방어: aria-disabled 탭은 자동 질문도 차단 (외부 호출 안전망)
        const tabBtn = sidebar.querySelector(`.tab-btn[data-q="${qid}"]`);
        if (tabBtn?.getAttribute("aria-disabled") === "true") return;
        const conv = conversations[qid];
        if (!conv || conv.messages.length > 0) return;  // 이미 conversation 있으면 skip

        const ctx = config.buildDataContext();
        const level = getLevel();
        const systemPrompt = config.buildSystemPrompt(level, qid, ctx);
        const userMsgContent = config.autoQuestionPromptBuilder
            ? config.autoQuestionPromptBuilder(qid, ctx, level)
            : "위 데이터를 바탕으로 학생이 답변할 첫 탐구 질문 1개를 제안해주세요.";

        conv.messages.push({
            role: "user", content: "", apiContent: userMsgContent,
            timestamp: Date.now(), isPromptInternal: true,
        });
        conv.contextSnapshot = ctx;

        showTypingIndicator();
        let result;
        try {
            result = await tutorCallAnthropic({
                apiKey: getApiKey(), model: getModel(),
                systemPrompt, messages: [{ role: "user", content: userMsgContent }],
            });
        } catch (e) {
            hideTypingIndicator();
            conv.messages.pop();  // 가짜 user 롤백 — 재시도 시 진입 그대로
            return;
        }
        hideTypingIndicator();

        conv.messages.push({
            role: "assistant", content: result.content, timestamp: Date.now(),
            tokensIn: result.inputTokens, tokensOut: result.outputTokens, model: result.model,
        });
        conv.tokensIn  += result.inputTokens;
        conv.tokensOut += result.outputTokens;
        addTokens(result.inputTokens, result.outputTokens);
        if (qid === activeQuestion) renderConversation();
        else markTabNew(qid);
    }

    async function generateReport() {
        if (!config.reportEnabled || !config.reportConfig?.generateAndDownload) {
            console.warn(`[tutor:${config.simName}] reportEnabled=false — generateReport 호출 무시`);
            return;
        }
        const ctx = config.buildDataContext();
        return config.reportConfig.generateAndDownload(ctx, conversations);
    }

    // 외부에서 측정점 변경 시 호출 — 탭 활성/비활성 처리 (Q1~Q3 ≥ 3 datapoints 등)
    function updateTabAvailability(datapointCount) {
        const ready = datapointCount >= 3;
        for (const qid of config.tabIds) {
            if (qid === "free" || qid === config.metaTabId) continue;  // free / meta 는 항상 활성
            const btn = sidebar.querySelector(`.tab-btn[data-q="${qid}"]`);
            if (btn) btn.setAttribute("aria-disabled", ready ? "false" : "true");
        }
        updateInputAvailability();
    }

    // --- init: DOM wiring (settings 패널 / 탭 / 입력창 / level/model select)
    function init() {
        // level/model 초기값 + change 핸들러
        if (dom.levelSelect) {
            dom.levelSelect.value = sessionStorage.getItem(SESSION_KEY_LEVEL) || "high";
            dom.levelSelect.addEventListener("change", () => {
                sessionStorage.setItem(SESSION_KEY_LEVEL, dom.levelSelect.value);
                if (dom.questionSnippet) {
                    dom.questionSnippet.textContent = config.getQuestionText(dom.levelSelect.value, activeQuestion);
                }
            });
        }
        if (dom.modelSelect) {
            dom.modelSelect.value = sessionStorage.getItem(SESSION_KEY_MODEL) || "claude-sonnet-4-6";
            dom.modelSelect.addEventListener("change", () => {
                sessionStorage.setItem(SESSION_KEY_MODEL, dom.modelSelect.value);
                updateUsageDisplay();
            });
        }

        // settings 토글 + 진입 시 항상 펼침 (Phase 5.5 결정)
        if (dom.settingsToggle && dom.settingsPanel) {
            dom.settingsToggle.addEventListener("click", () => {
                dom.settingsPanel.classList.toggle("open");
            });
            dom.settingsPanel.classList.add("open");
        }

        // 탭 click
        dom.tabBtns.forEach(btn => {
            btn.addEventListener("click", (e) => {
                if (e.target.classList.contains("tab-reset")) return;  // reset 버튼 분리
                if (btn.getAttribute("aria-disabled") === "true") return;  // (a-2) 회귀: 회색 탭 클릭 차단
                const q = btn.dataset.q;
                if (q && q !== activeQuestion) switchToQuestion(q);
            });
        });

        // tab reset 버튼
        dom.tabResetBtns.forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const q = btn.dataset.q || btn.closest(".tab-btn")?.dataset.q;
                if (q) resetTab(q);
            });
        });

        // 입력창
        if (dom.messageInput) {
            dom.messageInput.addEventListener("input", updateInputAvailability);
            dom.messageInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(dom.messageInput.value);
                }
            });
        }
        if (dom.btnSendMessage) {
            dom.btnSendMessage.addEventListener("click", () => sendMessage(dom.messageInput?.value || ""));
        }

        // 첫 탭 활성
        switchToQuestion(activeQuestion);
        updateUsageDisplay();
        updateInputAvailability();
    }

    return {
        init,
        switchToQuestion,
        sendMessage,
        closeConversation,
        generateMetaQuestion,
        generateAutoQuestion,
        generateReport,
        getConversations,
        resetAll,
        resetTab,
        updateTabAvailability,
        getTokenUsage,
        getActiveQuestion,
        getApiKey,
        getLevel,
        getModel,
        markTabNew,
        clearTabNew,
        addTokens,
    };
}

// =============================================================
// §4. 전역 노출 (브라우저 <script> 패턴 — ESM 미사용)
// =============================================================
//
// 본 모듈은 web/js/tutor.js 로 <script> 로드. 모듈 시스템 X.
// 시뮬별 적용 코드 (보일/입자/돌턴) 는 다음 단계 (a)/(b)/(c) commit.

if (typeof window !== "undefined") {
    window.PchemTutorModule = {
        createTutor,
        TUTOR_MODELS,
        TUTOR_LEVELS,
        TUTOR_LEVEL_LABELS,
        USD_TO_KRW,
        SOFT_TURN_LIMIT,
        tutorEscapeHtml,
        tutorRenderMinimalMarkdown,
        tutorCallAnthropic,
        tutorComputeCost,
        tutorFormatApiError,
        tutorExtractLevelMarker,
    };
}
