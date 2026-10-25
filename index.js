// ============================================================
//  Wake-Up Call v3.1 — SillyTavern 独立扩展
//  不依赖酒馆助手（JS-Slash-Runner），直接挂酒馆原生 API
//  作者：luobo1002
// ============================================================

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════
  //  1. 兼容层：安全获取酒馆全局对象
  // ═══════════════════════════════════════════════════════════
  function getTop() {
    try { return (window.parent !== window ? window.parent : window); }
    catch (e) { return window; }
  }

  function getCtx() {
    const top = getTop();
    try {
      if (top.SillyTavern?.getContext) return top.SillyTavern.getContext();
    } catch (e) {}
    try {
      if (typeof getContext === "function") return getContext();
    } catch (e) {}
    return null;
  }

  function getEventSource() {
    const top = getTop();
    const ctx = getCtx();
    return ctx?.eventSource ?? top.eventSource ?? window.eventSource ?? null;
  }

  function getEventTypes() {
    const top = getTop();
    const ctx = getCtx();
    return ctx?.event_types ?? top.event_types ?? top.tavern_events ?? window.event_types ?? {};
  }

  function getExtSettings() {
    const top = getTop();
    return top.extension_settings ?? window.extension_settings ?? {};
  }

  function doSaveSettings() {
    const top = getTop();
    const fn = top.saveSettingsDebounced ?? window.saveSettingsDebounced;
    if (typeof fn === "function") fn();
  }

  // ═══════════════════════════════════════════════════════════
  //  2. 设置管理
  // ═══════════════════════════════════════════════════════════
  const DEFAULTS = {
    bridgeUrl:       "http://127.0.0.1:8765",
    bridgeKey:       "wake-2026",
    defaultHour:     7,
    defaultMinute:   30,
    enableAlarm:     true,         // 是否触发手机系统闹钟
    // 角色绑定（空串=全局）
    boundCharName:   "",
    // 生成方式：history | descOnly | worldbook | custom
    genMode:         "history",
    genCustomText:   "早安～新的一天开始了！",
    genWorldbookUid: "",           // 世界书条目 UID
    genWorldbookContent: "",       // 世界书条目内容（缓存）
    // 注入消息模板（不计入主线）
    wakeMessage:     "（系统：叫醒时间到了，{{char}} 的提醒已触发～）",
    // 面板悬浮球位置
    fabLeft: null,
    fabBottom: 130,
  };

  let cfg = { ...DEFAULTS };

  function loadCfg() {
    const ext = getExtSettings();
    if (ext.wakeUpCall) cfg = { ...DEFAULTS, ...ext.wakeUpCall };
    else cfg = { ...DEFAULTS };
  }

  function saveCfg() {
    const ext = getExtSettings();
    ext.wakeUpCall = { ...cfg };
    doSaveSettings();
  }

  // ═══════════════════════════════════════════════════════════
  //  3. 时间解析（支持中文 + 数字，相对 + 绝对）
  // ═══════════════════════════════════════════════════════════
  const CN = { 零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9 };

  function parseCN(s) {
    if (!s) return NaN;
    s = String(s).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    let total = 0, cur = 0;
    for (const ch of s) {
      const v = CN[ch];
      if (v === undefined) {
        if (ch === "十") { cur = (cur || 1) * 10; continue; }
        return NaN;
      }
      total += cur; cur = v;
    }
    return total + cur;
  }

  // 相对分钟
  function parseRelative(text) {
    const t = text.replace(/\s+/g, "");
    // "半小时后"
    if (/半小时/.test(t)) return 30;
    // "一刻钟"
    if (/一刻钟?/.test(t)) return 15;
    // "N分钟后"
    let m = t.match(/([0-9零一二两三四五六七八九十百]+)\s*分钟?后/);
    if (m) { const n = parseCN(m[1]); if (!isNaN(n) && n > 0) return n; }
    // "N小时后"
    m = t.match(/([0-9零一二两三四五六七八九十]+)\s*(?:个)?(?:小时|钟头)后/);
    if (m) { const n = parseCN(m[1]); if (!isNaN(n) && n > 0) return n * 60; }
    return null;
  }

  // 绝对时间（返回 {hour, minute, dayOffset}）
  function parseAbsolute(text) {
    const t = text.replace(/\s+/g, "");
    let dayOffset = 0;
    if (/明天|明早|明晚/.test(t)) dayOffset = 1;
    else if (/后天/.test(t)) dayOffset = 2;

    let period = null;
    if (/晚上|晚间|夜里|深夜/.test(t)) period = "night";
    else if (/下午|傍晚/.test(t)) period = "pm";
    else if (/早上|早晨|清晨|上午/.test(t)) period = "am";

    // 匹配 "7点" "7:30" "7点30分" "7点半" 等
    const re = /([0-9零一二两三四五六七八九十]+)(?::(\d{1,2})|[点时]([0-9零一二两三四五六七八九十]+)分?|[点时](半)?)/;
    const m = t.match(re);
    if (!m) return null;

    let hour = parseCN(m[1]);
    let minute = 0;
    if (m[2] !== undefined)      minute = parseInt(m[2], 10);
    else if (m[3] !== undefined) minute = parseCN(m[3]);
    else if (m[4])               minute = 30;

    if (isNaN(hour) || isNaN(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

    // 12 小时制修正
    if (period === "night" && hour < 12) hour += 12;
    if (period === "pm"    && hour <  8 && hour < 12) hour += 12;
    if (period === "am"    && hour === 12) hour = 0;

    return { hour, minute, dayOffset };
  }

  // 主入口：返回 { ts, label } 或 { cancel: true } 或 null
  function parseTimeCommand(text) {
    const t = String(text || "").replace(/[。！？，、\s]/g, "");

    // 取消
    if (/取消(提醒|闹钟|叫醒|定时)/.test(t)) return { cancel: true };

    // 相对时间（需要有"提醒""叫"等触发词）
    if (/提醒|叫醒?我|叫我/.test(t)) {
      const mins = parseRelative(t);
      if (mins !== null) {
        return { ts: Date.now() + mins * 60_000, label: `${mins}分钟后` };
      }
    }

    // 绝对时间（需要有"叫""提醒""叫醒"等，或"明天"等日期词）
    const needsKeyword = /叫醒?我?|叫我|提醒我?|起床|明天|明早|后天/.test(t);
    if (needsKeyword) {
      const abs = parseAbsolute(t);
      if (abs) {
        const now = new Date();
        let dt = new Date(
          now.getFullYear(), now.getMonth(),
          now.getDate() + abs.dayOffset,
          abs.hour, abs.minute, 0, 0
        );
        if (dt.getTime() <= Date.now()) dt = new Date(dt.getTime() + 86_400_000);
        const label = `${dt.getMonth()+1}/${dt.getDate()} ${String(abs.hour).padStart(2,"0")}:${String(abs.minute).padStart(2,"0")}`;
        return { ts: dt.getTime(), label };
      }
    }

    // 晚安
    if (/晚安|睡了|睡觉|就寝|去睡/.test(t)) {
      const dt = new Date();
      dt.setDate(dt.getDate() + 1);
      dt.setHours(cfg.defaultHour, cfg.defaultMinute, 0, 0);
      const label = `明天 ${String(cfg.defaultHour).padStart(2,"0")}:${String(cfg.defaultMinute).padStart(2,"0")}`;
      return { ts: dt.getTime(), label };
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════
  //  4. 提醒状态
  // ═══════════════════════════════════════════════════════════
  let currentAlarm = null;   // { ts, label, timer }
  let localTimer   = null;

  function setAlarm(ts, label) {
    clearAlarm(false);
    const delay = ts - Date.now();
    if (delay < 500) return;
    localTimer = setTimeout(onAlarmFire, delay);
    currentAlarm = { ts, label };
    updateFabState(true);
    updateAlarmBar();
    console.log(`[WUC] 提醒已设置：${label}（${Math.round(delay/60000)}分钟后）`);
  }

  function clearAlarm(showToast = true) {
    if (localTimer) { clearTimeout(localTimer); localTimer = null; }
    currentAlarm = null;
    updateFabState(false);
    updateAlarmBar();
    if (showToast) showToastr("已取消提醒", "info");
  }

  async function onAlarmFire() {
    localTimer = null;
    currentAlarm = null;
    updateFabState(false);
    updateAlarmBar();
    const text = await buildWakeMessage();
    injectSystemMessage(text);
    showToastr("⏰ " + text.slice(0, 40), "info");
    console.log("[WUC] 提醒触发:", text.slice(0, 60));
  }

  // ═══════════════════════════════════════════════════════════
  //  5. Termux 桥接
  // ═══════════════════════════════════════════════════════════
  async function bridgeSchedule(ts, label) {
    try {
      const url = `${cfg.bridgeUrl}/schedule?key=${encodeURIComponent(cfg.bridgeKey)}&ts=${ts}&text=${encodeURIComponent(label)}&alarm=${cfg.enableAlarm ? 1 : 0}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      return j.ok === true;
    } catch (e) {
      console.warn("[WUC] bridge schedule failed:", e.message);
      return false;
    }
  }

  async function bridgeCancel() {
    try {
      await fetch(`${cfg.bridgeUrl}/cancel?key=${encodeURIComponent(cfg.bridgeKey)}`, { signal: AbortSignal.timeout(3000) });
    } catch (e) {}
  }

  async function bridgePing() {
    try {
      const r = await fetch(`${cfg.bridgeUrl}/ping`, { signal: AbortSignal.timeout(3000) });
      const j = await r.json();
      return j.ok === true;
    } catch (e) { return false; }
  }

  // 缓存角色数据给 Termux 桥（用于生成早安消息）
  async function cacheCharForBridge(label) {
    try {
      const ctx = getCtx();
      if (!ctx) return;
      const char = ctx.characters?.[ctx.characterId];
      if (!char) return;

      // 最近 20 条对话历史
      const history = (ctx.chat || []).slice(-20).map(m => ({
        role: m.is_user ? "user" : "assistant",
        name: m.name,
        content: m.mes,
      }));

      const payload = {
        character: {
          name:        char.name,
          description: char.description || "",
          personality: char.personality || "",
          scenario:    char.scenario || "",
        },
        history,
        genMode:     cfg.genMode,
        customText:  cfg.genCustomText,
        worldbookContent: cfg.genWorldbookContent,
        alarmLabel:  label,
      };

      await fetch(`${cfg.bridgeUrl}/cache?key=${encodeURIComponent(cfg.bridgeKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      console.warn("[WUC] cacheChar failed:", e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  6. 构建唤醒消息（多种生成方式）
  // ═══════════════════════════════════════════════════════════
  async function buildWakeMessage() {
    const ctx = getCtx();

    // ── custom：直接用固定文本 ──
    if (cfg.genMode === "custom") {
      return cfg.genCustomText || "早安～";
    }

    const char = ctx?.characters?.[ctx?.characterId];
    const charName = char?.name || "角色";
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

    let systemPrompt = `你是 ${charName}，请用角色的口吻写一句不超过60字的晨间问候，语气自然温柔，符合角色性格，不要括号动作描述。现在时间是 ${timeStr}。`;

    if (cfg.genMode === "worldbook" && cfg.genWorldbookContent) {
      systemPrompt += `\n\n参考以下世界观背景：\n${cfg.genWorldbookContent}`;
    }

    // 构建消息数组
    const messages = [];

    // 角色设定
    const descParts = [
      char?.description  ? `角色描述：${char.description}`  : "",
      char?.personality  ? `角色性格：${char.personality}`  : "",
      char?.scenario     ? `场景设定：${char.scenario}`     : "",
    ].filter(Boolean).join("\n");
    if (descParts) messages.push({ role: "system", content: descParts });

    // 聊天历史（仅 history 模式）
    if (cfg.genMode === "history" && ctx?.chat?.length) {
      const recentChat = ctx.chat.slice(-10);
      for (const m of recentChat) {
        if (!m.is_system && m.mes) {
          messages.push({ role: m.is_user ? "user" : "assistant", content: m.mes });
        }
      }
    }

    // 生成指令
    messages.push({ role: "user", content: systemPrompt });

    // 调用酒馆当前 AI
    try {
      const top = getTop();
      // 方式 A: generateRaw（酒馆助手 API）
      if (typeof top.generateRaw === "function" || typeof generateRaw === "function") {
        const fn = top.generateRaw ?? generateRaw;
        const prompts = [];
        if (descParts) prompts.push("char_description", "char_personality");
        if (cfg.genMode === "history") prompts.push("chat_history");
        prompts.push({ role: "user", content: systemPrompt });
        const result = await fn({
          ordered_prompts: prompts,
          should_silence: true,
        });
        const text = (typeof result === "string" ? result : result?.content) || "";
        if (text.trim()) return text.trim();
      }

      // 方式 B: 酒馆原生 Generate（通过 ST context）
      if (ctx?.generate) {
        const result = await ctx.generate("quiet", { quiet_prompt: systemPrompt });
        if (result?.trim()) return result.trim();
      }

      // 方式 C: generateQuietPrompt（旧版酒馆 API）
      const gqp = top.generateQuietPrompt ?? window.generateQuietPrompt;
      if (typeof gqp === "function") {
        const result = await gqp(systemPrompt, false, false, "", true, 60);
        if (result?.trim()) return result.trim();
      }
    } catch (e) {
      console.warn("[WUC] AI generate failed:", e.message);
    }

    // 降级：返回模板消息
    const tmpl = cfg.wakeMessage || "（系统：叫醒时间到了～）";
    return tmpl.replace(/\{\{char\}\}/g, charName).replace(/\{\{time\}\}/g, timeStr);
  }

  // ═══════════════════════════════════════════════════════════
  //  7. 注入系统消息（不计入主线剧情）
  // ═══════════════════════════════════════════════════════════
  function injectSystemMessage(text) {
    try {
      const top = getTop();
      // 方式 A: sendSystemMessage (SillyTavern 1.x API)
      const ssm = top.sendSystemMessage ?? window.sendSystemMessage;
      if (typeof ssm === "function") {
        ssm("generic", text, { avatarUrl: "" });
        return;
      }
      // 方式 B: addOneMessage with is_system flag
      const ctx = getCtx();
      const aom = ctx?.addOneMessage ?? top.addOneMessage;
      if (typeof aom === "function") {
        aom({
          name:      "System",
          mes:       text,
          is_system: true,
          extra:     { wakeup: true, isSystem: true },
        });
        return;
      }
      // 方式 C: triggerSlash /sys
      const ts = top.triggerSlash ?? window.triggerSlash;
      if (typeof ts === "function") {
        ts(`/sys ${text}`);
        return;
      }
      // 方式 D: 直接操作 chat DOM（最后手段）
      const chatArea = (top.document ?? document).getElementById("chat");
      if (chatArea) {
        const div = (top.document ?? document).createElement("div");
        div.className = "mes sys-mes";
        div.style.cssText = "opacity:.7;font-size:.9em;text-align:center;padding:4px 8px;";
        div.textContent = text;
        chatArea.appendChild(div);
      }
    } catch (e) {
      console.error("[WUC] injectSystemMessage failed:", e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  8. 轮询桥接事件（检查 Termux 是否触发了到点事件）
  // ═══════════════════════════════════════════════════════════
  async function pollBridgeEvent() {
    if (!cfg.bridgeUrl) return;
    try {
      const r = await fetch(`${cfg.bridgeUrl}/event?key=${encodeURIComponent(cfg.bridgeKey)}`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return;
      const j = await r.json();
      if (j.ok && j.text) {
        // 消费事件
        await fetch(`${cfg.bridgeUrl}/event-consume?key=${encodeURIComponent(cfg.bridgeKey)}`, { signal: AbortSignal.timeout(3000) });
        injectSystemMessage(j.text || cfg.wakeMessage.replace(/\{\{char\}\}/g, "角色"));
        console.log("[WUC] bridge event consumed:", j.text?.slice(0, 60));
      }
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  //  9. 处理用户消息
  // ═══════════════════════════════════════════════════════════
  function isCharBound() {
    if (!cfg.boundCharName) return true;
    try {
      const ctx = getCtx();
      const cur = ctx?.characters?.[ctx?.characterId]?.name ?? "";
      return cur === cfg.boundCharName;
    } catch (e) { return true; }
  }

  async function handleUserMessage(data) {
    if (!isCharBound()) return;

    let text = "";
    if (typeof data === "string") {
      text = data;
    } else if (data?.mes) {
      text = data.mes;
    } else if (data?.message) {
      text = data.message;
    } else if (typeof data === "number") {
      // MESSAGE_SENT 传 message_id
      try {
        const ctx = getCtx();
        const msg = ctx?.chat?.[data];
        text = msg?.mes ?? "";
      } catch (e) {}
    }

    if (!text) return;

    const result = parseTimeCommand(text);
    if (!result) return;

    if (result.cancel) {
      clearAlarm(true);
      await bridgeCancel();
      injectSystemMessage("（系统：已取消提醒～）");
      return;
    }

    // 设置本地定时器
    setAlarm(result.ts, result.label);

    // 尝试同步到 Termux 桥
    const bridgeOk = await bridgeSchedule(result.ts, result.label);
    if (bridgeOk) {
      await cacheCharForBridge(result.label);
    }

    // 注入确认消息
    const confirmText = `（系统：已设置 ${result.label} 的提醒，晚安～${bridgeOk ? " [桥接✓]" : ""}）`;
    injectSystemMessage(confirmText);
  }

  // ═══════════════════════════════════════════════════════════
  //  10. 世界书条目列表
  // ═══════════════════════════════════════════════════════════
  function getWorldbookEntries() {
    try {
      const top = getTop();
      const ctx = getCtx();
      const entries = [];
      // 尝试不同 API
      const wiBooksMap = ctx?.world_info ?? top.world_info ?? {};
      for (const bookName in wiBooksMap) {
        const book = wiBooksMap[bookName];
        const bookEntries = book?.entries ?? book;
        if (!bookEntries) continue;
        for (const uid in bookEntries) {
          const e = bookEntries[uid];
          const label = e?.comment || (Array.isArray(e?.key) ? e.key.join(", ") : uid);
          entries.push({ uid, label, content: e?.content ?? "" });
        }
      }
      return entries;
    } catch (e) { return []; }
  }

  function getCharacterList() {
    try {
      const ctx = getCtx();
      return ctx?.characters ?? [];
    } catch (e) { return []; }
  }

  // ═══════════════════════════════════════════════════════════
  //  11. UI 工具
  // ═══════════════════════════════════════════════════════════
  function showToastr(msg, type = "info") {
    try {
      const top = getTop();
      const t = top.toastr ?? window.toastr;
      if (t?.[type]) { t[type](msg); return; }
    } catch (e) {}
  }

  function getTopDoc() {
    try { return window.top.document; } catch(e) {}
    try { return window.parent.document; } catch(e) {}
    return document;
  }

  function updateFabState(armed) {
    const fab = getTopDoc().getElementById("wuc-fab");
    if (!fab) return;
    fab.classList.toggle("wuc-armed", !!armed);
  }

  function updateAlarmBar() {
    const bar = getTopDoc().getElementById("wuc-alarm-bar");
    if (!bar) return;
    if (currentAlarm) {
      bar.classList.add("wuc-visible");
      bar.querySelector(".wuc-alarm-text").textContent =
        `⏰ 已设置提醒：${currentAlarm.label}`;
    } else {
      bar.classList.remove("wuc-visible");
    }
  }

  function setStatus(msg, isErr = false) {
    const el = getTopDoc().getElementById("wuc-status");
    if (!el) return;
    el.textContent = msg;
    el.className = "wuc-status" + (isErr ? " wuc-err" : "");
  }

  // ═══════════════════════════════════════════════════════════
  //  12. 悬浮球（FAB）
  // ═══════════════════════════════════════════════════════════
  const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs>
      <radialGradient id="wucg" cx="40%" cy="35%">
        <stop offset="0%"   stop-color="#b8dfc6"/>
        <stop offset="100%" stop-color="#6aab82"/>
      </radialGradient>
    </defs>
    <rect width="100" height="100" rx="24" fill="url(#wucg)"/>
    <text x="50" y="71" font-family="Arial Black,Arial,sans-serif" font-size="58"
          font-weight="900" fill="white" text-anchor="middle"
          style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.3))">N</text>
  </svg>`;
  const ICON_URL = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(ICON_SVG);

  function mountFab() {
    const _td = (function(){ try{return window.top.document;}catch(e){} try{return window.parent.document;}catch(e){} return document; })();
    if (_td.getElementById("wuc-fab")) return;
    const fab = document.createElement("div");
    fab.id = "wuc-fab";
    const img = document.createElement("img");
    img.src = ICON_URL;
    img.alt = "Wake-Up Call";
    fab.appendChild(img);

    // 恢复位置
    if (cfg.fabLeft !== null) {
      fab.style.left   = cfg.fabLeft + "px";
      fab.style.right  = "auto";
      fab.style.bottom = (cfg.fabBottom ?? 130) + "px";
    }

    // 拖拽逻辑
    let dragging = false, moved = false, startX = 0, startY = 0;
    let origLeft = 0, origTop = 0;

    fab.addEventListener("pointerdown", e => {
      dragging = true; moved = false;
      fab.setPointerCapture(e.pointerId);
      const rect = fab.getBoundingClientRect();
      origLeft = rect.left; origTop = rect.top;
      startX = e.clientX; startY = e.clientY;
      fab.style.right = "auto"; fab.style.bottom = "auto";
      fab.style.left = origLeft + "px"; fab.style.top = origTop + "px";
      e.preventDefault();
    }, { passive: false });

    fab.addEventListener("pointermove", e => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) moved = true;
      if (moved) {
        fab.style.left = (origLeft + dx) + "px";
        fab.style.top  = (origTop  + dy) + "px";
      }
    });

    fab.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        // 点击 → 开面板
        openPanel();
      } else {
        // 保存位置
        cfg.fabLeft   = parseFloat(fab.style.left);
        cfg.fabBottom = window.innerHeight - parseFloat(fab.style.top) - 52;
        saveCfg();
      }
    });

    // 挂到 top-level document，穿透 iframe
    const targetDoc = (function(){
      try { return window.top.document; } catch(e) {}
      try { return window.parent.document; } catch(e) {}
      return document;
    })();
    targetDoc.body.appendChild(fab);
    if (currentAlarm) fab.classList.add("wuc-armed");
  }

  // ═══════════════════════════════════════════════════════════
  //  13. 主控制面板
  // ═══════════════════════════════════════════════════════════
  function openPanel() {
    const _td2 = (function(){ try{return window.top.document;}catch(e){} try{return window.parent.document;}catch(e){} return document; })();
    if (_td2.getElementById("wuc-overlay")) return;
    loadCfg();

    const chars = getCharacterList();
    const wbEntries = getWorldbookEntries();

    const overlay = document.createElement("div");
    overlay.id = "wuc-overlay";

    overlay.innerHTML = `
      <div id="wuc-panel">

        <!-- 头部 -->
        <div class="wuc-header">
          <img class="wuc-header-icon" src="${ICON_URL}" alt="">
          <div>
            <h2>Wake-Up Call</h2>
            <div class="wuc-header-sub">提醒管理 · 叫醒设置</div>
          </div>
          <div class="wuc-close-btn" id="wuc-close">✕</div>
        </div>

        <div class="wuc-body">

          <!-- 当前提醒状态条 -->
          <div class="wuc-alarm-bar ${currentAlarm ? "wuc-visible" : ""}" id="wuc-alarm-bar">
            <span class="wuc-alarm-text">${currentAlarm ? `⏰ 已设置提醒：${currentAlarm.label}` : ""}</span>
            <button class="wuc-btn wuc-btn-danger" id="wuc-cancel-alarm" style="flex:0;padding:4px 10px;font-size:12px;">取消</button>
          </div>

          <!-- 快捷按钮 -->
          <div class="wuc-quick-grid">
            <button class="wuc-quick-btn" data-min="15">⏱ 15分钟后</button>
            <button class="wuc-quick-btn" data-min="30">⏱ 30分钟后</button>
            <button class="wuc-quick-btn" data-min="60">⏱ 1小时后</button>
            <button class="wuc-quick-btn" data-tomorrow="1">🌅 明早 ${String(cfg.defaultHour).padStart(2,"0")}:${String(cfg.defaultMinute).padStart(2,"0")}</button>
          </div>

          <!-- 自定义时间 -->
          <div class="wuc-time-row">
            <input type="time" id="wuc-custom-time" value="${String(cfg.defaultHour).padStart(2,"0")}:${String(cfg.defaultMinute).padStart(2,"0")}">
            <button class="wuc-set-btn" id="wuc-set-time">设置</button>
          </div>

          <!-- ─── 唤醒设置 ─── -->
          <div class="wuc-sep">唤醒设置</div>

          <!-- 默认唤醒时间 -->
          <div class="wuc-row">
            <label class="wuc-label">说「晚安」时的默认唤醒时间</label>
            <input type="time" id="wuc-default-time" class="wuc-input"
              value="${String(cfg.defaultHour).padStart(2,"0")}:${String(cfg.defaultMinute).padStart(2,"0")}">
          </div>

          <!-- 系统闹钟开关 -->
          <div class="wuc-switch-row">
            <span class="wuc-switch-lbl">同时触发手机系统闹钟（需 Termux 桥）</span>
            <label class="wuc-switch">
              <input type="checkbox" id="wuc-alarm-sw" ${cfg.enableAlarm ? "checked" : ""}>
              <span class="wuc-slider"></span>
            </label>
          </div>

          <!-- ─── 角色绑定 ─── -->
          <div class="wuc-sep">角色绑定</div>

          <div class="wuc-row">
            <label class="wuc-label">仅在此角色对话中触发（留空 = 全局）</label>
            <select id="wuc-bound-char" class="wuc-select">
              <option value="">— 全局触发 —</option>
              ${chars.map(c =>
                `<option value="${c.name}" ${cfg.boundCharName === c.name ? "selected" : ""}>${c.name}</option>`
              ).join("")}
            </select>
          </div>

          <!-- ─── 唤醒消息生成 ─── -->
          <div class="wuc-sep">唤醒消息生成方式</div>

          <div class="wuc-row">
            <label class="wuc-label">生成方式</label>
            <select id="wuc-gen-mode" class="wuc-select">
              <option value="history"   ${cfg.genMode==="history"   ? "selected":""}>角色设定 + 最近聊天记录</option>
              <option value="descOnly"  ${cfg.genMode==="descOnly"  ? "selected":""}>仅角色描述（不读取聊天记录）</option>
              <option value="worldbook" ${cfg.genMode==="worldbook" ? "selected":""}>根据绑定的世界书条目生成</option>
              <option value="custom"    ${cfg.genMode==="custom"    ? "selected":""}>自定义固定回复（不调用 AI）</option>
            </select>
          </div>

          <!-- 世界书条目选择（仅 worldbook 模式） -->
          <div class="wuc-cond ${cfg.genMode==="worldbook" ? "wuc-visible" : ""}" id="wuc-wb-row">
            <div class="wuc-row">
              <label class="wuc-label">选择世界书条目</label>
              <select id="wuc-wb-entry" class="wuc-select">
                <option value="">— 选择条目 —</option>
                ${wbEntries.map(e =>
                  `<option value="${e.uid}" data-content="${e.content.replace(/"/g,'&quot;')}"
                   ${cfg.genWorldbookUid === e.uid ? "selected" : ""}>${e.label}</option>`
                ).join("")}
              </select>
            </div>
          </div>

          <!-- 自定义文本（仅 custom 模式） -->
          <div class="wuc-cond ${cfg.genMode==="custom" ? "wuc-visible" : ""}" id="wuc-custom-row">
            <div class="wuc-row">
              <label class="wuc-label">自定义唤醒回复内容</label>
              <textarea id="wuc-custom-text" class="wuc-textarea" rows="3">${cfg.genCustomText}</textarea>
            </div>
          </div>

          <!-- 注入消息模板 -->
          <div class="wuc-row">
            <label class="wuc-label">注入到聊天的系统消息模板（不计入主线）</label>
            <textarea id="wuc-wake-msg" class="wuc-textarea" rows="2">${cfg.wakeMessage}</textarea>
          </div>

          <!-- ─── Termux 桥接 ─── -->
          <div class="wuc-sep">Termux 桥接</div>

          <div class="wuc-row">
            <label class="wuc-label">桥接服务地址</label>
            <input type="text" id="wuc-bridge-url" class="wuc-input"
              value="${cfg.bridgeUrl}" placeholder="http://127.0.0.1:8765">
          </div>
          <div class="wuc-row">
            <label class="wuc-label">桥接密钥</label>
            <input type="text" id="wuc-bridge-key" class="wuc-input"
              value="${cfg.bridgeKey}" placeholder="wake-2026">
          </div>

          <!-- 状态 -->
          <div class="wuc-status" id="wuc-status"></div>

          <!-- 底部按钮 -->
          <div class="wuc-footer">
            <button class="wuc-btn wuc-btn-secondary" id="wuc-test-bridge">测试桥接</button>
            <button class="wuc-btn wuc-btn-primary"   id="wuc-save">保存设置</button>
          </div>

        </div><!-- .wuc-body -->
      </div><!-- #wuc-panel -->
    `;

    // overlay 也挂到 top document，和 fab 同层
    const _targetDoc = (function(){
      try { return window.top.document; } catch(e) {}
      try { return window.parent.document; } catch(e) {}
      return document;
    })();
    _targetDoc.body.appendChild(overlay);

    // ── 绑定事件 ──

    // 关闭
    const close = () => overlay.remove();
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    overlay.querySelector("#wuc-close").addEventListener("click", close);

    // 取消提醒
    overlay.querySelector("#wuc-cancel-alarm")?.addEventListener("click", () => {
      clearAlarm(true);
      bridgeCancel();
      overlay.remove();
    });

    // 快捷按钮
    overlay.querySelectorAll(".wuc-quick-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const min = btn.dataset.min;
        const tomorrow = btn.dataset.tomorrow;
        let ts, label;
        if (min) {
          const m = parseInt(min, 10);
          ts = Date.now() + m * 60_000;
          label = `${m}分钟后`;
        } else {
          const dt = new Date();
          dt.setDate(dt.getDate() + 1);
          dt.setHours(cfg.defaultHour, cfg.defaultMinute, 0, 0);
          ts = dt.getTime();
          label = `明天 ${String(cfg.defaultHour).padStart(2,"0")}:${String(cfg.defaultMinute).padStart(2,"0")}`;
        }
        setAlarm(ts, label);
        bridgeSchedule(ts, label).then(ok => {
          if (ok) cacheCharForBridge(label);
        });
        injectSystemMessage(`（系统：已设置 ${label} 的提醒～）`);
        setStatus(`✓ 已设置 ${label}`);
        setTimeout(close, 900);
      });
    });

    // 自定义时间
    overlay.querySelector("#wuc-set-time").addEventListener("click", () => {
      const v = overlay.querySelector("#wuc-custom-time").value;
      if (!v) return;
      const [h, m] = v.split(":").map(Number);
      let dt = new Date();
      dt.setHours(h, m, 0, 0);
      if (dt.getTime() <= Date.now()) dt = new Date(dt.getTime() + 86_400_000);
      const label = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
      setAlarm(dt.getTime(), label);
      bridgeSchedule(dt.getTime(), label).then(ok => {
        if (ok) cacheCharForBridge(label);
      });
      injectSystemMessage(`（系统：已设置 ${label} 的提醒～）`);
      setStatus(`✓ 已设置 ${label}`);
      setTimeout(close, 900);
    });

    // genMode 联动显示
    const genSel = overlay.querySelector("#wuc-gen-mode");
    const wbRow  = overlay.querySelector("#wuc-wb-row");
    const cusRow = overlay.querySelector("#wuc-custom-row");
    genSel.addEventListener("change", () => {
      wbRow.classList.toggle("wuc-visible",  genSel.value === "worldbook");
      cusRow.classList.toggle("wuc-visible", genSel.value === "custom");
    });

    // 世界书条目选择 → 缓存内容
    overlay.querySelector("#wuc-wb-entry")?.addEventListener("change", e => {
      const opt = e.target.options[e.target.selectedIndex];
      cfg.genWorldbookUid     = opt.value;
      cfg.genWorldbookContent = opt.dataset.content || "";
    });

    // 测试桥接
    overlay.querySelector("#wuc-test-bridge").addEventListener("click", async () => {
      setStatus("测试中…");
      const url = overlay.querySelector("#wuc-bridge-url").value;
      const key = overlay.querySelector("#wuc-bridge-key").value;
      const oldUrl = cfg.bridgeUrl, oldKey = cfg.bridgeKey;
      cfg.bridgeUrl = url; cfg.bridgeKey = key;
      const ok = await bridgePing();
      cfg.bridgeUrl = oldUrl; cfg.bridgeKey = oldKey;
      setStatus(ok ? "✓ 桥接连通！" : "✗ 无法连接桥接服务", !ok);
    });

    // 保存
    overlay.querySelector("#wuc-save").addEventListener("click", () => {
      const dtVal = overlay.querySelector("#wuc-default-time").value;
      if (dtVal) {
        const [h, m] = dtVal.split(":").map(Number);
        cfg.defaultHour   = h;
        cfg.defaultMinute = m;
      }
      cfg.enableAlarm         = overlay.querySelector("#wuc-alarm-sw").checked;
      cfg.boundCharName       = overlay.querySelector("#wuc-bound-char").value;
      cfg.genMode             = overlay.querySelector("#wuc-gen-mode").value;
      cfg.genCustomText       = overlay.querySelector("#wuc-custom-text").value;
      cfg.genWorldbookUid     = overlay.querySelector("#wuc-wb-entry").value;
      const _wbEl = overlay.querySelector("#wuc-wb-entry");
      if (_wbEl) {
        cfg.genWorldbookUid     = _wbEl.value;
        cfg.genWorldbookContent = _wbEl.options[_wbEl.selectedIndex]?.dataset.content || cfg.genWorldbookContent;
      }
      cfg.wakeMessage         = overlay.querySelector("#wuc-wake-msg").value;
      cfg.bridgeUrl           = overlay.querySelector("#wuc-bridge-url").value;
      cfg.bridgeKey           = overlay.querySelector("#wuc-bridge-key").value;
      saveCfg();
      setStatus("✓ 已保存");
      setTimeout(close, 800);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  14. 顶栏按钮（可选入口）
  // ═══════════════════════════════════════════════════════════
  function mountTopbarBtn() {
    const toolbar = document.getElementById("extensionsMenuButton")?.parentElement
      ?? document.querySelector("#top-bar .right-items")
      ?? document.querySelector("#top-settings-holder");
    if (!toolbar || document.getElementById("wuc-topbar-btn")) return;
    const btn = document.createElement("div");
    btn.id = "wuc-topbar-btn";
    btn.title = "Wake-Up Call";
    btn.innerHTML = `<img src="${ICON_URL}" style="width:22px;height:22px;border-radius:6px;vertical-align:middle;">`;
    btn.addEventListener("click", openPanel);
    toolbar.appendChild(btn);
  }

  // ═══════════════════════════════════════════════════════════
  //  15. 酒馆原生设置面板（HTML 模板 / settings.html 内容）
  // ═══════════════════════════════════════════════════════════
  function buildSettingsHTML() {
    // 酒馆会把扩展的 settings.html 嵌入侧边栏，这里动态渲染
    // 仅做简单状态显示（完整设置在悬浮面板里）
    return `
      <div class="wuc-st-settings">
        <p style="color:rgba(255,255,255,.5);font-size:12px;margin:0 0 8px;">
          完整设置请点击页面右下角的绿色 <b>N</b> 图标（悬浮球），或顶栏图标。
        </p>
        <div id="wuc-st-status" style="font-size:12px;color:#91C4A2;"></div>
        <button id="wuc-st-open" style="
          margin-top:8px;padding:6px 14px;border-radius:8px;border:none;
          background:#91C4A2;color:#1a2a20;font-size:13px;font-weight:600;cursor:pointer;">
          打开设置面板
        </button>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════
  //  16. 初始化
  // ═══════════════════════════════════════════════════════════
  function init() {
    loadCfg();
    mountFab();
    mountTopbarBtn();

    // 监听用户消息事件
    const evSrc   = getEventSource();
    const evTypes = getEventTypes();
    if (evSrc?.on) {
      const evName = evTypes.MESSAGE_SENT ?? "MESSAGE_SENT";
      evSrc.on(evName, handleUserMessage);
      console.log("[WUC] 监听事件:", evName);
    } else {
      console.warn("[WUC] eventSource 不可用，尝试 MutationObserver 降级");
      // 降级：监听聊天区 DOM 新增消息
      const top = getTop();
      const chatEl = (top.document ?? document).getElementById("chat");
      if (chatEl) {
        new MutationObserver(muts => {
          for (const mu of muts) {
            for (const node of mu.addedNodes) {
              if (node.nodeType !== 1) continue;
              if (!node.classList.contains("is_user")) continue;
              const text = node.querySelector(".mes_text")?.textContent?.trim() ?? "";
              if (text) handleUserMessage(text);
            }
          }
        }).observe(chatEl, { childList: true });
        console.log("[WUC] 使用 MutationObserver 监听");
      }
    }

    // 启动轮询（Termux 桥事件 + 悬浮球挂载重试）
    setInterval(pollBridgeEvent, 60_000);
    setInterval(() => {
      if (!getTopDoc().getElementById("wuc-fab")) mountFab();
    }, 5_000);

    // 侧边栏设置面板入口（酒馆扩展标准接口）
    try {
      const top = getTop();
      const stContainer = (top.document ?? document).querySelector(
        `#extensions_settings [data-extension="wake-up-call"] .extension_settings`
      );
      if (stContainer) {
        stContainer.innerHTML = buildSettingsHTML();
        stContainer.querySelector("#wuc-st-open")?.addEventListener("click", openPanel);
      }
    } catch (e) {}

    console.log("[WUC] Wake-Up Call v3.1 已就绪");
    console.log("[WUC] 支持：晚安 / 明天X点 / X分钟后提醒 / 取消提醒");
  }

  // ── 等待 DOM 就绪后启动 ──
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  // 已移除重复 init 调用（原 SPA 重试，会导致事件重复注册）
  setTimeout(() => {
    if (!getTopDoc().getElementById("wuc-fab")) mountFab();
  }, 3000);

})();
