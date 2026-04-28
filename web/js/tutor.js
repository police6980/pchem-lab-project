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
        if (typeof config.onTokenUsage === "function") {
            config.onTokenUsage(getModel(), totalInputTokens, totalOutputTokens, cost);
        }
    }

    function addTokens(inputT, outputT) {
        totalInputTokens += inputT;
        totalOutputTokens += outputT;
        updateUsageDisplay();
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

    function renderConversation() {
        const conv = conversations[activeQuestion];
        if (!dom.messagesList) return;
        dom.messagesList.innerHTML = "";
        const visible = conv.messages.filter(m => !m.isPromptInternal);
        if (visible.length === 0 && dom.conversationEmpty) {
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
        tabNewFlags[qid] = false;
        // 본문 snippet 갱신
        if (dom.questionSnippet) {
            dom.questionSnippet.textContent = config.getQuestionText(getLevel(), qid);
        }
        renderConversation();
        updateInputAvailability();
    }

    function markTabNew(qid) {
        if (qid === activeQuestion) return;
        tabNewFlags[qid] = true;
        const btn = sidebar.querySelector(`.tab-btn[data-q="${qid}"]`);
        if (btn) btn.classList.add("has-new");
    }

    function resetTab(qid) {
        if (!conversations[qid]) return;
        conversations[qid] = { messages: [], tokensIn: 0, tokensOut: 0, contextSnapshot: null, isClosed: false };
        if (qid === config.metaTabId) q4Generated = false;
        if (qid === activeQuestion) renderConversation();
        updateInputAvailability();
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
        const qid = activeQuestion;
        const conv = conversations[qid];
        if (!conv || conv.isClosed) return;

        // user 말풍선 추가
        conv.messages.push({ role: "user", content: content.trim(), timestamp: Date.now() });
        renderConversation();
        if (dom.messageInput) { dom.messageInput.value = ""; }
        updateInputAvailability();

        // 시스템 prompt + 데이터 컨텍스트
        const ctx = config.buildDataContext();
        const level = getLevel();
        const systemPrompt = config.buildSystemPrompt(level, qid, ctx);

        // contextSnapshot 첫 turn 만 저장 (보고서 등 후속 사용)
        if (!conv.contextSnapshot) conv.contextSnapshot = ctx;

        // 호출
        let result;
        try {
            const apiMessages = conv.messages
                .filter(m => !m.isPromptInternal)
                .map(m => ({ role: m.role, content: m.content }));
            result = await tutorCallAnthropic({
                apiKey: getApiKey(),
                model: getModel(),
                systemPrompt,
                messages: apiMessages,
            });
        } catch (e) {
            const msg = e.type === "no_key"
                ? "API 키가 설정되지 않았습니다."
                : e.type === "api_error"
                    ? tutorFormatApiError(e.status, e.err?.error?.message)
                    : "네트워크 오류가 발생했습니다.";
            conv.messages.push({ role: "assistant", content: `⚠️ ${msg}`, timestamp: Date.now(), isError: true });
            renderConversation();
            updateInputAvailability();
            return;
        }

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
        renderConversation();
        updateInputAvailability();
        markTabNew(qid);  // 다른 탭 활성 시점에 "new" (현재 탭이면 즉시 clear)
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
