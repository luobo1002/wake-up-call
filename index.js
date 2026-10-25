/ ============================================================
//  Wake-Up Call v2.1 — SillyTavern 扩展
//  兼容 SillyDroid + Termux 本地部署
//  不依赖固定 import 路径，全部走全局变量降级
// ============================================================

(function () {
  "use strict";

  // ── 全局 API 兼容层（穿透 iframe，SillyDroid 酒馆跑在 iframe 里）──
  function getTop() {
    try { return window.top || window; } catch (e) { return window; }
  }
  function getEventSource() {
    const top = getTop();
    return top.eventSource || window.eventSource || null;
  }
  function getEventTypes() {
    const top = getTop();
    return top.event_types || top.tavern_events || window.event_types || {};
  }
  function getExtSettings() {
    const top = getTop();
    return top.extension_settings || window.extension_settings || {};
  }
  function saveSettings() {
    const top = getTop();
    const fn = top.saveSettingsDebounced || window.saveSettingsDebounced;
    if (typeof fn === "function") fn();
  }
  function getCtx() {
    const top = getTop();
    try {
      if (top.SillyTavern?.getContext) return top.SillyTavern.getContext();
      if (typeof top.getContext === "function") return top.getContext();
      if (window.SillyTavern?.getContext) return window.SillyTavern.getContext();
      if (typeof window.getContext === "function") return window.getContext();
    } catch (e) {}
    return null;
  }

  // ── 默认设置 ─────────────────────────────────────────────
  const defaultSettings = {
    bridgeUrl: "http://127.0.0.1:8765",
    bridgeKey: "wake-2026",
    defaultHour: 7,
    defaultMinute: 30,
    confirmInject: true,
    confirmText: "【系统】已设置 {time} 的提醒，晚安～",
    cancelText: "【系统】已取消提醒，好好休息吧～",
    wakeText: "【系统】主人已在闹钟时间醒来，新的一天开始了～",
    mode: "all",
    whitelist: [],
    genMode: "auto",
    genCustomText: "",
    genCharacter: "",
    genWorldinfoUid: "",
    genWorldinfoContent: "",
    enableSystemAlarm: true,
  };

  let settings = { ...defaultSettings };

  function loadSettings() {
    const ext = getExtSettings();
    if (ext.wakeup) settings = { ...defaultSettings, ...ext.wakeup };
  }
  function persistSettings() {
    const ext = getExtSettings();
    ext.wakeup = settings;
    saveSettings();
  }

  // ── 中文数字解析 ─────────────────────────────────────────
  const CN = { 零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10 };
  function parseCN(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    let total = 0, cur = 0;
    for (const ch of s) {
      const v = CN[ch];
      if (v === undefined) return null;
      if (v === 10) cur = (cur || 1) * 10;
      else { total += cur; cur = v; }
    }
    return total + cur;
  }
  function parseRelMins(text) {
    const t = text.replace(/\s+/g, "");
    let m = t.match(/([0-9一二两三四五六七八九十]+)\s*分钟(?:后|钟)?/);
    if (m) { const n = parseCN(m[1]); if (n > 0) return n; }
    if (/半小时/.test(t)) return 30;
    if (/一刻钟/.test(t)) return 15;
    m = t.match(/([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:小时|钟头)(?:后)?/);
    if (m) { const n = parseCN(m[1]); if (n > 0) return n * 60; }
    return null;
  }
  function parseAbsTime(text) {
    const t = text.replace(/\s+/g, "");
    let dayOffset = 0;
    if (/明天|明早|明晚/.test(t)) dayOffset = 1;
    else if (/后天/.test(t)) dayOffset = 2;
    let period = null;
    if (/晚上|夜晚|晚间/.test(t)) period = "pm18";
    else if (/下午|傍晚/.test(t)) period = "pm12";
    else if (/早上|早晨|上午/.test(t)) period = "am";
    const m = t.match(/([0-9一二两三四五六七八九十]+)(?:[:：](\d{1,2})|点([0-9一二两三四五六七八九十]+)分?|点(半)?)/);
    if (!m) return null;
    let hour = parseCN(m[1]), minute = 0;
    if (m[2] !== undefined) minute = parseInt(m[2], 10);
    else if (m[3] !== undefined) minute = parseCN(m[3]);
    else if (m[4]) minute = 30;
    if (hour === null || hour > 23) return null;
    if (period === "pm18" && hour < 12) hour += 12;
    if (period === "pm12" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute, dayOffset };
  }
  function computeTarget(text) {
    const now = Date.now();
    if (/提醒|闹钟|叫我|叫醒/.test(text)) {
      const mins = parseRelMins(text);
      if (mins > 0) return { ts: now + mins * 60000, label: `${mins}分钟后` };
    }
    const abs = parseAbsTime(text);
    if (abs) {
      const d = new Date(now);
      let dt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + abs.dayOffset, abs.hour, abs.minute, 0, 0);
      if (dt.getTime() <= now) dt = new Date(dt.getTime() + 86400000);
      const label = `${dt.getMonth()+1}月${dt.getDate()}日 ${String(abs.hour).padStart(2,"0")}:${String(abs.minute).padStart(2,"0")}`;
      return { ts: dt.getTime(), label };
    }
    if (/晚安|睡了|睡觉|就寝/.test(text)) {
      const d = new Date(now);
      const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, settings.defaultHour, settings.defaultMinute, 0, 0);
      return { ts: dt.getTime(), label: `明天 ${String(settings.defaultHour).padStart(2,"0")}:${String(settings.defaultMinute).padStart(2,"0")}` };
    }
    return null;
  }

  // ── 系统消息注入 ─────────────────────────────────────────
  function injectSystem(text) {
    const ctx = getCtx();
    if (!ctx?.chat) return;
    ctx.chat.push({ name: "System", is_system: true, mes: text, extra: { wakeup: true } });
    try { getEventSource()?.emit(getEventTypes().CHAT_CHANGED); } catch (e) {}
    try { ctx.saveChatConditional?.(); } catch (e) {}
  }

  // ── Termux 桥接 ──────────────────────────────────────────
  async function apiFetch(path, options = {}) {
    try {
      return await fetch(settings.bridgeUrl + path, options);
    } catch (e) { return null; }
  }
  async function scheduleAlarm(ts, label) {
    const k = encodeURIComponent(settings.bridgeKey);
    const alarm = settings.enableSystemAlarm ? 1 : 0;
    await apiFetch(`/schedule?key=${k}&ts=${ts}&text=${encodeURIComponent(label)}&alarm=${alarm}`);
  }
  async function cancelAlarm() {
    await apiFetch(`/cancel?key=${encodeURIComponent(settings.bridgeKey)}`);
  }
  async function checkBridge() {
    const r = await apiFetch("/ping");
    return !!r?.ok;
  }
  async function syncConfig() {
    const r = await apiFetch(`/config?key=${encodeURIComponent(settings.bridgeKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bridge_key: settings.bridgeKey,
        gen_mode: settings.genMode,
        gen_custom_text: settings.genCustomText,
        gen_character: settings.genCharacter,
        gen_worldinfo: settings.genMode === "worldinfo" ? settings.genWorldinfoContent : "",
      }),
    });
    return !!r;
  }
  async function sendRoleCache() {
    const ctx = getCtx();
    const ch = ctx?.characterId !== undefined ? ctx?.characters?.[ctx.characterId] : null;
    await apiFetch(`/cache?key=${encodeURIComponent(settings.bridgeKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character: ch ? {
          name: ch.name || "",
          description: String(ch.description || "").slice(0, 2000),
          personality: String(ch.personality || "").slice(0, 2000),
          scenario: String(ch.scenario || "").slice(0, 2000),
        } : null,
        userName: ctx?.name1 || "用户",
        genMode: settings.genMode,
        genWorldinfo: settings.genMode === "worldinfo" ? settings.genWorldinfoContent : "",
        history: (ctx?.chat || []).slice(-10).map(m => ({
          name: m.name || "", is_user: !!m.is_user, mes: String(m.mes || "").slice(0, 500),
        })),
      }),
    });
  }
  async function consumeWakeEvent() {
    const k = encodeURIComponent(settings.bridgeKey);
    const r = await apiFetch(`/event?key=${k}`);
    if (!r) return;
    try {
      const d = await r.json();
      if (d?.ok && d.text) {
        injectSystem(d.text);
        await apiFetch(`/event-consume?key=${k}`);
      }
    } catch (e) {}
  }

  // ── 生效范围 ─────────────────────────────────────────────
  function getCurrentCharName() {
    const ctx = getCtx();
    const ch = ctx?.characterId !== undefined ? ctx?.characters?.[ctx.characterId] : null;
    return ch?.name || null;
  }
  function shouldActivate() {
    if (settings.mode === "off") return false;
    if (settings.mode === "whitelist") return settings.whitelist.includes(getCurrentCharName());
    if (settings.genCharacter) return getCurrentCharName() === settings.genCharacter;
    return true;
  }

  // ── 消息监听 ─────────────────────────────────────────────
  function handleUserMessage(data) {
    const text = String(data?.mes || data?.content || "");
    if (!text || !shouldActivate()) return;
    if (/取消(闹钟|提醒|叫醒|定时|时间)/.test(text)) {
      cancelAlarm();
      if (settings.confirmInject) injectSystem(settings.cancelText);
      return;
    }
    const target = computeTarget(text);
    if (!target) return;
    scheduleAlarm(target.ts, target.label);
    sendRoleCache();
    if (settings.confirmInject) injectSystem(settings.confirmText.replace("{time}", target.label));
  }

  // ── 世界书条目 ───────────────────────────────────────────
  function getWiEntries() {
    const ctx = getCtx();
    const wi = ctx?.worldInfo;
    if (!wi) return [];
    if (Array.isArray(wi)) return wi;
    if (Array.isArray(wi.entries)) return wi.entries;
    return [];
  }

  // ── CSS ──────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById("wakeup-styles")) return;
    const s = document.createElement("style");
    s.id = "wakeup-styles";
    s.textContent = `
#wakeup-fab {
  position: fixed !important;
  right: 18px !important;
  bottom: 160px !important;
  z-index: 2147483647 !important;
  width: 58px !important;
  height: 58px !important;
  border-radius: 50% !important;
  cursor: pointer !important;
  user-select: none !important;
  touch-action: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  pointer-events: auto !important;
  visibility: visible !important;
  opacity: 1 !important;
  background: linear-gradient(135deg,#6a3fbf,#3a2880) !important;
  border: 2.5px solid rgba(180,160,255,.7) !important;
  box-shadow: 0 4px 24px rgba(0,0,0,.65), 0 0 0 4px rgba(140,110,255,.18) !important;
  font-size: 28px !important;
  color: #fff !important;
  transition: transform .15s !important;
}
#wakeup-fab:active { transform: scale(.92) !important; }
#wakeup-fab.wu-has-alarm {
  box-shadow: 0 4px 24px rgba(0,0,0,.65), 0 0 0 6px rgba(140,110,255,.4) !important;
  animation: wu-pulse 2s ease-in-out infinite !important;
}
@keyframes wu-pulse {
  0%,100% { box-shadow: 0 4px 24px rgba(0,0,0,.65), 0 0 0 4px rgba(140,110,255,.25); }
  50%      { box-shadow: 0 4px 24px rgba(0,0,0,.65), 0 0 0 10px rgba(140,110,255,.0); }
}
#wakeup-overlay {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483646 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background: rgba(0,0,0,.55) !important;
  backdrop-filter: blur(4px);
  animation: wu-fi .15s ease;
}
@keyframes wu-fi { from{opacity:0} to{opacity:1} }
#wakeup-card {
  width: 340px;
  max-width: 93vw;
  max-height: 86vh;
  overflow-y: auto;
  border-radius: 20px;
  background: #1a1a2e;
  border: 1px solid rgba(160,140,255,.3);
  box-shadow: 0 24px 64px rgba(0,0,0,.7);
  animation: wu-si .2s cubic-bezier(.34,1.56,.64,1);
  color: #e0e0f0;
}
@keyframes wu-si { from{transform:scale(.88) translateY(12px);opacity:0} to{transform:none;opacity:1} }
#wakeup-card::-webkit-scrollbar{width:3px}
#wakeup-card::-webkit-scrollbar-thumb{background:rgba(160,140,255,.3);border-radius:2px}
.wu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid rgba(255,255,255,.07);
  background: linear-gradient(135deg,rgba(100,70,200,.18),transparent);
  border-radius: 20px 20px 0 0;
}
.wu-head-title { font-size: 15px; font-weight: 700; display:flex;align-items:center;gap:8px; }
.wu-x {
  width:28px;height:28px;border-radius:50%;border:none;
  background:rgba(255,255,255,.09);color:#bbb;cursor:pointer;font-size:15px;
  display:flex;align-items:center;justify-content:center;transition:background .15s;
}
.wu-x:hover{background:rgba(255,255,255,.18);}
.wu-body { padding: 14px 18px 18px; }
.wu-label {
  font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: rgba(170,150,255,.85); margin: 14px 0 7px;
  display: flex; align-items: center; gap: 6px;
}
.wu-label:first-child{margin-top:0}
.wu-label::after{content:"";flex:1;height:1px;background:rgba(160,140,255,.18)}
.wu-grid { display:grid;grid-template-columns:1fr 1fr;gap:7px; }
.wu-btn {
  padding:10px 6px;border-radius:11px;
  border:1px solid rgba(160,140,255,.22);
  background:rgba(160,140,255,.08);color:#ddd;
  cursor:pointer;font-size:13px;text-align:center;
  transition:all .15s;
}
.wu-btn:hover{background:rgba(160,140,255,.22);border-color:rgba(160,140,255,.5);transform:translateY(-1px)}
.wu-btn:active{transform:none}
.wu-row { display:flex;align-items:center;gap:8px; }
.wu-time {
  flex:1;padding:9px 11px;border-radius:10px;
  border:1px solid rgba(160,140,255,.25);
  background:rgba(255,255,255,.05);color:#eee;font-size:13px;outline:none;
  transition:border-color .15s;
}
.wu-time:focus{border-color:rgba(160,140,255,.65)}
.wu-pri {
  padding:9px 15px;border-radius:10px;border:none;
  background:linear-gradient(135deg,#7c4cbf,#5030a0);
  color:#fff;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;
  transition:all .15s;
}
.wu-pri:hover{filter:brightness(1.15);transform:translateY(-1px)}
.wu-sel, .wu-inp {
  width:100%;padding:9px 11px;border-radius:10px;
  border:1px solid rgba(160,140,255,.25);
  background:rgba(255,255,255,.05);color:#eee;font-size:13px;
  outline:none;box-sizing:border-box;transition:border-color .15s;
}
.wu-sel:focus,.wu-inp:focus{border-color:rgba(160,140,255,.65)}
.wu-sel option{background:#1a1a2e}
.wu-tog-row {
  display:flex;align-items:center;justify-content:space-between;
  padding:5px 0;font-size:13px;color:#ccc;
}
.wu-tog{position:relative;width:38px;height:21px;flex-shrink:0}
.wu-tog input{opacity:0;width:0;height:0}
.wu-tog-sl{position:absolute;inset:0;border-radius:21px;background:rgba(255,255,255,.15);cursor:pointer;transition:background .2s}
.wu-tog-sl::before{content:"";position:absolute;left:2px;top:2px;width:17px;height:17px;border-radius:50%;background:#fff;transition:transform .2s}
.wu-tog input:checked+.wu-tog-sl{background:#7c4cbf}
.wu-tog input:checked+.wu-tog-sl::before{transform:translateX(17px)}
.wu-cancel-btn {
  width:100%;padding:10px;border-radius:10px;margin-top:4px;
  border:1px solid rgba(248,81,73,.3);background:rgba(248,81,73,.08);
  color:#f85149;cursor:pointer;font-size:13px;transition:all .15s;
}
.wu-cancel-btn:hover{background:rgba(248,81,73,.2)}
.wu-status{display:flex;align-items:center;gap:6px;font-size:11px;color:rgba(255,255,255,.4);margin-top:10px}
.wu-dot{width:7px;height:7px;border-radius:50%;background:#f85149;flex-shrink:0}
.wu-dot.on{background:#3fb950}
.wu-msg{min-height:16px;font-size:12px;color:rgba(170,150,255,.9);text-align:center;margin-top:6px}
    `;
    document.head.appendChild(s);
  }

  // ── FAB 悬浮按钮 ─────────────────────────────────────────
  const FAB_KEY = "wakeup_fab_pos_v2";

  function ensureFab() {
    if (document.getElementById("wakeup-fab")) return;
    if (!document.body) return;

    const fab = document.createElement("div");
    fab.id = "wakeup-fab";
    fab.textContent = "⏰";
    fab.title = "Wake-Up（点击展开 / 长按拖动）";

    // 恢复位置
    try {
      const p = JSON.parse(localStorage.getItem(FAB_KEY) || "null");
      if (p && typeof p.left === "number") {
        fab.style.cssText += `left:${p.left}px!important;top:${p.top}px!important;right:auto!important;bottom:auto!important;`;
      }
    } catch {}

    let dragging = false, moved = false, sx = 0, sy = 0, t0 = 0;

    fab.addEventListener("pointerdown", e => {
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY; t0 = Date.now();
      fab.setPointerCapture(e.pointerId);
      e.preventDefault();
    }, { passive: false });

    fab.addEventListener("pointermove", e => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
      if (moved) {
        const r = fab.getBoundingClientRect();
        const nl = Math.max(0, Math.min(window.innerWidth  - fab.offsetWidth,  r.left + dx));
        const nt = Math.max(0, Math.min(window.innerHeight - fab.offsetHeight, r.top  + dy));
        fab.style.cssText = fab.style.cssText
          .replace(/left:[^;]+;?/g, "")
          .replace(/top:[^;]+;?/g, "")
          .replace(/right:[^;]+;?/g, "")
          .replace(/bottom:[^;]+;?/g, "");
        fab.style.setProperty("left",   nl + "px", "important");
        fab.style.setProperty("top",    nt + "px", "important");
        fab.style.setProperty("right",  "auto",    "important");
        fab.style.setProperty("bottom", "auto",    "important");
        sx = e.clientX; sy = e.clientY;
      }
    });

    fab.addEventListener("pointerup", e => {
      if (!dragging) return;
      dragging = false;
      if (!moved && Date.now() - t0 < 500) {
        openPanel();
      } else if (moved) {
        try {
          const r = fab.getBoundingClientRect();
          localStorage.setItem(FAB_KEY, JSON.stringify({ left: r.left, top: r.top }));
        } catch {}
      }
    });

    document.body.appendChild(fab);
    console.log("[WakeUp] FAB 已挂载");
  }

  // ── 面板 ─────────────────────────────────────────────────
  let panelOpen = false;

  function openPanel() {
    if (panelOpen) return;
    panelOpen = true;

    const ctx = getCtx();
    const chars = ctx?.characters || [];
    const wiEntries = getWiEntries();
    const charName = getCurrentCharName();
    const timeVal = `${String(settings.defaultHour).padStart(2,"0")}:${String(settings.defaultMinute).padStart(2,"0")}`;

    // 角色选项
    let charOpts = `<option value="">— 不绑定（全局生效）—</option>`;
    chars.forEach(c => {
      if (c?.name) charOpts += `<option value="${h(c.name)}"${c.name===settings.genCharacter?" selected":""}>${h(c.name)}</option>`;
    });

    // 世界书选项
    let wiOpts = `<option value="">— 不使用 —</option>`;
    wiEntries.forEach(en => {
      const uid = String(en.uid ?? en.id ?? "");
      const label = [en.comment, en.key].filter(Boolean).join("·") || `条目${uid}`;
      wiOpts += `<option value="${h(uid)}" data-c="${h(String(en.content||"").slice(0,2000))}"${uid===settings.genWorldinfoUid?" selected":""}>${h(String(label).slice(0,48))}</option>`;
    });

    const overlay = document.createElement("div");
    overlay.id = "wakeup-overlay";
    overlay.innerHTML = `
<div id="wakeup-card">
  <div class="wu-head">
    <div class="wu-head-title"><span>⏰</span> Wake-Up 提醒</div>
    <button class="wu-x" id="wu-x">✕</button>
  </div>
  <div class="wu-body">

    <div class="wu-label">快速设定</div>
    <div class="wu-grid">
      <button class="wu-btn" data-min="15">⏱ 15分钟后</button>
      <button class="wu-btn" data-min="30">⏱ 30分钟后</button>
      <button class="wu-btn" data-min="60">⏱ 1小时后</button>
      <button class="wu-btn" data-tmr="1">🌅 明早 ${timeVal}</button>
    </div>

    <div class="wu-label">自定义时间</div>
    <div class="wu-row">
      <input id="wu-time" type="time" class="wu-time" value="${timeVal}">
      <button class="wu-pri" id="wu-set">设置提醒</button>
    </div>

    <div class="wu-label">角色绑定</div>
    <select id="wu-char" class="wu-sel">${charOpts}</select>

    <div class="wu-label">早安生成方式</div>
    <select id="wu-gen" class="wu-sel">
      <option value="auto"       ${settings.genMode==="auto"       ?"selected":""}>💬 角色设定 + 最近聊天</option>
      <option value="description"${settings.genMode==="description"?"selected":""}>📄 仅角色描述（不读聊天）</option>
      <option value="worldinfo"  ${settings.genMode==="worldinfo"  ?"selected":""}>🌍 指定世界书条目</option>
      <option value="custom"     ${settings.genMode==="custom"     ?"selected":""}>✏️ 自定义固定文本</option>
    </select>
    <div id="wu-wi-row"  style="margin-top:7px;display:${settings.genMode==="worldinfo"?"block":"none"}">
      <select id="wu-wi" class="wu-sel">${wiOpts}</select>
    </div>
    <div id="wu-cu-row" style="margin-top:7px;display:${settings.genMode==="custom"?"block":"none"}">
      <input id="wu-cu" type="text" class="wu-inp" placeholder="输入固定早安文本…" value="${h(settings.genCustomText)}">
    </div>

    <div class="wu-label">选项</div>
    <div class="wu-tog-row">
      <span>同时触发手机系统闹钟</span>
      <label class="wu-tog"><input type="checkbox" id="wu-alarm"  ${settings.enableSystemAlarm?"checked":""}><span class="wu-tog-sl"></span></label>
    </div>
    <div class="wu-tog-row">
      <span>设定时注入系统消息</span>
      <label class="wu-tog"><input type="checkbox" id="wu-inject" ${settings.confirmInject?"checked":""}><span class="wu-tog-sl"></span></label>
    </div>

    <div style="margin-top:12px">
      <button class="wu-cancel-btn" id="wu-cancel">🗑 取消当前提醒</button>
    </div>

    <div class="wu-status">
      <span class="wu-dot" id="wu-dot"></span>
      <span id="wu-bridge">检测桥接中…</span>
      <span style="margin-left:auto">${charName ? "当前："+h(charName) : "无活动角色"}</span>
    </div>
    <div class="wu-msg" id="wu-msg"></div>
  </div>
</div>`;

    overlay.addEventListener("click", e => { if (e.target === overlay) closePanel(); });
    overlay.querySelector("#wu-x").addEventListener("click", closePanel);

    // 快速按钮
    overlay.querySelectorAll(".wu-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const min = btn.dataset.min;
        if (min) {
          const ts = Date.now() + parseInt(min) * 60000;
          scheduleAlarm(ts, `${min}分钟后`);
          sendRoleCache();
          msg(overlay, `✓ 已设置 ${min}分钟后提醒`);
          document.getElementById("wakeup-fab")?.classList.add("wu-has-alarm");
        } else {
          const d = new Date();
          const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1, settings.defaultHour, settings.defaultMinute, 0, 0);
          const label = `明天 ${String(settings.defaultHour).padStart(2,"0")}:${String(settings.defaultMinute).padStart(2,"0")}`;
          scheduleAlarm(dt.getTime(), label);
          sendRoleCache();
          msg(overlay, `✓ 已设置 ${label} 提醒`);
          document.getElementById("wakeup-fab")?.classList.add("wu-has-alarm");
        }
      });
    });

    // 自定义时间
    overlay.querySelector("#wu-set").addEventListener("click", () => {
      const v = overlay.querySelector("#wu-time").value;
      if (!v) return msg(overlay, "请先选择时间");
      const [hh, mm] = v.split(":").map(Number);
      const now = new Date();
      let dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
      if (dt.getTime() <= now.getTime()) dt = new Date(dt.getTime() + 86400000);
      const label = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
      scheduleAlarm(dt.getTime(), label);
      sendRoleCache();
      settings.defaultHour = hh; settings.defaultMinute = mm;
      persistSettings();
      msg(overlay, `✓ 已设置 ${label} 提醒`);
      document.getElementById("wakeup-fab")?.classList.add("wu-has-alarm");
    });

    // 角色绑定
    overlay.querySelector("#wu-char").addEventListener("change", e => {
      settings.genCharacter = e.target.value;
      persistSettings(); syncConfig();
      msg(overlay, settings.genCharacter ? `✓ 绑定：${settings.genCharacter}` : "✓ 已取消绑定");
    });

    // 生成方式
    overlay.querySelector("#wu-gen").addEventListener("change", e => {
      settings.genMode = e.target.value;
      overlay.querySelector("#wu-wi-row").style.display  = settings.genMode === "worldinfo" ? "block" : "none";
      overlay.querySelector("#wu-cu-row").style.display  = settings.genMode === "custom"    ? "block" : "none";
      persistSettings(); syncConfig();
      msg(overlay, "✓ 已切换生成方式");
    });

    // 世界书
    overlay.querySelector("#wu-wi").addEventListener("change", e => {
      const opt = e.target.options[e.target.selectedIndex];
      settings.genWorldinfoUid     = e.target.value;
      settings.genWorldinfoContent = opt.dataset.c || "";
      persistSettings(); syncConfig();
      msg(overlay, "✓ 已选择世界书条目");
    });

    // 自定义文本
    overlay.querySelector("#wu-cu").addEventListener("input", e => {
      settings.genCustomText = e.target.value.trim();
      persistSettings();
    });

    // 开关
    overlay.querySelector("#wu-alarm").addEventListener("change",  e => { settings.enableSystemAlarm = e.target.checked; persistSettings(); });
    overlay.querySelector("#wu-inject").addEventListener("change", e => { settings.confirmInject      = e.target.checked; persistSettings(); });

    // 取消提醒
    overlay.querySelector("#wu-cancel").addEventListener("click", () => {
      cancelAlarm();
      if (settings.confirmInject) injectSystem(settings.cancelText);
      getDoc().getElementById("wakeup-fab")?.classList.remove("wu-has-alarm");
      msg(overlay, "✓ 已取消提醒");
    });

    getDoc().body.appendChild(overlay);

    // 异步检测桥
    checkBridge().then(ok => {
      const dot = overlay.querySelector("#wu-dot");
      const txt = overlay.querySelector("#wu-bridge");
      if (dot) dot.classList.toggle("on", ok);
      if (txt) txt.textContent = ok ? "Termux 桥已连接 ✓" : "Termux 桥未连接";
    });
  }

  function closePanel() {
    panelOpen = false;
    getDoc().getElementById("wakeup-overlay")?.remove();
  }

  function msg(overlay, text) {
    const el = overlay.querySelector("#wu-msg");
    if (!el) return;
    el.textContent = text;
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = "0"; }, 2500);
  }

  function h(str) {
    return String(str).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // ── 扩展设置面板（酒馆内嵌）────────────────────────────
  function buildSettingsPanel() {
    const doc = getDoc();
    const wrap = doc.getElementById("extensions_settings");
    if (!wrap || doc.getElementById("wakeup-settings-root")) return;

    const ctx = getCtx();
    const div = doc.createElement("div");
    div.id = "wakeup-settings-root";
    div.style.cssText = "padding:8px 0;font-size:13px;";
    div.innerHTML = `
<details open style="background:rgba(140,110,255,.07);border:1px solid rgba(140,110,255,.2);border-radius:12px;padding:12px 14px;margin-bottom:8px;">
  <summary style="font-weight:700;font-size:14px;cursor:pointer;list-style:none;">⏰ Wake-Up Call <span style="font-size:11px;opacity:.5;font-weight:400;">v2.1</span></summary>
  <div style="margin-top:12px;display:grid;gap:10px;">

    <div>
      <div style="font-size:11px;opacity:.6;margin-bottom:3px;">Termux 桥地址</div>
      <input id="wus-url" class="text_pole" type="text" value="${h(settings.bridgeUrl)}">
    </div>
    <div>
      <div style="font-size:11px;opacity:.6;margin-bottom:3px;">桥接密钥</div>
      <input id="wus-key" class="text_pole" type="text" value="${h(settings.bridgeKey)}">
    </div>
    <div style="display:flex;gap:10px;">
      <div style="flex:1">
        <div style="font-size:11px;opacity:.6;margin-bottom:3px;">默认叫醒时</div>
        <input id="wus-hour" class="text_pole" type="number" min="0" max="23" value="${settings.defaultHour}">
      </div>
      <div style="flex:1">
        <div style="font-size:11px;opacity:.6;margin-bottom:3px;">默认叫醒分</div>
        <input id="wus-min" class="text_pole" type="number" min="0" max="59" value="${settings.defaultMinute}">
      </div>
    </div>
    <div>
      <div style="font-size:11px;opacity:.6;margin-bottom:3px;">绑定角色</div>
      <select id="wus-char" class="text_pole">
        <option value="">— 全局生效 —</option>
        ${(ctx?.characters||[]).filter(c=>c?.name).map(c=>`<option value="${h(c.name)}"${c.name===settings.genCharacter?" selected":""}>${h(c.name)}</option>`).join("")}
      </select>
    </div>
    <div>
      <div style="font-size:11px;opacity:.6;margin-bottom:3px;">生成方式</div>
      <select id="wus-gen" class="text_pole">
        <option value="auto"        ${settings.genMode==="auto"        ?"selected":""}>角色设定 + 最近聊天</option>
        <option value="description" ${settings.genMode==="description" ?"selected":""}>仅角色描述（不读聊天）</option>
        <option value="worldinfo"   ${settings.genMode==="worldinfo"   ?"selected":""}>指定世界书条目</option>
        <option value="custom"      ${settings.genMode==="custom"      ?"selected":""}>自定义固定文本</option>
      </select>
    </div>
    <div>
      <div style="font-size:11px;opacity:.6;margin-bottom:3px;">自定义文本（生成方式=自定义时生效）</div>
      <input id="wus-cu" class="text_pole" type="text" value="${h(settings.genCustomText)}" placeholder="早上好～">
    </div>
    <div>
      <div style="font-size:11px;opacity:.6;margin-bottom:3px;">生效范围</div>
      <select id="wus-mode" class="text_pole">
        <option value="all"       ${settings.mode==="all"       ?"selected":""}>全部对话</option>
        <option value="whitelist" ${settings.mode==="whitelist" ?"selected":""}>仅白名单</option>
        <option value="off"       ${settings.mode==="off"       ?"selected":""}>停用</option>
      </select>
    </div>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
      <input type="checkbox" id="wus-inject" ${settings.confirmInject?"checked":""}> 设定时注入系统消息
    </label>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
      <input type="checkbox" id="wus-alarm" ${settings.enableSystemAlarm?"checked":""}> 触发手机系统闹钟
    </label>
    <div style="display:flex;gap:8px;align-items:center;">
      <button id="wus-save" class="menu_button" style="flex:1;">💾 保存</button>
      <button id="wus-check" class="menu_button">检测桥接</button>
      <span id="wus-status" style="font-size:11px;opacity:.6;"></span>
    </div>
  </div>
</details>`;

    wrap.appendChild(div);

    div.querySelector("#wus-save").addEventListener("click", async () => {
      settings.bridgeUrl        = div.querySelector("#wus-url").value.trim()  || defaultSettings.bridgeUrl;
      settings.bridgeKey        = div.querySelector("#wus-key").value.trim()  || defaultSettings.bridgeKey;
      settings.defaultHour      = Math.min(23, Math.max(0, parseInt(div.querySelector("#wus-hour").value)||7));
      settings.defaultMinute    = Math.min(59, Math.max(0, parseInt(div.querySelector("#wus-min").value) ||30));
      settings.genCharacter     = div.querySelector("#wus-char").value;
      settings.genMode          = div.querySelector("#wus-gen").value;
      settings.genCustomText    = div.querySelector("#wus-cu").value.trim();
      settings.mode             = div.querySelector("#wus-mode").value;
      settings.confirmInject    = div.querySelector("#wus-inject").checked;
      settings.enableSystemAlarm= div.querySelector("#wus-alarm").checked;
      persistSettings();
      const ok = await syncConfig();
      const st = div.querySelector("#wus-status");
      st.textContent = ok ? "✓ 已同步" : "✓ 已保存（桥未连接）";
      setTimeout(() => { st.textContent = ""; }, 3000);
    });

    div.querySelector("#wus-check").addEventListener("click", async () => {
      const st = div.querySelector("#wus-status");
      st.textContent = "检测中…";
      const ok = await checkBridge();
      st.textContent = ok ? "● 已连接" : "○ 未连接";
      st.style.color = ok ? "#3fb950" : "#f85149";
    });
  }

  // ── 初始化入口 ────────────────────────────────────────────
  function init() {
    loadSettings();
    injectCSS();
    ensureFab();
    buildSettingsPanel();

    // 注册消息监听（兼容多种事件名）
    const es = getEventSource();
    const et = getEventTypes();
    if (es && et) {
      const evName = et.MESSAGE_SENT || et.USER_MESSAGE_RENDERED || "message_sent";
      try { es.on(evName, handleUserMessage); } catch (e) {}
    }

    // 到点事件轮询
    consumeWakeEvent();
    setInterval(consumeWakeEvent, 60000);

    console.log("[WakeUp] v2.1 初始化完成");
  }

  // DOM 就绪后执行，多重保障
  const doc0 = getDoc();
  if (doc0.body) {
    init();
  } else {
    doc0.addEventListener("DOMContentLoaded", init);
  }
  // 额外延迟重试，防止酒馆异步渲染
  setTimeout(() => { injectCSS(); ensureFab(); }, 800);
  setTimeout(() => { injectCSS(); ensureFab(); buildSettingsPanel(); }, 2500);
  setTimeout(() => { injectCSS(); ensureFab(); buildSettingsPanel(); }, 5000);

})();
