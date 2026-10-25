// ============================================================
//  Wake-Up Call v4.0 — SillyTavern 独立扩展
//  面板直接注入酒馆侧边栏，无悬浮球 overlay 问题
//  作者：luobo1002
// ============================================================

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════
  //  1. 兼容层
  // ═══════════════════════════════════════════════════════════
  function getTop() {
    try { return (window.parent !== window ? window.parent : window); } catch (e) { return window; }
  }
  function getCtx() {
    const top = getTop();
    try { if (top.SillyTavern?.getContext) return top.SillyTavern.getContext(); } catch (e) {}
    try { if (typeof getContext === "function") return getContext(); } catch (e) {}
    return null;
  }
  function getEventSource() {
    const ctx = getCtx(); const top = getTop();
    return ctx?.eventSource ?? top.eventSource ?? window.eventSource ?? null;
  }
  function getEventTypes() {
    const ctx = getCtx(); const top = getTop();
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
  function showToastr(msg, type = "info") {
    try { const t = getTop().toastr ?? window.toastr; if (t?.[type]) t[type](msg); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  //  2. 设置管理
  // ═══════════════════════════════════════════════════════════
  const DEFAULTS = {
    bridgeUrl: "http://127.0.0.1:8765",
    bridgeKey: "wake-2026",
    defaultHour: 7,
    defaultMinute: 30,
    enableAlarm: true,
    boundCharName: "",
    genMode: "history",
    genCustomText: "早安～新的一天开始了！",
    genWorldbookUid: "",
    genWorldbookContent: "",
    wakeMessage: "（系统：叫醒时间到了，{{char}} 的提醒已触发～）",
  };
  let cfg = { ...DEFAULTS };

  function loadCfg() {
    const ext = getExtSettings();
    cfg = ext.wakeUpCall ? { ...DEFAULTS, ...ext.wakeUpCall } : { ...DEFAULTS };
  }
  function saveCfg() {
    const ext = getExtSettings();
    ext.wakeUpCall = { ...cfg };
    doSaveSettings();
  }

  // ═══════════════════════════════════════════════════════════
  //  3. 时间解析
  // ═══════════════════════════════════════════════════════════
  const CN = { 零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9 };
  function parseCN(s) {
    if (!s) return NaN;
    s = String(s).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    let total = 0, cur = 0;
    for (const ch of s) {
      const v = CN[ch];
      if (v === undefined) { if (ch === "十") { cur = (cur || 1) * 10; continue; } return NaN; }
      total += cur; cur = v;
    }
    return total + cur;
  }
  function parseRelative(text) {
    const t = text.replace(/\s+/g, "");
    if (/半小时/.test(t)) return 30;
    if (/一刻钟?/.test(t)) return 15;
    let m = t.match(/([0-9零一二两三四五六七八九十百]+)\s*分钟?后/);
    if (m) { const n = parseCN(m[1]); if (!isNaN(n) && n > 0) return n; }
    m = t.match(/([0-9零一二两三四五六七八九十]+)\s*(?:个)?(?:小时|钟头)后/);
    if (m) { const n = parseCN(m[1]); if (!isNaN(n) && n > 0) return n * 60; }
    return null;
  }
  function parseAbsolute(text) {
    const t = text.replace(/\s+/g, "");
    let dayOffset = 0;
    if (/明天|明早|明晚/.test(t)) dayOffset = 1;
    else if (/后天/.test(t)) dayOffset = 2;
    let period = null;
    if (/晚上|晚间|夜里|深夜/.test(t)) period = "night";
    else if (/下午|傍晚/.test(t)) period = "pm";
    else if (/早上|早晨|清晨|上午/.test(t)) period = "am";
    const re = /([0-9零一二两三四五六七八九十]+)(?::(\d{1,2})|[点时]([0-9零一二两三四五六七八九十]+)分?|[点时](半)?)/;
    const m = t.match(re);
    if (!m) return null;
    let hour = parseCN(m[1]), minute = 0;
    if (m[2] !== undefined)      minute = parseInt(m[2], 10);
    else if (m[3] !== undefined) minute = parseCN(m[3]);
    else if (m[4])               minute = 30;
    if (isNaN(hour) || isNaN(minute)) return null;
    if (period === "night" && hour < 12) hour += 12;
    if (period === "pm"    && hour < 8 && hour < 12) hour += 12;
    if (period === "am"    && hour === 12) hour = 0;
    return { hour, minute, dayOffset };
  }
  function parseTimeCommand(text) {
    const t = String(text || "").replace(/[。！？，、\s]/g, "");
    if (/取消(提醒|闹钟|叫醒|定时)/.test(t)) return { cancel: true };
    if (/提醒|叫醒?我|叫我/.test(t)) {
      const mins = parseRelative(t);
      if (mins !== null) return { ts: Date.now() + mins * 60_000, label: `${mins}分钟后` };
    }
    if (/叫醒?我?|叫我|提醒我?|起床|明天|明早|后天/.test(t)) {
      const abs = parseAbsolute(t);
      if (abs) {
        const now = new Date();
        let dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + abs.dayOffset, abs.hour, abs.minute, 0, 0);
        if (dt.getTime() <= Date.now()) dt = new Date(dt.getTime() + 86_400_000);
        const label = `${dt.getMonth()+1}/${dt.getDate()} ${String(abs.hour).padStart(2,"0")}:${String(abs.minute).padStart(2,"0")}`;
        return { ts: dt.getTime(), label };
      }
    }
    if (/晚安|睡了|睡觉|就寝|去睡/.test(t)) {
      const dt = new Date();
      dt.setDate(dt.getDate() + 1);
      dt.setHours(cfg.defaultHour, cfg.defaultMinute, 0, 0);
      return { ts: dt.getTime(), label: `明天 ${String(cfg.defaultHour).padStart(2,"0")}:${String(cfg.defaultMinute).padStart(2,"0")}` };
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  //  4. 提醒状态
  // ═══════════════════════════════════════════════════════════
  let currentAlarm = null;
  let localTimer   = null;

  function setAlarm(ts, label) {
    clearAlarm(false);
    const delay = ts - Date.now();
    if (delay < 500) return;
    localTimer = setTimeout(onAlarmFire, delay);
    currentAlarm = { ts, label };
    refreshPanelStatus();
    console.log(`[WUC] 提醒已设置：${label}`);
  }
  function clearAlarm(showToast = true) {
    if (localTimer) { clearTimeout(localTimer); localTimer = null; }
    currentAlarm = null;
    refreshPanelStatus();
    if (showToast) showToastr("已取消提醒", "info");
  }
  async function onAlarmFire() {
    localTimer = null; currentAlarm = null;
    refreshPanelStatus();
    const text = await buildWakeMessage();
    injectSystemMessage(text);
    showToastr("⏰ " + text.slice(0, 40), "info");
  }

  // ═══════════════════════════════════════════════════════════
  //  5. Termux 桥接
  // ═══════════════════════════════════════════════════════════
  async function bridgeSchedule(ts, label) {
    try {
      const r = await fetch(`${cfg.bridgeUrl}/schedule?key=${encodeURIComponent(cfg.bridgeKey)}&ts=${ts}&text=${encodeURIComponent(label)}&alarm=${cfg.enableAlarm?1:0}`, { signal: AbortSignal.timeout(4000) });
      return (await r.json()).ok === true;
    } catch (e) { return false; }
  }
  async function bridgeCancel() {
    try { await fetch(`${cfg.bridgeUrl}/cancel?key=${encodeURIComponent(cfg.bridgeKey)}`, { signal: AbortSignal.timeout(3000) }); } catch (e) {}
  }
  async function bridgePing() {
    try { return (await (await fetch(`${cfg.bridgeUrl}/ping`, { signal: AbortSignal.timeout(3000) })).json()).ok === true; } catch (e) { return false; }
  }
  async function pollBridgeEvent() {
    try {
      const r = await fetch(`${cfg.bridgeUrl}/event?key=${encodeURIComponent(cfg.bridgeKey)}`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return;
      const j = await r.json();
      if (j.ok && j.text) {
        await fetch(`${cfg.bridgeUrl}/event-consume?key=${encodeURIComponent(cfg.bridgeKey)}`, { signal: AbortSignal.timeout(3000) });
        injectSystemMessage(j.text);
      }
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  //  6. 构建唤醒消息
  // ═══════════════════════════════════════════════════════════
  async function buildWakeMessage() {
    const ctx = getCtx();
    if (cfg.genMode === "custom") return cfg.genCustomText || "早安～";
    const char = ctx?.characters?.[ctx?.characterId];
    const charName = char?.name || "角色";
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    let systemPrompt = `你是 ${charName}，请用角色口吻写一句不超过60字的晨间问候，语气自然温柔，不要括号动作描述。现在时间是 ${timeStr}。`;
    if (cfg.genMode === "worldbook" && cfg.genWorldbookContent)
      systemPrompt += `\n\n参考世界观背景：\n${cfg.genWorldbookContent}`;
    try {
      const top = getTop();
      const gqp = top.generateQuietPrompt ?? window.generateQuietPrompt;
      if (typeof gqp === "function") {
        const result = await gqp(systemPrompt, false, false, "", true, 60);
        if (result?.trim()) return result.trim();
      }
      if (ctx?.generate) {
        const result = await ctx.generate("quiet", { quiet_prompt: systemPrompt });
        if (result?.trim()) return result.trim();
      }
    } catch (e) { console.warn("[WUC] AI generate failed:", e.message); }
    const tmpl = cfg.wakeMessage || "（系统：叫醒时间到了～）";
    return tmpl.replace(/\{\{char\}\}/g, charName).replace(/\{\{time\}\}/g, timeStr);
  }

  // ═══════════════════════════════════════════════════════════
  //  7. 注入系统消息
  // ═══════════════════════════════════════════════════════════
  function injectSystemMessage(text) {
    try {
      const top = getTop();
      const ssm = top.sendSystemMessage ?? window.sendSystemMessage;
      if (typeof ssm === "function") { ssm("generic", text, {}); return; }
      const ctx = getCtx();
      const aom = ctx?.addOneMessage ?? top.addOneMessage;
      if (typeof aom === "function") { aom({ name:"System", mes:text, is_system:true, extra:{wakeup:true} }); return; }
      const ts = top.triggerSlash ?? window.triggerSlash;
      if (typeof ts === "function") { ts(`/sys ${text}`); return; }
    } catch (e) { console.error("[WUC] injectSystemMessage failed:", e); }
  }

  // ═══════════════════════════════════════════════════════════
  //  8. 处理用户消息
  // ═══════════════════════════════════════════════════════════
  function isCharBound() {
    if (!cfg.boundCharName) return true;
    try { return (getCtx()?.characters?.[getCtx()?.characterId]?.name ?? "") === cfg.boundCharName; } catch (e) { return true; }
  }
  async function handleUserMessage(data) {
    if (!isCharBound()) return;
    let text = "";
    if (typeof data === "string") text = data;
    else if (data?.mes) text = data.mes;
    else if (typeof data === "number") { try { text = getCtx()?.chat?.[data]?.mes ?? ""; } catch (e) {} }
    if (!text) return;
    const result = parseTimeCommand(text);
    if (!result) return;
    if (result.cancel) {
      clearAlarm(true); await bridgeCancel();
      injectSystemMessage("（系统：已取消提醒～）"); return;
    }
    setAlarm(result.ts, result.label);
    const bridgeOk = await bridgeSchedule(result.ts, result.label);
    injectSystemMessage(`（系统：已设置 ${result.label} 的提醒，晚安～${bridgeOk?" [桥接✓]":""}）`);
  }

  // ═══════════════════════════════════════════════════════════
  //  9. 世界书 / 角色列表
  // ═══════════════════════════════════════════════════════════
  function getWorldbookEntries() {
    try {
      const ctx = getCtx(); const top = getTop();
      const entries = [];
      const wiBooksMap = ctx?.world_info ?? top.world_info ?? {};
      for (const bookName in wiBooksMap) {
        const bookEntries = wiBooksMap[bookName]?.entries ?? wiBooksMap[bookName];
        if (!bookEntries) continue;
        for (const uid in bookEntries) {
          const e = bookEntries[uid];
          entries.push({ uid, label: e?.comment || (Array.isArray(e?.key) ? e.key.join(", ") : uid), content: e?.content ?? "" });
        }
      }
      return entries;
    } catch (e) { return []; }
  }
  function getCharacterList() {
    try { return getCtx()?.characters ?? []; } catch (e) { return []; }
  }

  // ═══════════════════════════════════════════════════════════
  //  10. 侧边栏面板 —— 直接嵌入酒馆扩展设置区域
  // ═══════════════════════════════════════════════════════════
  function pad(n) { return String(n).padStart(2, "0"); }

  function buildPanelHTML() {
    const chars = getCharacterList();
    const wbEntries = getWorldbookEntries();
    const alarmActive = !!currentAlarm;
    return `
      <div id="wuc-panel-inner">

        <!-- 当前提醒状态 -->
        <div class="wuc-status-bar ${alarmActive ? "wuc-armed" : ""}">
          <span id="wuc-status-text">${alarmActive ? `⏰ 已设置提醒：${currentAlarm.label}` : "💤 暂无提醒"}</span>
          <button id="wuc-cancel-alarm" class="wuc-btn-cancel" ${alarmActive ? "" : "disabled"}>取消</button>
        </div>

        <!-- 快捷设置 -->
        <div class="wuc-section-title">快速设置</div>
        <div class="wuc-quick-grid">
          <button class="wuc-q" data-min="15">15分钟后</button>
          <button class="wuc-q" data-min="30">30分钟后</button>
          <button class="wuc-q" data-min="60">1小时后</button>
          <button class="wuc-q" data-tomorrow="1">明早 ${pad(cfg.defaultHour)}:${pad(cfg.defaultMinute)}</button>
        </div>

        <!-- 自定义时间 -->
        <div class="wuc-row">
          <input type="time" id="wuc-time-pick" value="${pad(cfg.defaultHour)}:${pad(cfg.defaultMinute)}">
          <button id="wuc-set-time" class="wuc-btn-primary">设定</button>
        </div>

        <!-- 唤醒设置 -->
        <div class="wuc-section-title">唤醒设置</div>

        <label class="wuc-lbl">说「晚安」时的默认唤醒时间</label>
        <input type="time" id="wuc-default-time" class="wuc-inp" value="${pad(cfg.defaultHour)}:${pad(cfg.defaultMinute)}">

        <div class="wuc-switch-row">
          <span>同时触发手机系统闹钟（需 Termux 桥）</span>
          <label class="wuc-sw"><input type="checkbox" id="wuc-alarm-sw" ${cfg.enableAlarm?"checked":""}><span class="wuc-sl"></span></label>
        </div>

        <!-- 角色绑定 -->
        <div class="wuc-section-title">角色绑定</div>
        <label class="wuc-lbl">仅对此角色触发（留空=全局）</label>
        <select id="wuc-bound-char" class="wuc-sel">
          <option value="">— 全局触发 —</option>
          ${chars.map(c=>`<option value="${c.name}" ${cfg.boundCharName===c.name?"selected":""}>${c.name}</option>`).join("")}
        </select>

        <!-- 消息生成 -->
        <div class="wuc-section-title">唤醒消息生成</div>
        <label class="wuc-lbl">生成方式</label>
        <select id="wuc-gen-mode" class="wuc-sel">
          <option value="history"   ${cfg.genMode==="history"  ?"selected":""}>角色设定 + 聊天记录</option>
          <option value="descOnly"  ${cfg.genMode==="descOnly" ?"selected":""}>仅角色描述</option>
          <option value="worldbook" ${cfg.genMode==="worldbook"?"selected":""}>世界书条目</option>
          <option value="custom"    ${cfg.genMode==="custom"   ?"selected":""}>自定义固定回复</option>
        </select>

        <div id="wuc-wb-row" style="display:${cfg.genMode==="worldbook"?"block":"none"}">
          <label class="wuc-lbl">选择世界书条目</label>
          <select id="wuc-wb-entry" class="wuc-sel">
            <option value="">— 选择条目 —</option>
            ${wbEntries.map(e=>`<option value="${e.uid}" data-content="${e.content.replace(/"/g,"&quot;")}" ${cfg.genWorldbookUid===e.uid?"selected":""}>${e.label}</option>`).join("")}
          </select>
        </div>

        <div id="wuc-custom-row" style="display:${cfg.genMode==="custom"?"block":"none"}">
          <label class="wuc-lbl">自定义唤醒回复</label>
          <textarea id="wuc-custom-text" class="wuc-ta" rows="3">${cfg.genCustomText}</textarea>
        </div>

        <label class="wuc-lbl">注入聊天的系统消息模板</label>
        <textarea id="wuc-wake-msg" class="wuc-ta" rows="2">${cfg.wakeMessage}</textarea>

        <!-- Termux 桥接 -->
        <div class="wuc-section-title">Termux 桥接</div>
        <label class="wuc-lbl">服务地址</label>
        <input type="text" id="wuc-bridge-url" class="wuc-inp" value="${cfg.bridgeUrl}">
        <label class="wuc-lbl">密钥</label>
        <input type="text" id="wuc-bridge-key" class="wuc-inp" value="${cfg.bridgeKey}">

        <div id="wuc-msg" class="wuc-msg"></div>

        <div class="wuc-footer">
          <button id="wuc-test-bridge" class="wuc-btn-sec">测试桥接</button>
          <button id="wuc-save" class="wuc-btn-primary">保存设置</button>
        </div>

      </div>
    `;
  }

  // 刷新状态条（不重建整个面板）
  function refreshPanelStatus() {
    const statusText = document.getElementById("wuc-status-text");
    const cancelBtn  = document.getElementById("wuc-cancel-alarm");
    const bar        = document.querySelector(".wuc-status-bar");
    if (!statusText) return;
    if (currentAlarm) {
      statusText.textContent = `⏰ 已设置提醒：${currentAlarm.label}`;
      bar?.classList.add("wuc-armed");
      if (cancelBtn) cancelBtn.disabled = false;
    } else {
      statusText.textContent = "💤 暂无提醒";
      bar?.classList.remove("wuc-armed");
      if (cancelBtn) cancelBtn.disabled = true;
    }
  }

  function setMsg(text, isErr = false) {
    const el = document.getElementById("wuc-msg");
    if (!el) return;
    el.textContent = text;
    el.className = "wuc-msg" + (isErr ? " wuc-err" : " wuc-ok");
    setTimeout(() => { el.textContent = ""; el.className = "wuc-msg"; }, 3000);
  }

  // 把面板绑定进酒馆扩展设置容器
  function mountPanel(container) {
    loadCfg();
    container.innerHTML = buildPanelHTML();
    bindPanelEvents(container);
  }

  function bindPanelEvents(container) {
    // 取消提醒
    container.querySelector("#wuc-cancel-alarm")?.addEventListener("click", () => {
      clearAlarm(true); bridgeCancel();
      injectSystemMessage("（系统：已取消提醒～）");
    });

    // 快捷按钮
    container.querySelectorAll(".wuc-q").forEach(btn => {
      btn.addEventListener("click", async () => {
        let ts, label;
        if (btn.dataset.min) {
          const m = parseInt(btn.dataset.min, 10);
          ts = Date.now() + m * 60_000; label = `${m}分钟后`;
        } else {
          const dt = new Date(); dt.setDate(dt.getDate()+1); dt.setHours(cfg.defaultHour,cfg.defaultMinute,0,0);
          ts = dt.getTime(); label = `明天 ${pad(cfg.defaultHour)}:${pad(cfg.defaultMinute)}`;
        }
        setAlarm(ts, label);
        const ok = await bridgeSchedule(ts, label);
        injectSystemMessage(`（系统：已设置 ${label} 的提醒～）`);
        setMsg(`✓ 已设置 ${label}${ok?" [桥接✓]":""}`);
      });
    });

    // 自定义时间设定
    container.querySelector("#wuc-set-time")?.addEventListener("click", async () => {
      const v = container.querySelector("#wuc-time-pick").value;
      if (!v) return;
      const [h, m] = v.split(":").map(Number);
      let dt = new Date(); dt.setHours(h, m, 0, 0);
      if (dt.getTime() <= Date.now()) dt = new Date(dt.getTime() + 86_400_000);
      const label = `${pad(h)}:${pad(m)}`;
      setAlarm(dt.getTime(), label);
      const ok = await bridgeSchedule(dt.getTime(), label);
      injectSystemMessage(`（系统：已设置 ${label} 的提醒～）`);
      setMsg(`✓ 已设置 ${label}${ok?" [桥接✓]":""}`);
    });

    // genMode 联动
    const genSel = container.querySelector("#wuc-gen-mode");
    genSel?.addEventListener("change", () => {
      container.querySelector("#wuc-wb-row").style.display    = genSel.value==="worldbook" ? "block" : "none";
      container.querySelector("#wuc-custom-row").style.display = genSel.value==="custom"    ? "block" : "none";
    });

    // 测试桥接
    container.querySelector("#wuc-test-bridge")?.addEventListener("click", async () => {
      setMsg("测试中…");
      const oldUrl = cfg.bridgeUrl, oldKey = cfg.bridgeKey;
      cfg.bridgeUrl = container.querySelector("#wuc-bridge-url").value;
      cfg.bridgeKey = container.querySelector("#wuc-bridge-key").value;
      const ok = await bridgePing();
      cfg.bridgeUrl = oldUrl; cfg.bridgeKey = oldKey;
      setMsg(ok ? "✓ 桥接连通！" : "✗ 无法连接桥接服务", !ok);
    });

    // 保存
    container.querySelector("#wuc-save")?.addEventListener("click", () => {
      const dt = container.querySelector("#wuc-default-time").value;
      if (dt) { const [h,m]=dt.split(":").map(Number); cfg.defaultHour=h; cfg.defaultMinute=m; }
      cfg.enableAlarm   = container.querySelector("#wuc-alarm-sw").checked;
      cfg.boundCharName = container.querySelector("#wuc-bound-char").value;
      cfg.genMode       = container.querySelector("#wuc-gen-mode").value;
      cfg.genCustomText = container.querySelector("#wuc-custom-text").value;
      cfg.wakeMessage   = container.querySelector("#wuc-wake-msg").value;
      cfg.bridgeUrl     = container.querySelector("#wuc-bridge-url").value;
      cfg.bridgeKey     = container.querySelector("#wuc-bridge-key").value;
      const wbEl = container.querySelector("#wuc-wb-entry");
      if (wbEl) { cfg.genWorldbookUid=wbEl.value; cfg.genWorldbookContent=wbEl.options[wbEl.selectedIndex]?.dataset.content||""; }
      saveCfg();
      setMsg("✓ 已保存");
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  11. 初始化
  // ═══════════════════════════════════════════════════════════
  function init() {
    loadCfg();

    // 监听用户消息
    const evSrc = getEventSource();
    const evTypes = getEventTypes();
    if (evSrc?.on) {
      evSrc.on(evTypes.MESSAGE_SENT ?? "MESSAGE_SENT", handleUserMessage);
      console.log("[WUC] 事件监听已注册");
    } else {
      // 降级：MutationObserver
      const top = getTop();
      const chatEl = (top.document ?? document).getElementById("chat");
      if (chatEl) {
        new MutationObserver(muts => {
          for (const mu of muts)
            for (const node of mu.addedNodes)
              if (node.nodeType===1 && node.classList.contains("is_user")) {
                const text = node.querySelector(".mes_text")?.textContent?.trim()??"";
                if (text) handleUserMessage(text);
              }
        }).observe(chatEl, { childList: true });
      }
    }

    // 桥接轮询
    setInterval(pollBridgeEvent, 60_000);

    // ── 挂入酒馆扩展设置面板（核心入口）──
    // 酒馆把扩展的 settings.html 内容嵌入 #extensions_settings 下对应 div
    // 等 DOM 里出现容器再挂载
    function tryMountPanel() {
      // 标准路径：data-extension 属性
      let container = document.querySelector('[data-extension="wake-up-call"] .inline-drawer-content');
      // 备用路径：id 匹配
      if (!container) container = document.getElementById("wake-up-call_container");
      // 再备用：查找包含 wake-up-call 文字的 drawer
      if (!container) {
        const drawers = document.querySelectorAll(".inline-drawer-content");
        for (const d of drawers) {
          if (d.closest("[data-extension='wake-up-call']") || d.textContent.includes("wake-up-call")) {
            container = d; break;
          }
        }
      }

      if (container && !container.querySelector("#wuc-panel-inner")) {
        mountPanel(container);
        console.log("[WUC] 面板已挂入侧边栏");
        return true;
      }
      return false;
    }

    // 立即尝试，失败则用 MutationObserver 等待
    if (!tryMountPanel()) {
      const observer = new MutationObserver(() => {
        if (tryMountPanel()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      // 5 秒超时保底
      setTimeout(() => { tryMountPanel(); observer.disconnect(); }, 5000);
    }

    console.log("[WUC] Wake-Up Call v4.0 已就绪");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
