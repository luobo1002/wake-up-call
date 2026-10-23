// ============================================================
//  Wake-Up Call — SillyTavern 扩展
//  ------------------------------------------------------------
//  功能：
//    1) 监听聊天消息，识别任意时间指令：
//         - 相对时间：十五分钟后提醒我 / 半小时后 / 2小时后
//         - 绝对时间：明天7点叫醒我 / 下午3点半 / 晚上10点
//         - 默认时段：晚安 / 睡了 → 默认叫醒时间
//         - 取消指令：取消提醒 / 取消闹钟
//    2) 通过 Termux 本地桥（bridge.py）注册定时任务；
//    3) 到点由 Termux 弹普通通知，内容为角色用 AI 生成的
//       早安回复（调用一次 API，全程不打开酒馆）；
//    4) 说晚安时把角色人格+最近聊天缓存到手机。
//  ------------------------------------------------------------
//  安装：把整个 wake-up-call 文件夹放入
//        SillyTavern/data/<user>/extensions/ 下，重启酒馆。
//  依赖：Termux 侧运行 termux/bridge.py（见 README）。
// ============================================================
import { eventSource, event_types, extension_settings, renderExtensionTemplateAsync, saveSettingsDebounced } from "../../../extensions.js";

// 兼容不同版本的 SillyTavern：优先新版全局 API，退化到旧版全局
function getCtx() {
    try {
        if (window.SillyTavern && typeof window.SillyTavern.getContext === "function") {
            return window.SillyTavern.getContext();
        }
        if (typeof window.getContext === "function") {
            return window.getContext();
        }
    } catch (e) { /* ignore */ }
    return null;
}

// ---------- 默认设置（可在酒馆扩展设置面板里改）----------
const defaultSettings = {
    bridgeUrl: "http://127.0.0.1:8765",   // Termux 桥接服务地址
    bridgeKey: "wake-2026",               // 桥接密钥（自动同步到 Termux 配置）
    apiKey: "wake-2026",                  // 酒馆注入端点密钥（自动同步）
    apiBase: "https://api.openai.com/v1", // AI API 地址（自动同步给 morning.py）
    apiModel: "gpt-4o-mini",              // 模型名
    aiApiKey: "",                         // AI API Key
    defaultHour: 8,                       // 只说「晚安」时的默认叫醒时间
    defaultMinute: 0,
    confirmInject: true,                  // 操作后是否在聊天里注入系统消息
    confirmText: "【系统】已设置 {time} 的提醒，晚安～",
    cancelText: "【系统】已取消提醒，好好休息吧～",
    wakeText: "【系统】主人已在闹钟时间醒来，新的一天开始咯～",
    mode: "all",                          // 生效范围：all=所有聊天 / whitelist=仅白名单角色 / off=停用
    whitelist: [],                        // 白名单角色名数组（mode=whitelist 时生效）
};

let settings = { ...defaultSettings };

// ---------- 中文数字 → 阿拉伯数字 ----------
const cnNum = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function parseCnNumber(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    let total = 0, current = 0;
    for (const ch of s) {
        const v = cnNum[ch];
        if (v === undefined) return null;
        if (v === 10) { current = (current || 1) * 10; }
        else { total += current; current = v; }
    }
    return total + current;
}

// ---------- 相对时间：返回分钟数 ----------
function parseRelativeMinutes(t) {
    let m = t.match(/([0-9一二两三四五六七八九十]+)\s*分钟(?:后|钟)?/);
    if (m) { const n = parseCnNumber(m[1]); if (n !== null && n > 0) return n; }
    if (/半小时/.test(t)) return 30;
    if (/一刻钟/.test(t)) return 15;
    m = t.match(/([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:小时|钟头)(?:后|钟)?/);
    if (m) { const n = parseCnNumber(m[1]); if (n !== null && n > 0) return n * 60; }
    return null;
}

// ---------- 绝对时间：返回 { hour, minute, dayOffset } ----------
function parseAbsoluteTime(t) {
    let dayOffset = 0;
    if (/明天|明早|明晚/.test(t)) dayOffset = 1;
    else if (/后天/.test(t)) dayOffset = 2;

    let period = null;
    if (/晚上|晚间|夜晚/.test(t)) period = "evening";
    else if (/下午|傍晚/.test(t)) period = "pm";
    else if (/早上|早晨|上午/.test(t)) period = "am";

    const m = t.match(/([0-9一二两三四五六七八九十]+)(?:[:：](\d{1,2})|点([0-9一二两三四五六七八九十]+)分?|点(半)?)/);
    if (!m) return null;
    let hour = parseCnNumber(m[1]);
    let minute = 0;
    if (m[2] !== undefined) minute = parseInt(m[2], 10);
    else if (m[3] !== undefined) minute = parseCnNumber(m[3]);
    else if (m[4]) minute = 30;
    if (hour === null || hour > 23) return null;

    if (period === "evening" && hour < 12) hour += 12;
    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute, dayOffset };
}

// ---------- 计算目标时间戳 ----------
// 返回 { ts: unix毫秒, label: 显示用时间描述 } 或 null
function computeTarget(text) {
    const t = text.replace(/\s+/g, "");
    const now = Date.now();

    // 1) 相对时间：十五分钟后提醒我
    if (/提醒|闹钟|叫我|叫醒/.test(text)) {
        const mins = parseRelativeMinutes(t);
        if (mins !== null) return { ts: now + mins * 60000, label: `${mins}分钟后` };
    }

    // 2) 绝对时间：明天7点 / 下午3点半 / 晚上10点 / 15:30
    const abs = parseAbsoluteTime(t);
    if (abs) {
        let d = new Date(now);
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + abs.dayOffset, abs.hour, abs.minute, 0, 0);
        if (d.getTime() <= now) d = new Date(d.getTime() + 86400000); // 时间已过 → 顺延一天
        const label = `${d.getMonth() + 1}月${d.getDate()}日 ${String(abs.hour).padStart(2, "0")}:${String(abs.minute).padStart(2, "0")}`;
        return { ts: d.getTime(), label };
    }

    // 3) 晚安 / 睡了 → 默认叫醒时间
    if (/晚安|睡了|睡觉|就寝/.test(text)) {
        const d = new Date(now);
        const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, settings.defaultHour, settings.defaultMinute, 0, 0);
        const label = `明天 ${String(settings.defaultHour).padStart(2, "0")}:${String(settings.defaultMinute).padStart(2, "0")}`;
        return { ts: dt.getTime(), label };
    }

    return null;
}

// ---------- 注入系统消息（不计入主线）----------
function injectSystem(text) {
    const ctx = getCtx();
    if (!ctx || !ctx.chat) return;
    ctx.chat.push({
        name: "System",
        is_system: true,
        mes: text,
        extra: { wakeup: true },
    });
    eventSource.emit(event_types.CHAT_CHANGED);
    if (typeof ctx.saveChatConditional === "function") {
        ctx.saveChatConditional();
    }
}

// ---------- 调用 Termux 桥：设定 / 取消 ----------
async function scheduleAlarm(ts, label) {
    try {
        const url = `${settings.bridgeUrl}/schedule?key=${encodeURIComponent(settings.bridgeKey)}&ts=${ts}&text=${encodeURIComponent(label)}`;
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) console.error("[WakeUp] 桥接返回错误:", res.status);
    } catch (e) {
        console.error("[WakeUp] 无法连接 Termux 桥，请确认 bridge.py 在运行:", e);
    }
}

async function cancelAlarm() {
    try {
        const url = `${settings.bridgeUrl}/cancel?key=${encodeURIComponent(settings.bridgeKey)}`;
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) console.error("[WakeUp] 取消失败:", res.status);
    } catch (e) {
        console.error("[WakeUp] 无法连接 Termux 桥:", e);
    }
}

// ---------- 配置同步：把密钥 + AI API 配置写到 Termux ----------
async function syncConfig() {
    try {
        const body = {
            bridge_key: settings.bridgeKey,
            api_wake_key: settings.apiKey,
            api_base: settings.apiBase,
            api_key: settings.aiApiKey,
            model: settings.apiModel,
        };
        const res = await fetch(`${settings.bridgeUrl}/config?key=${encodeURIComponent(settings.bridgeKey)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok) console.error("[WakeUp] 配置同步失败:", res.status);
        return res.ok;
    } catch (e) {
        console.error("[WakeUp] 配置同步失败（桥未运行？）:", e);
        return false;
    }
}

// ---------- 桥健康检查 ----------
async function checkBridge() {
    try {
        const res = await fetch(`${settings.bridgeUrl}/ping`, { method: "GET" });
        return res.ok;
    } catch (e) {
        return false;
    }
}

// ---------- 把角色人格 + 最近聊天缓存到手机（供早上离线生成回复）----------
async function sendRoleCache() {
    try {
        const ctx = getCtx();
        const ch = (ctx && ctx.characterId !== undefined && ctx.characters && ctx.characters[ctx.characterId])
            ? ctx.characters[ctx.characterId] : null;
        const cacheData = {
            character: ch ? {
                name: ch.name || "",
                description: String(ch.description || "").slice(0, 2000),
                personality: String(ch.personality || "").slice(0, 2000),
                scenario: String(ch.scenario || "").slice(0, 2000),
                mes_example: String(ch.mes_example || "").slice(0, 2000),
            } : null,
            userName: ctx?.name1 || "用户",
            history: (ctx?.chat || []).slice(-8).map(m => ({
                name: m.name || "",
                is_user: !!m.is_user,
                mes: String(m.mes || "").slice(0, 500),
            })),
        };
        const url = `${settings.bridgeUrl}/cache?key=${encodeURIComponent(settings.bridgeKey)}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cacheData),
        });
        if (!res.ok) console.error("[WakeUp] 角色缓存写入失败:", res.status);
    } catch (e) {
        console.error("[WakeUp] 无法写入角色缓存:", e);
    }
}

// ---------- 生效范围判断 ----------
function getCurrentCharacterName() {
    const ctx = getCtx();
    if (ctx && ctx.characterId !== undefined && ctx.characters && ctx.characters[ctx.characterId]) {
        return ctx.characters[ctx.characterId].name;
    }
    return null;
}

function shouldActivate() {
    if (settings.mode === "off") return false;
    if (settings.mode === "all") return true;
    const name = getCurrentCharacterName();
    return name !== null && settings.whitelist.includes(name);
}

// ---------- 用户消息处理 ----------
function handleUserMessage(data) {
    const text = (data?.mes || "").toString();
    if (!text) return;
    if (!shouldActivate()) return;

    // 取消指令优先
    if (/取消(闹钟|提醒|叫醒|定时|时间)/.test(text)) {
        cancelAlarm();
        if (settings.confirmInject) injectSystem(settings.cancelText);
        return;
    }

    const target = computeTarget(text);
    if (!target) return;

    scheduleAlarm(target.ts, target.label);
    sendRoleCache();
    if (settings.confirmInject) {
        injectSystem(settings.confirmText.replace("{time}", target.label));
    }
}

// ---------- 到点事件补注入：酒馆打开时把「已醒来」写入聊天 ----------
// 到点后 Termux 会写 ~/wakeup_event.json；酒馆前端每次打开（及每 60 秒）
// 检查一次桥，有未消费事件就注入系统消息并清除（不计入主线剧情）。
async function consumeWakeEvent() {
    try {
        const res = await fetch(`${settings.bridgeUrl}/event?key=${encodeURIComponent(settings.bridgeKey)}`, { method: "GET" });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.ok && data.text) {
            injectSystem(data.text);
            await fetch(`${settings.bridgeUrl}/event-consume?key=${encodeURIComponent(settings.bridgeKey)}`, { method: "GET" });
            console.log("[WakeUp] 已补注入醒来消息:", data.text);
        }
    } catch (e) {
        // 桥未启动时静默跳过，下次再查
    }
}

// ---------- 酒馆顶栏图标：点击弹出提醒设置浮层 ----------
function buildWakePanel() {
    $("#wakeup-panel").remove();
    const $panel = $(`
<div id="wakeup-panel" style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);">
  <div style="width:300px;max-width:88vw;border-radius:14px;padding:18px 20px;background:var(--SmartThemeBlurTintColor,#222);border:1px solid var(--SmartThemeBorderColor,#555);box-shadow:0 10px 40px rgba(0,0,0,.5);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <b style="font-size:15px;">⏰ Wake-Up 提醒</b>
      <button id="wakeup-panel-close" class="menu_button" style="padding:2px 8px;">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <button class="wakeup-quick menu_button" data-min="15">15分钟后</button>
      <button class="wakeup-quick menu_button" data-min="30">30分钟后</button>
      <button class="wakeup-quick menu_button" data-min="60">1小时后</button>
      <button class="wakeup-quick menu_button" data-tomorrow="1">明天早上8点</button>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
      <input id="wakeup-panel-time" type="time" value="08:00" style="flex:1;">
      <button id="wakeup-panel-custom" class="menu_button">自定义</button>
    </div>
    <button id="wakeup-panel-cancel" class="menu_button" style="width:100%;margin-bottom:6px;">取消提醒</button>
    <div id="wakeup-panel-msg" style="font-size:11px;opacity:.7;min-height:14px;"></div>
  </div>
</div>`);
    $panel.on("click", function (e) { if (e.target === this) closeWakePanel(); });
    $panel.find("#wakeup-panel-close").on("click", closeWakePanel);
    $panel.find(".wakeup-quick").on("click", function () {
        const min = $(this).attr("data-min");
        if (min) {
            const ts = Date.now() + parseInt(min, 10) * 60000;
            const label = `${min}分钟后`;
            scheduleAlarm(ts, label);
            showWakeMsg(`已设置 ${label} 提醒`);
        } else {
            const now = new Date();
            const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, settings.defaultHour, settings.defaultMinute, 0, 0);
            const label = `明天 ${String(settings.defaultHour).padStart(2, "0")}:${String(settings.defaultMinute).padStart(2, "0")}`;
            scheduleAlarm(dt.getTime(), label);
            showWakeMsg(`已设置 ${label} 提醒`);
        }
    });
    $panel.find("#wakeup-panel-custom").on("click", function () {
        const v = $("#wakeup-panel-time").val();
        if (!v) return showWakeMsg("请先选择时间");
        const [h, m] = v.split(":").map(Number);
        const now = new Date();
        const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
        if (dt.getTime() <= now.getTime()) dt.setDate(dt.getDate() + 1);
        const label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        scheduleAlarm(dt.getTime(), label);
        showWakeMsg(`已设置 ${label} 提醒`);
    });
    $panel.find("#wakeup-panel-cancel").on("click", function () {
        cancelAlarm();
        showWakeMsg("已取消提醒");
    });
    $("body").append($panel);
    return $panel;
}

function openWakePanel() {
    const $panel = buildWakePanel();
    $panel.find("#wakeup-panel-time").val(
        String(settings.defaultHour).padStart(2, "0") + ":" + String(settings.defaultMinute).padStart(2, "0")
    );
    $panel.find("#wakeup-panel-msg").text(settings.mode === "off" ? "当前生效范围=停用，这里仍可手动设置提醒" : "");
}

function closeWakePanel() {
    $("#wakeup-panel").remove();
}

function showWakeMsg(text) {
    $("#wakeup-panel-msg").text(text);
}

function addTopBarButton() {
    if ($("#wakeup-topbar-btn").length) return;
    const $btn = $('<div id="wakeup-topbar-btn" class="topbar_button" title="Wake-Up 提醒：快捷设置提醒时间" style="font-size:16px;line-height:1;">⏰</div>');
    $btn.on("click", openWakePanel);
    const bar = $("#top-bar, .topBar, #top-bar-holder").first();
    if (bar.length) bar.append($btn);
}

// ---------- 设置面板 ----------
jQuery(async () => {
    if (extension_settings.wakeup) {
        settings = { ...defaultSettings, ...extension_settings.wakeup };
    }

    const html = await renderExtensionTemplateAsync("wake-up-call", "settings");
    $("#extensions_settings").append(html);

    $("#wakeup-bridge-url").val(settings.bridgeUrl);
    $("#wakeup-bridge-key").val(settings.bridgeKey);
    $("#wakeup-api-key").val(settings.apiKey);
    $("#wakeup-api-base").val(settings.apiBase);
    $("#wakeup-api-model").val(settings.apiModel);
    $("#wakeup-ai-key").val(settings.aiApiKey);
    $("#wakeup-hour").val(settings.defaultHour);
    $("#wakeup-minute").val(settings.defaultMinute);
    $("#wakeup-confirm").prop("checked", settings.confirmInject);
    $("#wakeup-confirm-text").val(settings.confirmText);
    $("#wakeup-cancel-text").val(settings.cancelText);
    $("#wakeup-wake-text").val(settings.wakeText);
    $("#wakeup-mode").val(settings.mode);
    $("#wakeup-whitelist").val(settings.whitelist.join(", "));

    // 部署命令显示
    $("#wakeup-deploy-cmd").val("bash ~/SillyTavern/data/default-user/extensions/wake-up-call/setup.sh");

    // 桥状态检测
    checkBridge().then(ok => {
        const el = $("#wakeup-bridge-status");
        if (el.length) {
            el.text(ok ? "● 桥已连接" : "○ 桥未连接（请在 Termux 运行部署命令）");
            el.css("color", ok ? "#3fb950" : "#f85149");
        }
    });

    // 到点事件补注入：打开酒馆时检查一次，之后每 60 秒轮询
    consumeWakeEvent();
    setInterval(consumeWakeEvent, 60000);

    $("#wakeup-copy-cmd").on("click", async () => {
        const cmd = $("#wakeup-deploy-cmd").val();
        try {
            await navigator.clipboard.writeText(cmd);
            if (typeof toastr !== "undefined") toastr.success("部署命令已复制，去 Termux 粘贴运行");
        } catch (e) {
            console.error("[WakeUp] 复制失败:", e);
        }
    });

    $("#wakeup-save").on("click", async () => {
        settings.bridgeUrl = $("#wakeup-bridge-url").val().trim() || defaultSettings.bridgeUrl;
        settings.bridgeKey = $("#wakeup-bridge-key").val().trim() || defaultSettings.bridgeKey;
        settings.apiKey = $("#wakeup-api-key").val().trim() || defaultSettings.apiKey;
        settings.apiBase = $("#wakeup-api-base").val().trim() || defaultSettings.apiBase;
        settings.apiModel = $("#wakeup-api-model").val().trim() || defaultSettings.apiModel;
        settings.aiApiKey = $("#wakeup-ai-key").val().trim();
        settings.defaultHour = Math.min(23, Math.max(0, parseInt($("#wakeup-hour").val(), 10) || 8));
        settings.defaultMinute = Math.min(59, Math.max(0, parseInt($("#wakeup-minute").val(), 10) || 0));
        settings.confirmInject = $("#wakeup-confirm").is(":checked");
        settings.confirmText = $("#wakeup-confirm-text").val().trim();
        settings.cancelText = $("#wakeup-cancel-text").val().trim();
        settings.wakeText = $("#wakeup-wake-text").val().trim();
        settings.mode = $("#wakeup-mode").val() || "all";
        settings.whitelist = ($("#wakeup-whitelist").val() || "")
            .split(/[,，]/).map(s => s.trim()).filter(Boolean);
        extension_settings.wakeup = settings;
        saveSettingsDebounced();
        const synced = await syncConfig();
        if (typeof toastr !== "undefined") {
            toastr.success(synced ? "设置已保存并同步到 Termux" : "设置已保存（桥未连接，部署后请再点保存）");
        }
    });

    eventSource.on(event_types.MESSAGE_SENT, handleUserMessage);

    // 酒馆顶栏图标（⏰）
    addTopBarButton();
});
