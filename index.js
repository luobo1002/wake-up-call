/ ============================================================
//  Wake-Up Call v2.0 — SillyTavern 扩展
//  ------------------------------------------------------------
//  功能：
//    1) 识别聊天中的时间指令（晚安 / 明天X点 / XX分钟后 / 取消）
//    2) 通过 Termux 桥（bridge.py）注册定时任务 + 系统闹钟
//    3) 到点由 Termux 弹通知，并在酒馆注入系统消息（is_system）
//    4) 悬浮按钮：可拖动 + 点击展开控制面板
//    5) 面板功能：角色绑定、生成方式（角色+历史/仅描述/世界书/自定义）
//  安装：wake-up-call 文件夹放入 SillyTavern/extensions/ 下，重启酒馆
//  依赖：Termux 侧运行 bridge.py（见 README）
// ============================================================

import {
  eventSource,
  event_types,
  extension_settings,
  saveSettingsDebounced,
} from "../../../extensions.js";

// ---------- 获取酒馆上下文 ----------
function getCtx() {
  try {
    if (window.SillyTavern?.getContext) return window.SillyTavern.getContext();
    if (typeof window.getContext === "function") return window.getContext();
  } catch (e) {}
  return null;
}

// ---------- 默认设置 ----------
const defaultSettings = {
  bridgeUrl: "http://127.0.0.1:8765",
  bridgeKey: "wake-2026",
  defaultHour: 7,
  defaultMinute: 30,
  confirmInject: true,
  confirmText: "【系统】已设置 {time} 的提醒，晚安～",
  cancelText: "【系统】已取消提醒，好好休息吧～",
  wakeText: "【系统】主人已在闹钟时间醒来，新的一天开始了～",
  // 生效范围：all=全部 / whitelist=白名单 / off=停用
  mode: "all",
  whitelist: [],
  // 早安生成方式
  genMode: "auto",         // auto | description | worldinfo | custom
  genCustomText: "",
  genCharacter: "",
  genWorldinfoUid: "",
  genWorldinfoContent: "",
  // 是否同时触发手机系统闹钟
  enableSystemAlarm: true,
};

let settings = { ...defaultSettings };

// ============================================================
//  中文数字解析
// ============================================================
const CN_NUM = { 零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10 };

function parseCnNum(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let total = 0, cur = 0;
  for (const ch of s) {
    const v = CN_NUM[ch];
    if (v === undefined) return null;
    if (v === 10) cur = (cur || 1) * 10;
    else { total += cur; cur = v; }
  }
  return total + cur;
}

function parseRelativeMinutes(text) {
  const t = text.replace(/\s+/g, "");
  let m = t.match(/([0-9一二两三四五六七八九十]+)\s*分钟(?:后|钟)?/);
  if (m) { const n = parseCnNum(m[1]); if (n > 0) return n; }
  if (/半小时/.test(t)) return 30;
  if (/一刻钟/.test(t)) return 15;
  m = t.match(/([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:小时|钟头)(?:后)?/);
  if (m) { const n = parseCnNum(m[1]); if (n > 0) return n * 60; }
  return null;
}

function parseAbsoluteTime(text) {
  const t = text.replace(/\s+/g, "");
  let dayOffset = 0;
  if (/明天|明早|明晚/.test(t)) dayOffset = 1;
  else if (/后天/.test(t)) dayOffset = 2;

  let period = null;
  if (/晚上|夜晚|晚间/.test(t)) period = "evening";
  else if (/下午|傍晚/.test(t)) period = "pm";
  else if (/早上|早晨|上午/.test(t)) period = "am";

  const m = t.match(/([0-9一二两三四五六七八九十]+)(?:[:：](\d{1,2})|点([0-9一二两三四五六七八九十]+)分?|点(半)?)/);
  if (!m) return null;

  let hour = parseCnNum(m[1]);
  let minute = 0;
  if (m[2] !== undefined) minute = parseInt(m[2], 10);
  else if (m[3] !== undefined) minute = parseCnNum(m[3]);
  else if (m[4]) minute = 30;
  if (hour === null || hour > 23) return null;

  if (period === "evening" && hour < 12) hour += 12;
  if (period === "pm" && hour < 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute, dayOffset };
}

function computeTarget(text) {
  const now = Date.now();

  if (/提醒|闹钟|叫我|叫醒/.test(text)) {
    const mins = parseRelativeMinutes(text);
    if (mins !== null && mins > 0) {
      return { ts: now + mins * 60_000, label: `${mins}分钟后` };
    }
  }

  const abs = parseAbsoluteTime(text);
  if (abs) {
    const d = new Date(now);
    let dt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + abs.dayOffset, abs.hour, abs.minute, 0, 0);
    if (dt.getTime() <= now) dt = new Date(dt.getTime() + 86_400_000);
    const label = `${dt.getMonth()+1}月${dt.getDate()}日 ${String(abs.hour).padStart(2,"0")}:${String(abs.minute).padStart(2,"0")}`;
    return { ts: dt.getTime(), label };
  }

  if (/晚安|睡了|睡觉|就寝/.test(text)) {
    const d = new Date(now);
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, settings.defaultHour, settings.defaultMinute, 0, 0);
    const label = `明天 ${String(settings.defaultHour).padStart(2,"0")}:${String(settings.defaultMinute).padStart(2,"0")}`;
    return { ts: dt.getTime(), label };
  }

  return null;
}

// ============================================================
//  系统消息注入（is_system，不计入主线剧情）
// ============================================================
function injectSystem(text) {
  const ctx = getCtx();
  if (!ctx?.chat) return;
  ctx.chat.push({
    name: "System",
    is_system: true,
    mes: text,
    extra: { wakeup: true },
  });
  eventSource.emit(event_types.CHAT_CHANGED);
  ctx.saveChatConditional?.();
}

// ============================================================
//  Termux 桥接
// ============================================================
async function apiFetch(path, options = {}) {
  try {
    const url = `${settings.bridgeUrl}${path}`;
    const res = await fetch(url, { ...options });
    return res.ok ? res : null;
  } catch (e) {
    console.warn("[WakeUp] 桥接请求失败:", e.message);
    return null;
  }
}

async function scheduleAlarm(ts, label) {
  const key = encodeURIComponent(settings.bridgeKey);
  const alarm = settings.enableSystemAlarm ? 1 : 0;
  await apiFetch(`/schedule?key=${key}&ts=${ts}&text=${encodeURIComponent(label)}&alarm=${alarm}`);
}

async function cancelAlarm() {
  await apiFetch(`/cancel?key=${encodeURIComponent(settings.bridgeKey)}`);
}

async function checkBridge() {
  const res = await apiFetch("/ping");
  return !!res;
}

async function syncConfig() {
  const body = {
    bridge_key: settings.bridgeKey,
    gen_mode: settings.genMode,
    gen_custom_text: settings.genCustomText,
    gen_character: settings.genCharacter,
    gen_worldinfo: settings.genMode === "worldinfo" ? settings.genWorldinfoContent : "",
  };
  const res = await apiFetch(`/config?key=${encodeURIComponent(settings.bridgeKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return !!res;
}

// 缓存角色人格 + 最近聊天到 Termux（供离线生成早安回复）
async function sendRoleCache() {
  const ctx = getCtx();
  const ch = ctx?.characterId !== undefined && ctx?.characters?.[ctx.characterId];
  const cacheData = {
    character: ch ? {
      name: ch.name || "",
      description: String(ch.description || "").slice(0, 2000),
      personality: String(ch.personality || "").slice(0, 2000),
      scenario: String(ch.scenario || "").slice(0, 2000),
      mes_example: String(ch.mes_example || "").slice(0, 2000),
    } : null,
    userName: ctx?.name1 || "用户",
    genMode: settings.genMode,
    genWorldinfo: settings.genMode === "worldinfo" ? settings.genWorldinfoContent : "",
    history: (ctx?.chat || []).slice(-10).map(m => ({
      name: m.name || "",
      is_user: !!m.is_user,
      mes: String(m.mes || "").slice(0, 500),
    })),
  };
  await apiFetch(`/cache?key=${encodeURIComponent(settings.bridgeKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cacheData),
  });
}

// 检查并消费到点事件（醒来系统消息）
async function consumeWakeEvent() {
  const key = encodeURIComponent(settings.bridgeKey);
  const res = await apiFetch(`/event?key=${key}`);
  if (!res) return;
  const data = await res.json().catch(() => null);
  if (data?.ok && data.text) {
    injectSystem(data.text);
    await apiFetch(`/event-consume?key=${key}`);
  }
}

// ============================================================
//  生效范围判断
// ============================================================
function getCurrentCharName() {
  const ctx = getCtx();
  const ch = ctx?.characterId !== undefined && ctx?.characters?.[ctx.characterId];
  return ch ? ch.name : null;
}

function shouldActivate() {
  if (settings.mode === "off") return false;
  if (settings.mode === "whitelist") {
    const name = getCurrentCharName();
    return name !== null && settings.whitelist.includes(name);
  }
  // mode === "all"：如果绑定了角色则只在该角色对话里触发
  if (settings.genCharacter) {
    return getCurrentCharName() === settings.genCharacter;
  }
  return true;
}

// ============================================================
//  用户消息处理
// ============================================================
function handleUserMessage(data) {
  const text = String(data?.mes || "");
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
  if (settings.confirmInject) {
    injectSystem(settings.confirmText.replace("{time}", target.label));
  }
}

// ============================================================
//  世界书条目读取
// ============================================================
function getWorldInfoEntries() {
  const ctx = getCtx();
  if (!ctx?.worldInfo) return [];
  const wi = ctx.worldInfo;
  if (Array.isArray(wi)) return wi;
  if (Array.isArray(wi.entries)) return wi.entries;
  return [];
}

// ============================================================
//  悬浮按钮（FAB）
// ============================================================
const FAB_STORAGE_KEY = "wakeup_fab_pos_v2";

function addFloatingButton() {
  if ($("#wakeup-fab").length) return;

  const $fab = $(`
    <div id="wakeup-fab" title="Wake-Up 提醒（长按拖动，点按展开）">
      <div class="wakeup-fab-icon">⏰</div>
      <div class="wakeup-fab-pulse"></div>
    </div>
  `);

  // 恢复保存的位置
  try {
    const pos = JSON.parse(localStorage.getItem(FAB_STORAGE_KEY) || "null");
    if (pos?.left !== undefined) {
      $fab.css({ left: pos.left, top: pos.top, right: "auto", bottom: "auto" });
    }
  } catch {}

  // 拖拽逻辑
  let dragging = false, moved = false, sx = 0, sy = 0, t0 = 0;

  $fab.on("pointerdown", e => {
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY; t0 = Date.now();
    $fab.css("cursor", "grabbing");
    e.preventDefault();
  });

  $(document).on("pointermove.wakeup-fab", e => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
    if (moved) {
      const r = $fab[0].getBoundingClientRect();
      $fab.css({ left: r.left + dx, top: r.top + dy, right: "auto", bottom: "auto" });
      sx = e.clientX; sy = e.clientY;
    }
  });

  $(document).on("pointerup.wakeup-fab", () => {
    if (!dragging) return;
    dragging = false;
    $fab.css("cursor", "grab");
    if (!moved && Date.now() - t0 < 400) {
      openPanel();
    } else if (moved) {
      try {
        const r = $fab[0].getBoundingClientRect();
        localStorage.setItem(FAB_STORAGE_KEY, JSON.stringify({ left: r.left, top: r.top }));
      } catch {}
    }
  });

  $("body").append($fab);

  // 注入 FAB 样式
  if (!$("#wakeup-styles").length) {
    $("head").append(`<style id="wakeup-styles">${getStyles()}</style>`);
  }
}

// ============================================================
//  CSS 样式
// ============================================================
function getStyles() {
  return `
/* ===== Wake-Up Call 样式 ===== */
#wakeup-fab {
  position: fixed;
  right: 20px;
  bottom: 120px;
  z-index: 99998;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  cursor: grab;
  user-select: none;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wakeup-fab-icon {
  position: relative;
  z-index: 2;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  background: linear-gradient(135deg, rgba(60,60,80,.95) 0%, rgba(35,35,50,.98) 100%);
  border: 1.5px solid rgba(150,130,255,.35);
  box-shadow: 0 4px 18px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.08);
  transition: transform .15s, box-shadow .15s;
}
#wakeup-fab:active .wakeup-fab-icon {
  transform: scale(.93);
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
}
.wakeup-fab-pulse {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  background: transparent;
  border: 2px solid rgba(140,120,255,.0);
  pointer-events: none;
}
#wakeup-fab.has-alarm .wakeup-fab-pulse {
  border-color: rgba(140,120,255,.5);
  animation: wakeup-pulse 2s ease-in-out infinite;
}
@keyframes wakeup-pulse {
  0%,100% { transform: scale(1); opacity: .5; }
  50% { transform: scale(1.18); opacity: 0; }
}

/* ===== 面板遮罩 ===== */
#wakeup-panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.5);
  backdrop-filter: blur(3px);
  animation: wakeup-fadein .15s ease;
}
@keyframes wakeup-fadein {
  from { opacity: 0; } to { opacity: 1; }
}

/* ===== 面板卡片 ===== */
#wakeup-panel-card {
  width: 340px;
  max-width: 92vw;
  max-height: 88vh;
  overflow-y: auto;
  border-radius: 18px;
  padding: 0;
  background: var(--SmartThemeBlurTintColor, #1e1e2e);
  border: 1px solid rgba(150,130,255,.25);
  box-shadow: 0 20px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04);
  animation: wakeup-slidein .2s cubic-bezier(.34,1.56,.64,1);
}
@keyframes wakeup-slidein {
  from { transform: scale(.9) translateY(10px); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}
#wakeup-panel-card::-webkit-scrollbar { width: 4px; }
#wakeup-panel-card::-webkit-scrollbar-track { background: transparent; }
#wakeup-panel-card::-webkit-scrollbar-thumb { background: rgba(150,130,255,.3); border-radius: 2px; }

/* ===== 面板头部 ===== */
.wu-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid rgba(255,255,255,.07);
  background: linear-gradient(135deg, rgba(100,80,180,.15) 0%, transparent 100%);
  border-radius: 18px 18px 0 0;
}
.wu-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--SmartThemeBodyColor, #e0e0e0);
}
.wu-panel-title .wu-icon { font-size: 20px; }
.wu-close-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,.08);
  color: var(--SmartThemeBodyColor, #aaa);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: background .15s;
}
.wu-close-btn:hover { background: rgba(255,255,255,.15); }

/* ===== 面板内容区 ===== */
.wu-panel-body { padding: 16px 20px; }

/* ===== 分组标签 ===== */
.wu-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: rgba(150,130,255,.8);
  margin-bottom: 8px;
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.wu-section-label:first-child { margin-top: 0; }
.wu-section-label::after {
  content: "";
  flex: 1;
  height: 1px;
  background: rgba(150,130,255,.2);
}

/* ===== 快速按钮网格 ===== */
.wu-quick-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  margin-bottom: 2px;
}
.wu-quick-btn {
  padding: 9px 6px;
  border-radius: 10px;
  border: 1px solid rgba(150,130,255,.2);
  background: rgba(150,130,255,.08);
  color: var(--SmartThemeBodyColor, #ddd);
  cursor: pointer;
  font-size: 12.5px;
  text-align: center;
  transition: all .15s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wu-quick-btn:hover {
  background: rgba(150,130,255,.2);
  border-color: rgba(150,130,255,.45);
  transform: translateY(-1px);
}
.wu-quick-btn:active { transform: translateY(0); }

/* ===== 自定义时间行 ===== */
.wu-time-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wu-time-input {
  flex: 1;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid rgba(150,130,255,.25);
  background: rgba(255,255,255,.05);
  color: var(--SmartThemeBodyColor, #eee);
  font-size: 13px;
  outline: none;
  transition: border-color .15s;
}
.wu-time-input:focus { border-color: rgba(150,130,255,.6); }
.wu-primary-btn {
  padding: 8px 14px;
  border-radius: 9px;
  border: none;
  background: linear-gradient(135deg, #7c5cbf, #5c4a9e);
  color: #fff;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 500;
  transition: all .15s;
  white-space: nowrap;
}
.wu-primary-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
.wu-primary-btn:active { transform: translateY(0); }

/* ===== 选择框 & 文本输入 ===== */
.wu-select, .wu-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid rgba(150,130,255,.25);
  background: rgba(255,255,255,.05);
  color: var(--SmartThemeBodyColor, #eee);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  transition: border-color .15s;
}
.wu-select:focus, .wu-input:focus { border-color: rgba(150,130,255,.6); }
.wu-select option { background: #1e1e2e; }

/* ===== 开关行 ===== */
.wu-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13px;
  color: var(--SmartThemeBodyColor, #ddd);
}
.wu-toggle {
  position: relative;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}
.wu-toggle input { opacity: 0; width: 0; height: 0; }
.wu-toggle-slider {
  position: absolute;
  inset: 0;
  border-radius: 20px;
  background: rgba(255,255,255,.15);
  cursor: pointer;
  transition: background .2s;
}
.wu-toggle-slider::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform .2s;
}
.wu-toggle input:checked + .wu-toggle-slider { background: #7c5cbf; }
.wu-toggle input:checked + .wu-toggle-slider::before { transform: translateX(16px); }

/* ===== 状态指示点 ===== */
.wu-status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 5px;
  background: #f85149;
}
.wu-status-dot.online { background: #3fb950; }

/* ===== 状态栏 ===== */
.wu-status-bar {
  display: flex;
  align-items: center;
  font-size: 11px;
  color: rgba(255,255,255,.5);
  padding: 8px 0 2px;
}

/* ===== 消息反馈 ===== */
.wu-msg {
  min-height: 18px;
  font-size: 11.5px;
  color: rgba(150,130,255,.9);
  padding: 6px 0 0;
  text-align: center;
}

/* ===== 危险按钮 ===== */
.wu-danger-btn {
  width: 100%;
  padding: 9px;
  border-radius: 9px;
  border: 1px solid rgba(248,81,73,.3);
  background: rgba(248,81,73,.08);
  color: #f85149;
  cursor: pointer;
  font-size: 12.5px;
  transition: all .15s;
}
.wu-danger-btn:hover { background: rgba(248,81,73,.18); }

/* ===== 设置面板（酒馆扩展页）compat ===== */
.wakeup-settings-section {
  background: rgba(150,130,255,.06);
  border: 1px solid rgba(150,130,255,.18);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
}
.wakeup-settings-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: rgba(150,130,255,.75);
  margin-bottom: 10px;
}
  `;
}

// ============================================================
//  控制面板
// ============================================================
let panelOpen = false;

function openPanel() {
  if (panelOpen) { closePanel(); return; }
  panelOpen = true;

  const ctx = getCtx();
  const chars = ctx?.characters || [];
  const wiEntries = getWorldInfoEntries();
  const currentName = getCurrentCharName();

  // 构建角色选项
  let charOptions = `<option value="">— 不绑定（全局生效）—</option>`;
  chars.forEach(c => {
    if (c?.name) {
      const sel = c.name === settings.genCharacter ? "selected" : "";
      charOptions += `<option value="${esc(c.name)}" ${sel}>${esc(c.name)}</option>`;
    }
  });

  // 构建世界书选项
  let wiOptions = `<option value="">— 不使用 —</option>`;
  wiEntries.forEach(en => {
    const uid = String(en.uid ?? en.id ?? "");
    const label = [en.comment, en.key].filter(Boolean).join("·") || `条目${uid}`;
    const sel = uid === settings.genWorldinfoUid ? "selected" : "";
    wiOptions += `<option value="${esc(uid)}" data-content="${esc(String(en.content||"").slice(0,2000))}" ${sel}>${esc(String(label).slice(0,50))}</option>`;
  });

  const timeVal = `${String(settings.defaultHour).padStart(2,"0")}:${String(settings.defaultMinute).padStart(2,"0")}`;
  const statusText = currentName ? `当前角色：${currentName}` : "无活动角色";

  const $overlay = $(`
    <div id="wakeup-panel-overlay">
      <div id="wakeup-panel-card">
        <!-- 头部 -->
        <div class="wu-panel-header">
          <div class="wu-panel-title">
            <span class="wu-icon">⏰</span>
            Wake-Up 提醒
          </div>
          <button class="wu-close-btn" id="wu-close">✕</button>
        </div>

        <!-- 内容 -->
        <div class="wu-panel-body">

          <!-- 快速设定 -->
          <div class="wu-section-label">快速设定</div>
          <div class="wu-quick-grid">
            <button class="wu-quick-btn" data-min="15">⏱ 15分钟后</button>
            <button class="wu-quick-btn" data-min="30">⏱ 30分钟后</button>
            <button class="wu-quick-btn" data-min="60">⏱ 1小时后</button>
            <button class="wu-quick-btn" data-tomorrow="1">🌅 明早 ${timeVal}</button>
          </div>

          <!-- 自定义时间 -->
          <div class="wu-section-label">自定义时间</div>
          <div class="wu-time-row">
            <input id="wu-time" type="time" class="wu-time-input" value="${timeVal}">
            <button id="wu-set-custom" class="wu-primary-btn">设置提醒</button>
          </div>

          <!-- 角色绑定 -->
          <div class="wu-section-label">角色绑定</div>
          <select id="wu-char-bind" class="wu-select">
            ${charOptions}
          </select>

          <!-- 生成方式 -->
          <div class="wu-section-label">早安回复生成方式</div>
          <select id="wu-gen-mode" class="wu-select" style="margin-bottom:8px;">
            <option value="auto" ${settings.genMode==="auto"?"selected":""}>💬 角色设定 + 最近聊天记录</option>
            <option value="description" ${settings.genMode==="description"?"selected":""}>📄 仅角色描述（不读聊天）</option>
            <option value="worldinfo" ${settings.genMode==="worldinfo"?"selected":""}>🌍 指定世界书条目</option>
            <option value="custom" ${settings.genMode==="custom"?"selected":""}>✏️ 自定义固定文本</option>
          </select>

          <!-- 世界书选择（worldinfo 模式时显示）-->
          <div id="wu-wi-row" style="display:${settings.genMode==="worldinfo"?"block":"none"};margin-bottom:8px;">
            <select id="wu-wi-select" class="wu-select">${wiOptions}</select>
          </div>

          <!-- 自定义文本（custom 模式时显示）-->
          <div id="wu-custom-row" style="display:${settings.genMode==="custom"?"block":"none"};margin-bottom:8px;">
            <input id="wu-custom-text" type="text" class="wu-input" placeholder="输入固定的早安文本…" value="${esc(settings.genCustomText)}">
          </div>

          <!-- 开关：系统闹钟 -->
          <div class="wu-section-label">选项</div>
          <div class="wu-toggle-row">
            <span>同时触发手机系统闹钟</span>
            <label class="wu-toggle">
              <input type="checkbox" id="wu-sys-alarm" ${settings.enableSystemAlarm?"checked":""}>
              <span class="wu-toggle-slider"></span>
            </label>
          </div>
          <div class="wu-toggle-row">
            <span>设定时注入系统消息</span>
            <label class="wu-toggle">
              <input type="checkbox" id="wu-inject" ${settings.confirmInject?"checked":""}>
              <span class="wu-toggle-slider"></span>
            </label>
          </div>

          <!-- 取消提醒 -->
          <div style="margin-top:14px;">
            <button id="wu-cancel-alarm" class="wu-danger-btn">🗑 取消当前提醒</button>
          </div>

          <!-- 状态 & 反馈 -->
          <div class="wu-status-bar">
            <span class="wu-status-dot" id="wu-bridge-dot"></span>
            <span id="wu-bridge-text">检测桥接中…</span>
            <span style="margin-left:auto;opacity:.6;">${statusText}</span>
          </div>
          <div class="wu-msg" id="wu-msg"></div>

        </div>
      </div>
    </div>
  `);

  // 事件绑定
  $overlay.on("click", e => { if (e.target === $overlay[0]) closePanel(); });
  $overlay.find("#wu-close").on("click", closePanel);

  // 快速按钮
  $overlay.find(".wu-quick-btn").on("click", function() {
    const min = $(this).attr("data-min");
    if (min) {
      const ts = Date.now() + parseInt(min, 10) * 60_000;
      scheduleAlarm(ts, `${min}分钟后`);
      sendRoleCache();
      showMsg($overlay, `✓ 已设置 ${min}分钟后提醒`);
      flashFab();
    } else {
      const d = new Date();
      const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, settings.defaultHour, settings.defaultMinute, 0, 0);
      const label = `明天 ${String(settings.defaultHour).padStart(2,"0")}:${String(settings.defaultMinute).padStart(2,"0")}`;
      scheduleAlarm(dt.getTime(), label);
      sendRoleCache();
      showMsg($overlay, `✓ 已设置 ${label} 提醒`);
      flashFab();
    }
  });

  // 自定义时间
  $overlay.find("#wu-set-custom").on("click", () => {
    const v = $overlay.find("#wu-time").val();
    if (!v) return showMsg($overlay, "请先选择时间");
    const [h, m] = v.split(":").map(Number);
    const now = new Date();
    let dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (dt.getTime() <= now.getTime()) dt = new Date(dt.getTime() + 86_400_000);
    const label = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    scheduleAlarm(dt.getTime(), label);
    sendRoleCache();
    showMsg($overlay, `✓ 已设置 ${label} 提醒`);
    flashFab();
    // 更新默认时间
    settings.defaultHour = h;
    settings.defaultMinute = m;
    saveSettings();
  });

  // 角色绑定
  $overlay.find("#wu-char-bind").on("change", function() {
    settings.genCharacter = $(this).val() || "";
    saveSettings();
    syncConfig();
    showMsg($overlay, settings.genCharacter ? `✓ 已绑定：${settings.genCharacter}` : "✓ 已取消角色绑定");
  });

  // 生成方式
  $overlay.find("#wu-gen-mode").on("change", function() {
    settings.genMode = $(this).val() || "auto";
    $overlay.find("#wu-wi-row").toggle(settings.genMode === "worldinfo");
    $overlay.find("#wu-custom-row").toggle(settings.genMode === "custom");
    saveSettings();
    syncConfig();
    showMsg($overlay, "✓ 已切换生成方式");
  });

  // 世界书选择
  $overlay.find("#wu-wi-select").on("change", function() {
    const opt = $(this).find("option:selected");
    settings.genWorldinfoUid = $(this).val() || "";
    settings.genWorldinfoContent = String(opt.data("content") || "");
    saveSettings();
    syncConfig();
    showMsg($overlay, "✓ 已选择世界书条目");
  });

  // 自定义文本
  $overlay.find("#wu-custom-text").on("input", function() {
    settings.genCustomText = $(this).val().trim();
    saveSettings();
  });

  // 开关
  $overlay.find("#wu-sys-alarm").on("change", function() {
    settings.enableSystemAlarm = $(this).is(":checked");
    saveSettings();
  });

  $overlay.find("#wu-inject").on("change", function() {
    settings.confirmInject = $(this).is(":checked");
    saveSettings();
  });

  // 取消提醒
  $overlay.find("#wu-cancel-alarm").on("click", () => {
    cancelAlarm();
    if (settings.confirmInject) injectSystem(settings.cancelText);
    showMsg($overlay, "✓ 已取消提醒");
    $("#wakeup-fab").removeClass("has-alarm");
  });

  $("body").append($overlay);

  // 异步检测桥接状态
  checkBridge().then(ok => {
    $overlay.find("#wu-bridge-dot").toggleClass("online", ok);
    $overlay.find("#wu-bridge-text").text(ok ? "Termux 桥已连接" : "Termux 桥未连接");
  });
}

function closePanel() {
  panelOpen = false;
  $("#wakeup-panel-overlay").remove();
}

function showMsg($overlay, text) {
  const $msg = $overlay.find("#wu-msg");
  $msg.text(text).css("opacity", 1);
  clearTimeout($msg.data("timer"));
  $msg.data("timer", setTimeout(() => $msg.animate({ opacity: 0 }, 800), 2000));
}

function flashFab() {
  $("#wakeup-fab").addClass("has-alarm");
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ============================================================
//  设置存取
// ============================================================
function saveSettings() {
  extension_settings.wakeup = settings;
  saveSettingsDebounced();
}

// ============================================================
//  酒馆扩展设置面板（内嵌 HTML）
// ============================================================
function buildSettingsHtml() {
  return `
<div id="wakeup-settings-root" style="padding:4px 0;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
    <span style="font-size:22px;">⏰</span>
    <div>
      <div style="font-weight:600;font-size:14px;">Wake-Up Call</div>
      <div style="font-size:11px;opacity:.6;">v2.0 — Termux 唤醒提醒扩展</div>
    </div>
    <div style="margin-left:auto;font-size:11px;">
      <span class="wu-status-dot" id="wakeup-bridge-dot"></span>
      <span id="wakeup-bridge-status">检测中…</span>
    </div>
  </div>

  <div class="wakeup-settings-section">
    <div class="wakeup-settings-label">🔗 Termux 桥接</div>
    <div style="display:grid;gap:8px;">
      <div>
        <label style="font-size:12px;opacity:.7;">桥接地址</label>
        <input id="wakeup-bridge-url" type="text" class="text_pole" placeholder="http://127.0.0.1:8765">
      </div>
      <div>
        <label style="font-size:12px;opacity:.7;">桥接密钥</label>
        <input id="wakeup-bridge-key" type="text" class="text_pole" placeholder="wake-2026">
      </div>
      <button id="wakeup-check-bridge" class="menu_button" style="font-size:12px;">检测连接状态</button>
    </div>
  </div>

  <div class="wakeup-settings-section">
    <div class="wakeup-settings-label">⏰ 默认叫醒时间（说"晚安"时使用）</div>
    <div style="display:flex;gap:10px;align-items:center;">
      <input id="wakeup-hour" type="number" class="text_pole" min="0" max="23" style="width:70px;" placeholder="7">
      <span style="opacity:.6;">时</span>
      <input id="wakeup-minute" type="number" class="text_pole" min="0" max="59" style="width:70px;" placeholder="30">
      <span style="opacity:.6;">分</span>
    </div>
  </div>

  <div class="wakeup-settings-section">
    <div class="wakeup-settings-label">🎭 角色绑定 & 生成方式</div>
    <div style="display:grid;gap:8px;">
      <div>
        <label style="font-size:12px;opacity:.7;">绑定角色（仅在此角色对话中触发）</label>
        <select id="wakeup-gen-character" class="text_pole">
          <option value="">— 不绑定（全局生效）—</option>
        </select>
      </div>
      <div>
        <label style="font-size:12px;opacity:.7;">生成方式</label>
        <select id="wakeup-gen-mode" class="text_pole">
          <option value="auto">💬 角色设定 + 最近聊天记录</option>
          <option value="description">📄 仅角色描述（不读聊天）</option>
          <option value="worldinfo">🌍 指定世界书条目</option>
          <option value="custom">✏️ 自定义固定文本</option>
        </select>
      </div>
      <div id="wakeup-wi-row">
        <label style="font-size:12px;opacity:.7;">世界书条目</label>
        <select id="wakeup-gen-worldinfo" class="text_pole">
          <option value="">— 选择条目 —</option>
        </select>
      </div>
      <div id="wakeup-custom-row">
        <label style="font-size:12px;opacity:.7;">自定义文本</label>
        <input id="wakeup-gen-custom" type="text" class="text_pole" placeholder="早上好～新的一天开始啦">
      </div>
    </div>
  </div>

  <div class="wakeup-settings-section">
    <div class="wakeup-settings-label">💬 系统消息文本</div>
    <div style="display:grid;gap:8px;">
      <div>
        <label style="font-size:12px;opacity:.7;">设定提醒时注入（{time} = 目标时间）</label>
        <input id="wakeup-confirm-text" type="text" class="text_pole">
      </div>
      <div>
        <label style="font-size:12px;opacity:.7;">取消提醒时注入</label>
        <input id="wakeup-cancel-text" type="text" class="text_pole">
      </div>
      <div>
        <label style="font-size:12px;opacity:.7;">到点醒来时注入</label>
        <input id="wakeup-wake-text" type="text" class="text_pole">
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
        <input type="checkbox" id="wakeup-confirm">
        设定/取消时注入系统消息
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
        <input type="checkbox" id="wakeup-sys-alarm">
        同时触发手机系统闹钟
      </label>
    </div>
  </div>

  <div class="wakeup-settings-section">
    <div class="wakeup-settings-label">⚙️ 生效范围</div>
    <select id="wakeup-mode" class="text_pole" style="margin-bottom:8px;">
      <option value="all">全部对话</option>
      <option value="whitelist">仅白名单角色</option>
      <option value="off">停用</option>
    </select>
    <div id="wakeup-whitelist-row">
      <label style="font-size:12px;opacity:.7;">白名单角色名（逗号分隔）</label>
      <input id="wakeup-whitelist" type="text" class="text_pole" placeholder="角色A, 角色B">
    </div>
  </div>

  <div style="display:flex;gap:8px;margin-top:4px;">
    <button id="wakeup-save" class="menu_button" style="flex:1;">💾 保存并同步</button>
  </div>
</div>
  `;
}

// ============================================================
//  初始化
// ============================================================
jQuery(async () => {
  // 加载已保存设置
  if (extension_settings.wakeup) {
    settings = { ...defaultSettings, ...extension_settings.wakeup };
  }

  // 注入 CSS
  if (!$("#wakeup-styles").length) {
    $("head").append(`<style id="wakeup-styles">${getStyles()}</style>`);
  }

  // 悬浮按钮（最优先，保证总可见）
  addFloatingButton();

  // 酒馆扩展设置面板
  const $extSettings = $("#extensions_settings");
  if ($extSettings.length) {
    $extSettings.append(buildSettingsHtml());
    initSettingsPanel();
  }

  // 监听用户消息
  eventSource.on(event_types.MESSAGE_SENT, handleUserMessage);

  // 启动时检查一次到点事件，之后每 60 秒轮询
  consumeWakeEvent();
  setInterval(consumeWakeEvent, 60_000);
});

// ============================================================
//  设置面板交互初始化
// ============================================================
function initSettingsPanel() {
  const ctx = getCtx();

  // 填充当前值
  $("#wakeup-bridge-url").val(settings.bridgeUrl);
  $("#wakeup-bridge-key").val(settings.bridgeKey);
  $("#wakeup-hour").val(settings.defaultHour);
  $("#wakeup-minute").val(settings.defaultMinute);
  $("#wakeup-confirm").prop("checked", settings.confirmInject);
  $("#wakeup-sys-alarm").prop("checked", settings.enableSystemAlarm);
  $("#wakeup-confirm-text").val(settings.confirmText);
  $("#wakeup-cancel-text").val(settings.cancelText);
  $("#wakeup-wake-text").val(settings.wakeText);
  $("#wakeup-mode").val(settings.mode);
  $("#wakeup-whitelist").val(settings.whitelist.join(", "));
  $("#wakeup-gen-mode").val(settings.genMode);
  $("#wakeup-gen-custom").val(settings.genCustomText);

  updateSettingsVisibility();

  // 角色列表
  const $charSel = $("#wakeup-gen-character");
  (ctx?.characters || []).forEach(c => {
    if (c?.name) $charSel.append($("<option>").val(c.name).text(c.name));
  });
  $charSel.val(settings.genCharacter || "");

  // 世界书列表
  const $wiSel = $("#wakeup-gen-worldinfo");
  getWorldInfoEntries().forEach(en => {
    const uid = String(en.uid ?? en.id ?? "");
    const label = [en.comment, en.key].filter(Boolean).join("·") || `条目${uid}`;
    $wiSel.append(
      $("<option>")
        .val(uid)
        .text(String(label).slice(0, 60))
        .data("content", String(en.content || "").slice(0, 2000))
    );
  });
  $wiSel.val(settings.genWorldinfoUid || "");

  // 桥接状态
  checkBridge().then(ok => {
    $("#wakeup-bridge-dot").toggleClass("online", ok);
    $("#wakeup-bridge-status").text(ok ? "已连接" : "未连接");
  });

  // 生效范围切换
  $("#wakeup-mode").on("change", updateSettingsVisibility);
  $("#wakeup-gen-mode").on("change", updateSettingsVisibility);

  // 检测按钮
  $("#wakeup-check-bridge").on("click", async () => {
    $("#wakeup-bridge-status").text("检测中…");
    const ok = await checkBridge();
    $("#wakeup-bridge-dot").toggleClass("online", ok);
    $("#wakeup-bridge-status").text(ok ? "已连接" : "未连接");
  });

  // 保存
  $("#wakeup-save").on("click", async () => {
    settings.bridgeUrl = $("#wakeup-bridge-url").val().trim() || defaultSettings.bridgeUrl;
    settings.bridgeKey = $("#wakeup-bridge-key").val().trim() || defaultSettings.bridgeKey;
    settings.defaultHour = Math.min(23, Math.max(0, parseInt($("#wakeup-hour").val(), 10) || 7));
    settings.defaultMinute = Math.min(59, Math.max(0, parseInt($("#wakeup-minute").val(), 10) || 30));
    settings.confirmInject = $("#wakeup-confirm").is(":checked");
    settings.enableSystemAlarm = $("#wakeup-sys-alarm").is(":checked");
    settings.confirmText = $("#wakeup-confirm-text").val().trim() || defaultSettings.confirmText;
    settings.cancelText = $("#wakeup-cancel-text").val().trim() || defaultSettings.cancelText;
    settings.wakeText = $("#wakeup-wake-text").val().trim() || defaultSettings.wakeText;
    settings.mode = $("#wakeup-mode").val() || "all";
    settings.whitelist = ($("#wakeup-whitelist").val() || "").split(/[,，]/).map(s => s.trim()).filter(Boolean);
    settings.genMode = $("#wakeup-gen-mode").val() || "auto";
    settings.genCustomText = $("#wakeup-gen-custom").val().trim();
    settings.genCharacter = $("#wakeup-gen-character").val() || "";
    const wiOpt = $("#wakeup-gen-worldinfo option:selected");
    settings.genWorldinfoUid = wiOpt.val() || "";
    settings.genWorldinfoContent = String(wiOpt.data("content") || "");

    saveSettings();
    const synced = await syncConfig();

    if (typeof toastr !== "undefined") {
      toastr[synced ? "success" : "warning"](
        synced ? "设置已保存并同步到 Termux ✓" : "设置已保存（桥未连接，稍后再同步）"
      );
    }
  });
}

function updateSettingsVisibility() {
  const mode = $("#wakeup-mode").val();
  const genMode = $("#wakeup-gen-mode").val();
  $("#wakeup-whitelist-row").toggle(mode === "whitelist");
  $("#wakeup-wi-row").toggle(genMode === "worldinfo");
  $("#wakeup-custom-row").toggle(genMode === "custom");
}
