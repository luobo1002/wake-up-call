// ============================================================
//  Wake-Up Call v6.0 — SillyTavern 独立扩展
//  UI：底部固定按钮 + 居中模态弹窗（遮罩 + 关闭按钮）
//  无任何悬浮拖拽 / 底部栏内联逻辑
//  调试：关键路径 alert 日志
// ============================================================
(function () {
  "use strict";

  /* ═══════════════════════════════════════════════════════════
   *  兼容层
   * ═══════════════════════════════════════════════════════════ */
  function getCtx() {
    try { if (window.SillyTavern?.getContext) return window.SillyTavern.getContext(); } catch (e) {}
    try { if (window.parent?.SillyTavern?.getContext) return window.parent.SillyTavern.getContext(); } catch (e) {}
    try { if (typeof getContext === "function") return getContext(); } catch (e) {}
    return null;
  }
  function getExtSettings() { return window.extension_settings ?? window.parent?.extension_settings ?? {}; }
  function doSaveSettings() {
    const f = window.saveSettingsDebounced ?? window.parent?.saveSettingsDebounced;
    if (typeof f === "function") f();
  }
  function getEventSource() { const ctx = getCtx(); return ctx?.eventSource ?? window.eventSource ?? null; }
  function getEventTypes()  { const ctx = getCtx(); return ctx?.event_types ?? window.event_types ?? window.tavern_events ?? {}; }
  function toast(msg, type = "info") {
    try { const t = window.toastr ?? window.parent?.toastr; if (t?.[type]) t[type](msg); } catch (e) {}
  }

  /* ═══════════════════════════════════════════════════════════
   *  设置
   * ═══════════════════════════════════════════════════════════ */
  const DEFAULTS = {
    bridgeUrl: "http://127.0.0.1:8765",
    bridgeKey: "wake-2026",
    defaultHour: 7,
    defaultMinute: 30,
    enableAlarm: true,
    boundCharName: "",
    genMode: "history",            // history | descOnly | worldbook | custom
    genCustomText: "早安～新的一天开始了！",
    genWorldbookUid: "",
    genWorldbookContent: "",
    wakeMessage: "（系统：叫醒时间到了，{{char}} 的提醒已触发～）",
  };
  let cfg = { ...DEFAULTS };
  function loadCfg() { const e = getExtSettings(); cfg = e.wakeUpCall ? { ...DEFAULTS, ...e.wakeUpCall } : { ...DEFAULTS }; }
  function saveCfg() { const e = getExtSettings(); e.wakeUpCall = { ...cfg }; doSaveSettings(); }

  /* ═══════════════════════════════════════════════════════════
   *  时间解析
   * ═══════════════════════════════════════════════════════════ */
  const CN = { 零:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
  function pad(n) { return String(n).padStart(2, "0"); }

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

  function parseRelative(t) {
    if (/半小时/.test(t)) return 30;
    if (/一刻钟?/.test(t)) return 15;
    let m = t.match(/([0-9零一二两三四五六七八九十百]+)\s*分钟?后/);
    if (m) { const n = parseCN(m[1]); if (!isNaN(n) && n > 0) return n; }
    m = t.match(/([0-9零一二两三四五六七八九十]+)\s*(?:个)?(?:小时|钟头)后/);
    if (m) { const n = parseCN(m[1]); if (!isNaN(n) && n > 0) return n * 60; }
    return null;
  }

  function parseAbsolute(t) {
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
        return { ts: dt.getTime(), label: `${dt.getMonth() + 1}/${dt.getDate()} ${pad(abs.hour)}:${pad(abs.minute)}` };
      }
    }
    if (/晚安|睡了|睡觉|就寝|去睡/.test(t)) {
      const dt = new Date();
      dt.setDate(dt.getDate() + 1);
      dt.setHours(cfg.defaultHour, cfg.defaultMinute, 0, 0);
      return { ts: dt.getTime(), label: `明天 ${pad(cfg.defaultHour)}:${pad(cfg.defaultMinute)}` };
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════════════
   *  提醒状态
   * ═══════════════════════════════════════════════════════════ */
  let currentAlarm = null, localTimer = null;

  function setAlarm(ts, label) {
    clearAlarm(false);
    const delay = ts - Date.now();
    if (delay < 500) return;
    localTimer = setTimeout(onAlarmFire, delay);
    currentAlarm = { ts, label };
    refreshStatus();
    alert(`[WUC] 设置提醒：${label} (${delay / 1000}s 后触发)`);
  }

  function clearAlarm(showToast = true) {
    if (localTimer) { clearTimeout(localTimer); localTimer = null; }
    currentAlarm = null;
    refreshStatus();
    if (showToast) toast("已取消提醒");
  }

  async function onAlarmFire() {
    localTimer = null; currentAlarm = null; refreshStatus();
    injectSystemMessage(await buildWakeMessage());
  }

  /* ═══════════════════════════════════════════════════════════
   *  Termux 桥接
   * ═══════════════════════════════════════════════════════════ */
  async function bridgeSchedule(ts, label) {
    try {
      const r = await fetch(`${cfg.bridgeUrl}/schedule?key=${encodeURIComponent(cfg.bridgeKey)}&ts=${ts}&text=${encodeURIComponent(label)}&alarm=${cfg.enableAlarm ? 1 : 0}`, { signal: AbortSignal.timeout(4000) });
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

  /* ═══════════════════════════════════════════════════════════
   *  消息生成 & 注入
   * ═══════════════════════════════════════════════════════════ */
  async function buildWakeMessage() {
    if (cfg.genMode === "custom") return cfg.genCustomText || "早安～";
    const ctx = getCtx();
    const charName = ctx?.characters?.[ctx?.characterId]?.name || "角色";
    const now = new Date();
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    let prompt = `你是${charName}，用角色口吻写不超过60字的晨间问候，语气自然温柔，不要括号动作描述。现在时间${timeStr}。`;
    if (cfg.genMode === "worldbook" && cfg.genWorldbookContent) prompt += `\n世界观背景：\n${cfg.genWorldbookContent}`;
    try {
      const gqp = window.generateQuietPrompt ?? window.parent?.generateQuietPrompt;
      if (typeof gqp === "function") {
        const r = await gqp(prompt, false, false, "", true, 60);
        if (r?.trim()) return r.trim();
      }
    } catch (e) {}
    return (cfg.wakeMessage || "（系统：叫醒时间到了～）")
      .replace(/\{\{char\}\}/g, charName)
      .replace(/\{\{time\}\}/g, timeStr);
  }

  function injectSystemMessage(text) {
    try {
      const ssm = window.sendSystemMessage ?? window.parent?.sendSystemMessage;
      if (typeof ssm === "function") { ssm("generic", text, {}); return; }
      const ctx = getCtx();
      if (typeof ctx?.addOneMessage === "function") { ctx.addOneMessage({ name: "System", mes: text, is_system: true }); return; }
      const ts = window.triggerSlash ?? window.parent?.triggerSlash;
      if (typeof ts === "function") ts(`/sys ${text}`);
    } catch (e) { console.error("[WUC]", e); }
  }

  /* ═══════════════════════════════════════════════════════════
   *  用户消息处理
   * ═══════════════════════════════════════════════════════════ */
  function isCharBound() {
    if (!cfg.boundCharName) return true;
    try { return (getCtx()?.characters?.[getCtx()?.characterId]?.name ?? "") === cfg.boundCharName; } catch (e) { return true; }
  }

  async function handleMessage(data) {
    if (!isCharBound()) return;
    let text = "";
    if (typeof data === "string") text = data;
    else if (data?.mes) text = data.mes;
    else if (typeof data === "number") { try { text = getCtx()?.chat?.[data]?.mes ?? ""; } catch (e) {} }
    if (!text) return;
    const result = parseTimeCommand(text);
    if (!result) return;

    alert(`[WUC] 识别到时间指令：${text.trim().slice(0, 30)}`);

    if (result.cancel) {
      clearAlarm(true);
      await bridgeCancel();
      injectSystemMessage("（系统：已取消提醒～）");
      return;
    }
    setAlarm(result.ts, result.label);
    const ok = await bridgeSchedule(result.ts, result.label);
    injectSystemMessage(`（系统：已设置 ${result.label} 的提醒，晚安～${ok ? " [桥接✓]" : ""}）`);
  }

  /* ═══════════════════════════════════════════════════════════
   *  UI — 底部固定按钮 + 居中模态弹窗
   * ═══════════════════════════════════════════════════════════ */
  function refreshStatus() {
    const dot = document.getElementById("wuc-fab-dot");
    if (dot) dot.style.display = currentAlarm ? "block" : "none";

    const statusEl = document.getElementById("wuc-status-text");
    const cancelBtn = document.getElementById("wuc-cancel-btn");
    const bar = document.getElementById("wuc-status-bar");
    if (!statusEl) return;
    if (currentAlarm) {
      statusEl.textContent = `⏰ ${currentAlarm.label}`;
      bar.className = "wuc-status-bar wuc-armed";
      cancelBtn.disabled = false;
    } else {
      statusEl.textContent = "💤 暂无提醒";
      bar.className = "wuc-status-bar";
      cancelBtn.disabled = true;
    }
  }

  /** 底部固定圆形按钮 */
  function mountFab() {
    if (document.getElementById("wuc-fab")) return;
    const fab = document.createElement("button");
    fab.id = "wuc-fab";
    fab.type = "button";
    fab.title = "Wake-Up Call";
    fab.innerHTML = `<span>🔔</span><span id="wuc-fab-dot" class="wuc-fab-dot" style="display:none"></span>`;
    fab.addEventListener("click", () => {
      const modal = document.getElementById("wuc-modal-root");
      if (modal) closeModal(); else openModal();
    });
    document.body.appendChild(fab);
    alert("[WUC] 底部按钮已挂载");
  }

  /** 创建并显示居中模态弹窗 */
  function openModal() {
    if (document.getElementById("wuc-modal-root")) return;
    loadCfg();
    const ctx = getCtx();
    const chars = ctx?.characters ?? [];
    const wbEntries = getWbEntries();

    const root = document.createElement("div");
    root.id = "wuc-modal-root";
    root.innerHTML = `
      <div id="wuc-mask" class="wuc-mask"></div>
      <div id="wuc-modal" class="wuc-modal" role="dialog" aria-modal="true">
        <div class="wuc-modal-header">
          <span>🔔 Wake-Up Call</span>
          <button id="wuc-close-btn" class="wuc-close-btn" type="button">✕</button>
        </div>

        <div id="wuc-status-bar" class="wuc-status-bar ${currentAlarm ? "wuc-armed" : ""}">
          <span id="wuc-status-text">${currentAlarm ? `⏰ ${currentAlarm.label}` : "💤 暂无提醒"}</span>
          <button id="wuc-cancel-btn" class="wuc-mini-btn" ${currentAlarm ? "" : "disabled"}>取消</button>
        </div>

        <div class="wuc-quick-row">
          <button class="wuc-q" data-min="15">15分钟后</button>
          <button class="wuc-q" data-min="30">30分钟后</button>
          <button class="wuc-q" data-min="60">1小时后</button>
          <button class="wuc-q" data-tomorrow="1">明早 ${pad(cfg.defaultHour)}:${pad(cfg.defaultMinute)}</button>
        </div>

        <div class="wuc-row">
          <input type="time" id="wuc-timepick" value="${pad(cfg.defaultHour)}:${pad(cfg.defaultMinute)}">
          <button id="wuc-set-btn" class="wuc-primary-btn">设定时间</button>
        </div>

        <div class="wuc-field">
          <label>说「晚安」时的默认唤醒时间</label>
          <input type="time" id="wuc-deftime" value="${pad(cfg.defaultHour)}:${pad(cfg.defaultMinute)}">
        </div>

        <div class="wuc-field wuc-switch-row">
          <span>同时触发手机系统闹钟（需 Termux 桥）</span>
          <label class="wuc-sw"><input type="checkbox" id="wuc-alarm-sw" ${cfg.enableAlarm ? "checked" : ""}><span class="wuc-sl"></span></label>
        </div>

        <div class="wuc-field">
          <label>角色绑定（留空=全局）</label>
          <select id="wuc-char-sel" class="wuc-sel">
            <option value="">— 全局触发 —</option>
            ${chars.map(c => `<option value="${c.name}" ${cfg.boundCharName === c.name ? "selected" : ""}>${c.name}</option>`).join("")}
          </select>
        </div>

        <div class="wuc-field">
          <label>唤醒消息生成方式</label>
          <select id="wuc-gen-sel" class="wuc-sel">
            <option value="history"   ${cfg.genMode === "history"   ? "selected" : ""}>角色设定 + 聊天记录</option>
            <option value="descOnly"  ${cfg.genMode === "descOnly"  ? "selected" : ""}>仅角色描述</option>
            <option value="worldbook" ${cfg.genMode === "worldbook" ? "selected" : ""}>世界书条目</option>
            <option value="custom"    ${cfg.genMode === "custom"    ? "selected" : ""}>自定义固定回复</option>
          </select>
        </div>

        <div id="wuc-wb-row" class="wuc-field" style="display:${cfg.genMode === "worldbook" ? "block" : "none"}">
          <label>世界书条目</label>
          <select id="wuc-wb-sel" class="wuc-sel">
            <option value="">— 选择条目 —</option>
            ${wbEntries.map(e => `<option value="${e.uid}" data-content="${e.content.replace(/"/g, "&quot;")}" ${cfg.genWorldbookUid === e.uid ? "selected" : ""}>${e.label}</option>`).join("")}
          </select>
        </div>

        <div id="wuc-custom-row" class="wuc-field" style="display:${cfg.genMode === "custom" ? "block" : "none"}">
          <label>自定义唤醒回复</label>
          <textarea id="wuc-custom-ta" class="wuc-ta" rows="2">${cfg.genCustomText}</textarea>
        </div>

        <div class="wuc-field">
          <label>系统消息模板（支持 {{char}} {{time}}）</label>
          <textarea id="wuc-msg-ta" class="wuc-ta" rows="2">${cfg.wakeMessage}</textarea>
        </div>

        <div class="wuc-field">
          <label>Termux 桥接地址</label>
          <input type="text" id="wuc-bridge-url" class="wuc-inp" value="${cfg.bridgeUrl}">
        </div>
        <div class="wuc-field">
          <label>桥接密钥</label>
          <input type="text" id="wuc-bridge-key" class="wuc-inp" value="${cfg.bridgeKey}">
        </div>

        <div class="wuc-footer">
          <span id="wuc-msg-tip" class="wuc-tip"></span>
          <button id="wuc-test-btn" class="wuc-sec-btn">测试桥接</button>
          <button id="wuc-save-btn" class="wuc-primary-btn">保存</button>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    bindModalEvents(root);
    alert("[WUC] 弹窗已创建");
  }

  /** 关闭并销毁弹窗 */
  function closeModal() {
    const root = document.getElementById("wuc-modal-root");
    if (root) root.remove();
    alert("[WUC] 弹窗已关闭");
  }

  function setTip(text, isErr = false) {
    const el = document.getElementById("wuc-msg-tip");
    if (!el) return;
    el.textContent = text;
    el.className = "wuc-tip " + (isErr ? "wuc-err" : "wuc-ok");
    setTimeout(() => { el.textContent = ""; el.className = "wuc-tip"; }, 3000);
  }

  function bindModalEvents(root) {
    root.querySelector("#wuc-close-btn").addEventListener("click", closeModal);
    root.querySelector("#wuc-mask").addEventListener("click", closeModal);

    root.querySelector("#wuc-cancel-btn").addEventListener("click", () => {
      clearAlarm(true); bridgeCancel();
      injectSystemMessage("（系统：已取消提醒～）");
    });

    root.querySelectorAll(".wuc-q").forEach(btn => {
      btn.addEventListener("click", async () => {
        let ts, label;
        if (btn.dataset.min) {
          const m = parseInt(btn.dataset.min, 10);
          ts = Date.now() + m * 60_000; label = `${m}分钟后`;
        } else {
          const dt = new Date(); dt.setDate(dt.getDate() + 1); dt.setHours(cfg.defaultHour, cfg.defaultMinute, 0, 0);
          ts = dt.getTime(); label = `明天 ${pad(cfg.defaultHour)}:${pad(cfg.defaultMinute)}`;
        }
        setAlarm(ts, label);
        const ok = await bridgeSchedule(ts, label);
        injectSystemMessage(`（系统：已设置 ${label} 的提醒～）`);
        setTip(`✓ ${label}${ok ? " [桥✓]" : ""}`);
      });
    });

    root.querySelector("#wuc-set-btn").addEventListener("click", async () => {
      const v = root.querySelector("#wuc-timepick").value;
      if (!v) return;
      const [h, m] = v.split(":").map(Number);
      let dt = new Date(); dt.setHours(h, m, 0, 0);
      if (dt.getTime() <= Date.now()) dt = new Date(dt.getTime() + 86_400_000);
      const label = `${pad(h)}:${pad(m)}`;
      setAlarm(dt.getTime(), label);
      const ok = await bridgeSchedule(dt.getTime(), label);
      injectSystemMessage(`（系统：已设置 ${label} 的提醒～）`);
      setTip(`✓ ${label}${ok ? " [桥✓]" : ""}`);
    });

    const genSel = root.querySelector("#wuc-gen-sel");
    genSel.addEventListener("change", () => {
      root.querySelector("#wuc-wb-row").style.display    = genSel.value === "worldbook" ? "block" : "none";
      root.querySelector("#wuc-custom-row").style.display = genSel.value === "custom"   ? "block" : "none";
    });

    root.querySelector("#wuc-test-btn").addEventListener("click", async () => {
      setTip("测试中…");
      const oldUrl = cfg.bridgeUrl, oldKey = cfg.bridgeKey;
      cfg.bridgeUrl = root.querySelector("#wuc-bridge-url").value;
      cfg.bridgeKey = root.querySelector("#wuc-bridge-key").value;
      const ok = await bridgePing();
      cfg.bridgeUrl = oldUrl; cfg.bridgeKey = oldKey;
      setTip(ok ? "✓ 桥接连通！" : "✗ 无法连接", !ok);
    });

    root.querySelector("#wuc-save-btn").addEventListener("click", () => {
      const dt = root.querySelector("#wuc-deftime").value;
      if (dt) { const [h, m] = dt.split(":").map(Number); cfg.defaultHour = h; cfg.defaultMinute = m; }
      cfg.enableAlarm   = root.querySelector("#wuc-alarm-sw").checked;
      cfg.boundCharName = root.querySelector("#wuc-char-sel").value;
      cfg.genMode       = root.querySelector("#wuc-gen-sel").value;
      cfg.genCustomText = root.querySelector("#wuc-custom-ta").value;
      cfg.wakeMessage   = root.querySelector("#wuc-msg-ta").value;
      cfg.bridgeUrl     = root.querySelector("#wuc-bridge-url").value;
      cfg.bridgeKey     = root.querySelector("#wuc-bridge-key").value;
      const wbEl = root.querySelector("#wuc-wb-sel");
      if (wbEl) {
        cfg.genWorldbookUid = wbEl.value;
        cfg.genWorldbookContent = wbEl.options[wbEl.selectedIndex]?.dataset.content || "";
      }
      saveCfg();
      alert("[WUC] 配置已保存");
      setTip("✓ 已保存");
    });
  }

  /* ═══════════════════════════════════════════════════════════
   *  世界书条目
   * ═══════════════════════════════════════════════════════════ */
  function getWbEntries() {
    try {
      const ctx = getCtx();
      const entries = [];
      const map = ctx?.world_info ?? window.world_info ?? {};
      for (const book in map) {
        const es = map[book]?.entries ?? map[book];
        if (!es) continue;
        for (const uid in es) {
          const e = es[uid];
          entries.push({
            uid,
            label: e?.comment || (Array.isArray(e?.key) ? e.key.join(", ") : uid),
            content: e?.content ?? "",
          });
        }
      }
      return entries;
    } catch (e) { return []; }
  }

  /* ═══════════════════════════════════════════════════════════
   *  初始化
   * ═══════════════════════════════════════════════════════════ */
  function init() {
    alert("[WUC] init v6.0 开始");
    loadCfg();

    const evSrc = getEventSource(), evTypes = getEventTypes();
    if (evSrc?.on) {
      evSrc.on(evTypes.MESSAGE_SENT ?? "MESSAGE_SENT", handleMessage);
    } else {
      const chatEl = document.getElementById("chat");
      if (chatEl) new MutationObserver(muts => {
        for (const mu of muts)
          for (const node of mu.addedNodes)
            if (node.nodeType === 1 && node.classList?.contains("is_user")) {
              const t = node.querySelector(".mes_text")?.textContent?.trim() ?? "";
              if (t) handleMessage(t);
            }
      }).observe(chatEl, { childList: true });
    }

    setInterval(pollBridgeEvent, 60_000);

    function tryMount() {
      if (!document.body) return false;
      mountFab();
      return true;
    }
    if (!tryMount()) {
      const ob = new MutationObserver(() => { if (tryMount()) ob.disconnect(); });
      ob.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { tryMount(); ob.disconnect(); }, 8000);
    }

    console.log("[WUC] Wake-Up Call v6.0 已就绪");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
