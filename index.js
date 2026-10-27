// ============================================================
//  Wake-Up Call v6.2.1 — SillyTavern 独立扩展
//  UI：底部固定按钮 + 居中模态弹窗（遮罩 + 关闭按钮）
//  修复：CSS 由 JS 内联注入（不依赖 manifest css 字段）
//  修复：按钮位置上移，避开 SillyDroid 悬浮控件
// ============================================================
(function () {
  "use strict";

  var DEBUG = false; // 改成 true 可开启 alert 调试弹窗
  function dbg(msg) { if (DEBUG) alert(msg); }

  /* ═══════════════════════════════════════════════════════════
   *  CSS 内联注入（双保险：即使 manifest 的 css 不被加载也能生效）
   * ═══════════════════════════════════════════════════════════ */
  var WUC_CSS = [
    "#wuc-fab{position:fixed;right:16px;width:56px;height:56px;border-radius:50%;background:rgba(135,206,235,.45);color:#fff;border:1px solid rgba(255,255,255,.6);font-size:26px;cursor:pointer;z-index:2147483647;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(12px) saturate(140%);backdrop-filter:blur(12px) saturate(140%);touch-action:none;-webkit-user-select:none;user-select:none}",
    "#wuc-fab:active{filter:brightness(1.08)}",
    ".wuc-fab-dot{position:absolute;top:2px;right:2px;width:12px;height:12px;border-radius:50%;background:#ffeb3b;border:2px solid #fff}",
    ".wuc-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647}",
    ".wuc-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,420px);max-height:82vh;overflow-y:auto;background:var(--SmartThemeBlurTintColor,#1e222a);color:var(--SmartThemeBodyColor,#ddd);border:1px solid var(--SmartThemeBorderColor,#444);border-radius:12px;padding:14px;z-index:2147483647;box-shadow:0 8px 32px rgba(0,0,0,.6);font-size:14px;display:flex;flex-direction:column;gap:10px}",
    ".wuc-modal-header{display:flex;align-items:center;justify-content:space-between;font-size:16px;font-weight:600;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.12)}",
    ".wuc-close-btn{background:transparent;border:none;color:inherit;font-size:18px;cursor:pointer;padding:4px 8px;border-radius:6px}",
    ".wuc-close-btn:hover{background:rgba(255,255,255,.12)}",
    ".wuc-status-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.06);font-size:13px}",
    ".wuc-status-bar.wuc-armed{background:rgba(76,175,80,.18)}",
    ".wuc-mini-btn{background:rgba(255,255,255,.12);color:inherit;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}",
    ".wuc-mini-btn:disabled{opacity:.4;cursor:not-allowed}",
    ".wuc-quick-row{display:flex;gap:6px;flex-wrap:wrap}",
    ".wuc-q{flex:1 1 auto;background:rgba(255,255,255,.1);color:inherit;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:7px 6px;font-size:12px;cursor:pointer;white-space:nowrap}",
    ".wuc-q:hover,.wuc-q:active{background:rgba(255,255,255,.2)}",
    ".wuc-row{display:flex;gap:8px;align-items:center}",
    ".wuc-row input[type=time]{flex:1}",
    ".wuc-field{display:flex;flex-direction:column;gap:4px}",
    ".wuc-field label{font-size:12px;opacity:.75}",
    ".wuc-inp,.wuc-sel,.wuc-ta,.wuc-row input[type=time],.wuc-field input[type=time]{background:rgba(0,0,0,.25);color:inherit;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:7px 9px;font-size:13px;width:100%;box-sizing:border-box}",
    ".wuc-ta{resize:vertical;min-height:44px}",
    ".wuc-switch-row{flex-direction:row;align-items:center;justify-content:space-between;gap:8px}",
    ".wuc-switch-row>span{font-size:13px}",
    ".wuc-sw{position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0}",
    ".wuc-sw input{opacity:0;width:0;height:0}",
    ".wuc-sl{position:absolute;inset:0;background:rgba(255,255,255,.2);border-radius:22px;cursor:pointer;transition:.2s}",
    ".wuc-sl::before{content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}",
    ".wuc-sw input:checked+.wuc-sl{background:#4caf50}",
    ".wuc-sw input:checked+.wuc-sl::before{transform:translateX(18px)}",
    ".wuc-footer{display:flex;align-items:center;gap:8px;margin-top:4px}",
    ".wuc-tip{flex:1;font-size:12px;min-height:16px}",
    ".wuc-tip.wuc-ok{color:#4caf50}",
    ".wuc-tip.wuc-err{color:#ef5350}",
    ".wuc-primary-btn,.wuc-sec-btn{border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;white-space:nowrap}",
    ".wuc-primary-btn{background:#4caf50;color:#fff}",
    ".wuc-sec-btn{background:rgba(255,255,255,.12);color:inherit}",
    ".wuc-primary-btn:hover{background:#43a047}"
  ].join("\n");

  function injectCSS() {
    if (document.getElementById("wuc-style")) return;
    var st = document.createElement("style");
    st.id = "wuc-style";
    st.textContent = WUC_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

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
    var f = window.saveSettingsDebounced ?? window.parent?.saveSettingsDebounced;
    if (typeof f === "function") f();
  }
  function getEventSource() { var ctx = getCtx(); return ctx?.eventSource ?? window.eventSource ?? null; }
  function getEventTypes()  { var ctx = getCtx(); return ctx?.event_types ?? window.event_types ?? window.tavern_events ?? {}; }
  function toast(msg, type) {
    try { var t = window.toastr ?? window.parent?.toastr; if (t?.[type || "info"]) t[type || "info"](msg); } catch (e) {}
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  /* ═══════════════════════════════════════════════════════════
   *  设置
   * ═══════════════════════════════════════════════════════════ */
  var DEFAULTS = {
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
    wakeMessage: "（系统：叫醒时间到了，{{char}} 的提醒已触发～）"
  };
  var cfg = {};
  function loadCfg() { var e = getExtSettings(); cfg = e.wakeUpCall ? Object.assign({}, DEFAULTS, e.wakeUpCall) : Object.assign({}, DEFAULTS); }
  function saveCfg() { var e = getExtSettings(); e.wakeUpCall = Object.assign({}, cfg); doSaveSettings(); }

  /* ═══════════════════════════════════════════════════════════
   *  时间解析
   * ═══════════════════════════════════════════════════════════ */
  var CN = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function parseCN(s) {
    if (!s) return NaN;
    s = String(s).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var total = 0, cur = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], v = CN[ch];
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
    var m = t.match(/([0-9零一二两三四五六七八九十百]+)\s*分钟?后/);
    if (m) { var n = parseCN(m[1]); if (!isNaN(n) && n > 0) return n; }
    m = t.match(/([0-9零一二两三四五六七八九十]+)\s*(?:个)?(?:小时|钟头)后/);
    if (m) { var n2 = parseCN(m[1]); if (!isNaN(n2) && n2 > 0) return n2 * 60; }
    return null;
  }
  function parseAbsolute(t) {
    var dayOffset = 0;
    if (/明天|明早|明晚/.test(t)) dayOffset = 1;
    else if (/后天/.test(t)) dayOffset = 2;
    var period = null;
    if (/晚上|晚间|夜里|深夜/.test(t)) period = "night";
    else if (/下午|傍晚/.test(t)) period = "pm";
    else if (/早上|早晨|清晨|上午/.test(t)) period = "am";
    var re = /([0-9零一二两三四五六七八九十]+)(?::(\d{1,2})|[点时]([0-9零一二两三四五六七八九十]+)分?|[点时](半)?)/;
    var m = t.match(re);
    if (!m) return null;
    var hour = parseCN(m[1]), minute = 0;
    if (m[2] !== undefined) minute = parseInt(m[2], 10);
    else if (m[3] !== undefined) minute = parseCN(m[3]);
    else if (m[4]) minute = 30;
    if (isNaN(hour) || isNaN(minute)) return null;
    if (period === "night" && hour < 12) hour += 12;
    if (period === "pm" && hour < 8) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
    return { hour: hour, minute: minute, dayOffset: dayOffset };
  }
  function parseTimeCommand(text) {
    var t = String(text || "").replace(/[。！？，、\s]/g, "");
    if (/取消(提醒|闹钟|叫醒|定时)/.test(t)) return { cancel: true };
    if (/提醒|叫醒?我|叫我/.test(t)) {
      var mins = parseRelative(t);
      if (mins !== null) return { ts: Date.now() + mins * 60000, label: mins + "分钟后" };
    }
    if (/叫醒?我?|叫我|提醒我?|起床|明天|明早|后天/.test(t)) {
      var abs = parseAbsolute(t);
      if (abs) {
        var now = new Date();
        var dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + abs.dayOffset, abs.hour, abs.minute, 0, 0);
        if (dt.getTime() <= Date.now()) dt = new Date(dt.getTime() + 86400000);
        return { ts: dt.getTime(), label: (dt.getMonth() + 1) + "/" + dt.getDate() + " " + pad(abs.hour) + ":" + pad(abs.minute) };
      }
    }
    if (/晚安|睡了|睡觉|就寝|去睡/.test(t)) {
      var d2 = new Date();
      d2.setDate(d2.getDate() + 1);
      d2.setHours(cfg.defaultHour, cfg.defaultMinute, 0, 0);
      return { ts: d2.getTime(), label: "明天 " + pad(cfg.defaultHour) + ":" + pad(cfg.defaultMinute) };
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════════════
   *  提醒状态
   * ═══════════════════════════════════════════════════════════ */
  var currentAlarm = null, localTimer = null;

  function setAlarm(ts, label) {
    clearAlarm(false);
    var delay = ts - Date.now();
    if (delay < 500) return;
    localTimer = setTimeout(onAlarmFire, delay);
    currentAlarm = { ts: ts, label: label };
    refreshStatus();
    dbg("[WUC] 设置提醒：" + label + "（" + Math.round(delay / 1000) + "s 后）");
  }
  function clearAlarm(showToast) {
    if (localTimer) { clearTimeout(localTimer); localTimer = null; }
    currentAlarm = null;
    refreshStatus();
    if (showToast) toast("已取消提醒");
  }
  function onAlarmFire() {
    localTimer = null; currentAlarm = null; refreshStatus();
    buildWakeMessage().then(injectSystemMessage);
  }

  /* ═══════════════════════════════════════════════════════════
   *  Termux 桥接
   * ═══════════════════════════════════════════════════════════ */
  function bridgeSchedule(ts, label) {
    return fetch(cfg.bridgeUrl + "/schedule?key=" + encodeURIComponent(cfg.bridgeKey) + "&ts=" + ts + "&text=" + encodeURIComponent(label) + "&alarm=" + (cfg.enableAlarm ? 1 : 0), { signal: AbortSignal.timeout(4000) })
      .then(function (r) { return r.json(); })
      .then(function (j) { return j.ok === true; })
      .catch(function () { return false; });
  }
  function bridgeCancel() {
    return fetch(cfg.bridgeUrl + "/cancel?key=" + encodeURIComponent(cfg.bridgeKey), { signal: AbortSignal.timeout(3000) }).catch(function () {});
  }
  function bridgePing() {
    return fetch(cfg.bridgeUrl + "/ping", { signal: AbortSignal.timeout(3000) })
      .then(function (r) { return r.json(); })
      .then(function (j) { return j.ok === true; })
      .catch(function () { return false; });
  }
  function pollBridgeEvent() {
    fetch(cfg.bridgeUrl + "/event?key=" + encodeURIComponent(cfg.bridgeKey), { signal: AbortSignal.timeout(3000) })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) {
        if (j.ok && j.text) {
          return fetch(cfg.bridgeUrl + "/event-consume?key=" + encodeURIComponent(cfg.bridgeKey), { signal: AbortSignal.timeout(3000) })
            .then(function () { injectSystemMessage(j.text); });
        }
      })
      .catch(function () {});
  }

  /* ═══════════════════════════════════════════════════════════
   *  消息生成 & 注入
   * ═══════════════════════════════════════════════════════════ */
  function buildWakeMessage() {
    if (cfg.genMode === "custom") return Promise.resolve(cfg.genCustomText || "早安～");
    var ctx = getCtx();
    var charName = "角色";
    try { charName = ctx?.characters?.[ctx?.characterId]?.name || "角色"; } catch (e) {}
    var now = new Date();
    var timeStr = pad(now.getHours()) + ":" + pad(now.getMinutes());
    var prompt = "你是" + charName + "，用角色口吻写不超过60字的晨间问候，语气自然温柔，不要括号动作描述。现在时间" + timeStr + "。";
    if (cfg.genMode === "worldbook" && cfg.genWorldbookContent) prompt += "\n世界观背景：\n" + cfg.genWorldbookContent;
    return new Promise(function (resolve) {
      try {
        var gqp = window.generateQuietPrompt ?? window.parent?.generateQuietPrompt;
        if (typeof gqp === "function") {
          gqp(prompt, false, false, "", true, 60).then(function (r) {
            resolve(r?.trim() ? r.trim() : applyTemplate());
          }).catch(function () { resolve(applyTemplate()); });
          return;
        }
      } catch (e) {}
      resolve(applyTemplate());
    });
    function applyTemplate() {
      return (cfg.wakeMessage || "（系统：叫醒时间到了～）")
        .replace(/\{\{char\}\}/g, charName)
        .replace(/\{\{time\}\}/g, timeStr);
    }
  }

  function injectSystemMessage(text) {
    try {
      var ssm = window.sendSystemMessage ?? window.parent?.sendSystemMessage;
      if (typeof ssm === "function") { ssm("generic", text, {}); return; }
      var ctx = getCtx();
      if (typeof ctx?.addOneMessage === "function") { ctx.addOneMessage({ name: "System", mes: text, is_system: true }); return; }
      var ts = window.triggerSlash ?? window.parent?.triggerSlash;
      if (typeof ts === "function") ts("/sys " + text);
    } catch (e) { console.error("[WUC]", e); }
  }

  /* ═══════════════════════════════════════════════════════════
   *  用户消息处理
   * ═══════════════════════════════════════════════════════════ */
  function isCharBound() {
    if (!cfg.boundCharName) return true;
    try { return (getCtx()?.characters?.[getCtx()?.characterId]?.name ?? "") === cfg.boundCharName; } catch (e) { return true; }
  }
  function handleMessage(data) {
    if (!isCharBound()) return;
    var text = "";
    if (typeof data === "string") text = data;
    else if (data?.mes) text = data.mes;
    else if (typeof data === "number") { try { text = getCtx()?.chat?.[data]?.mes ?? ""; } catch (e) {} }
    if (!text) return;
    var result = parseTimeCommand(text);
    if (!result) return;

    dbg("[WUC] 识别到时间指令：" + text.trim().slice(0, 30));

    if (result.cancel) {
      clearAlarm(true); bridgeCancel();
      injectSystemMessage("（系统：已取消提醒～）");
      return;
    }
    setAlarm(result.ts, result.label);
    bridgeSchedule(result.ts, result.label).then(function (ok) {
      injectSystemMessage("（系统：已设置 " + result.label + " 的提醒，晚安～" + (ok ? " [桥接✓]" : "") + "）");
    });
  }

  /* ═══════════════════════════════════════════════════════════
   *  UI — 底部固定按钮 + 居中模态弹窗
   * ═══════════════════════════════════════════════════════════ */
  function refreshStatus() {
    var dot = document.getElementById("wuc-fab-dot");
    if (dot) dot.style.display = currentAlarm ? "block" : "none";
    var statusEl = document.getElementById("wuc-status-text");
    var cancelBtn = document.getElementById("wuc-cancel-btn");
    var bar = document.getElementById("wuc-status-bar");
    if (!statusEl) return;
    if (currentAlarm) {
      statusEl.textContent = "⏰ " + currentAlarm.label;
      bar.className = "wuc-status-bar wuc-armed";
      cancelBtn.disabled = false;
    } else {
      statusEl.textContent = "💤 暂无提醒";
      bar.className = "wuc-status-bar";
      cancelBtn.disabled = true;
    }
  }

  function mountFab() {
    if (document.getElementById("wuc-fab")) return;
    injectCSS();
    var fab = document.createElement("button");
    fab.id = "wuc-fab";
    fab.type = "button";
    fab.title = "Wake-Up Call";
    fab.style.cssText = "position:fixed!important;right:16px!important;left:auto!important;top:calc(100vh - 152px)!important;bottom:auto!important;z-index:2147483647!important;width:56px;height:56px;border-radius:50%;background:rgba(135,206,235,.45)!important;color:#fff!important;border:1px solid rgba(255,255,255,.6)!important;font-size:26px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.25)!important;cursor:pointer;margin:0;padding:0;line-height:1;-webkit-tap-highlight-color:transparent;-webkit-backdrop-filter:blur(12px) saturate(140%)!important;backdrop-filter:blur(12px) saturate(140%)!important;touch-action:none!important;-webkit-user-select:none!important;user-select:none!important;";
    fab.innerHTML = '<span>🔔</span><span id="wuc-fab-dot" class="wuc-fab-dot" style="display:none"></span>';
    fab.addEventListener("click", function (e) {
      if (fab.dataset.wucNoClick === "1") { e.preventDefault(); return; }
      try {
        if (document.getElementById("wuc-modal-root")) closeModal(); else openModal();
      } catch (err) {
        alert("[WUC-ERR] 打开面板失败: " + (err && err.message ? err.message : err));
        console.error("[WUC]", err);
      }
    });
    bindFabDrag(fab);
    document.body.appendChild(fab);
    console.log("[WUC] FAB mounted");
  }

  function bindFabDrag(fab) {
    var st = null;
    function vw() { return window.innerWidth || 400; }
    function vh() { return window.innerHeight || 800; }
    function clampX(v, w) { return Math.max(8, Math.min(vw() - w - 8, v)); }
    function clampY(v, h) { return Math.max(8, Math.min(vh() - h - 8, v)); }
    function setBase(xPx, yPx) {
      fab.style.left = (xPx / vw() * 100) + "vw";
      fab.style.top = (yPx / vh() * 100) + "vh";
      fab.style.right = "auto";
      fab.style.bottom = "auto";
    }
    function onMove(e) {
      if (!st) return;
      var dx = e.clientX - st.sx, dy = e.clientY - st.sy;
      if (!st.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) st.moved = true;
      if (!st.moved) return;
      if (e.cancelable) e.preventDefault();
      st.dx = dx; st.dy = dy;
      fab.style.transform = "translate3d(" + dx + "px," + dy + "px,0)";
    }
    function onUp(e) {
      if (!st) return;
      var moved = st.moved;
      var dx = st.dx || 0, dy = st.dy || 0;
      var w = st.w, h = st.h;
      var vx = clampX(st.ox + dx, w), vy = clampY(st.oy + dy, h);
      // 先把基础位置钉在当前视觉位置，同时去掉 transform（同步块内不会闪跳）
      fab.style.transform = "none";
      fab.style.willChange = "auto";
      setBase(vx, vy);
      // 计算吸附目标
      var cx = vx + w / 2;
      var snapRight = cx >= vw() / 2;
      var ty = clampY(vy, h);
      var tx = snapRight ? (vw() - w - 8) : 8;
      // 强制 reflow 后启用过渡，做一次短平滑吸附
      void fab.offsetWidth;
      fab.style.transition = "left .22s cubic-bezier(.2,.7,.3,1), top .22s cubic-bezier(.2,.7,.3,1)";
      setBase(tx, ty);
      st = null;
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
      // 吸附结束后恢复磨砂（避免拖动时毛玻璃每帧重渲染造成卡顿）
      setTimeout(function () {
        fab.style.transition = "none";
        fab.style.willChange = "auto";
        fab.style.webkitBackdropFilter = "blur(12px) saturate(140%)";
        fab.style.backdropFilter = "blur(12px) saturate(140%)";
      }, 260);
      if (moved) {
        fab.dataset.wucNoClick = "1";
        setTimeout(function () { fab.dataset.wucNoClick = "0"; }, 300);
      }
    }
    function onCancel() {
      fab.style.transform = "none";
      fab.style.willChange = "auto";
      fab.style.webkitBackdropFilter = "blur(12px) saturate(140%)";
      fab.style.backdropFilter = "blur(12px) saturate(140%)";
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
      st = null;
    }
    fab.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var r = fab.getBoundingClientRect();
      st = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, w: r.width, h: r.height, moved: false, dx: 0, dy: 0 };
      // 拖动期间：关毛玻璃、开 GPU 合成，消除卡顿源
      fab.style.transition = "none";
      fab.style.willChange = "transform";
      fab.style.webkitBackdropFilter = "none";
      fab.style.backdropFilter = "none";
      document.addEventListener("pointermove", onMove, { capture: true, passive: false });
      document.addEventListener("pointerup", onUp, { capture: true, passive: false });
      document.addEventListener("pointercancel", onCancel, { capture: true, passive: false });
    });
  }

  function openModal() {
    if (document.getElementById("wuc-modal-root")) return;
    loadCfg();
    injectCSS();
    var ctx = getCtx();
    var chars = ctx?.characters ?? [];
    var wbEntries = getWbEntries();

    var root = document.createElement("div");
    root.id = "wuc-modal-root";
    root.innerHTML =
      '<div id="wuc-mask" class="wuc-mask"></div>' +
      '<div id="wuc-modal" class="wuc-modal" role="dialog" aria-modal="true">' +
        '<div class="wuc-modal-header"><span>🔔 Wake-Up Call</span><button id="wuc-close-btn" class="wuc-close-btn" type="button">✕</button></div>' +
        '<div id="wuc-status-bar" class="wuc-status-bar ' + (currentAlarm ? "wuc-armed" : "") + '">' +
          '<span id="wuc-status-text">' + (currentAlarm ? "⏰ " + currentAlarm.label : "💤 暂无提醒") + "</span>" +
          '<button id="wuc-cancel-btn" class="wuc-mini-btn" ' + (currentAlarm ? "" : "disabled") + ">取消</button>" +
        "</div>" +
        '<div class="wuc-quick-row">' +
          '<button class="wuc-q" data-min="15">15分钟后</button>' +
          '<button class="wuc-q" data-min="30">30分钟后</button>' +
          '<button class="wuc-q" data-min="60">1小时后</button>' +
          '<button class="wuc-q" data-tomorrow="1">明早 ' + pad(cfg.defaultHour) + ":" + pad(cfg.defaultMinute) + "</button>" +
        "</div>" +
        '<div class="wuc-row">' +
          '<input type="time" id="wuc-timepick" value="' + pad(cfg.defaultHour) + ":" + pad(cfg.defaultMinute) + '">' +
          '<button id="wuc-set-btn" class="wuc-primary-btn">设定时间</button>' +
        "</div>" +
        '<div class="wuc-field"><label>说「晚安」时的默认唤醒时间</label>' +
          '<input type="time" id="wuc-deftime" value="' + pad(cfg.defaultHour) + ":" + pad(cfg.defaultMinute) + '"></div>' +
        '<div class="wuc-field wuc-switch-row"><span>同时触发手机系统闹钟（需 Termux 桥）</span>' +
          '<label class="wuc-sw"><input type="checkbox" id="wuc-alarm-sw" ' + (cfg.enableAlarm ? "checked" : "") + '><span class="wuc-sl"></span></label></div>' +
        '<div class="wuc-field"><label>角色绑定（留空=全局）</label>' +
          '<select id="wuc-char-sel" class="wuc-sel"><option value="">— 全局触发 —</option>' +
          chars.map(function (c) { return '<option value="' + c.name + '" ' + (cfg.boundCharName === c.name ? "selected" : "") + ">" + c.name + "</option>"; }).join("") +
          "</select></div>" +
        '<div class="wuc-field"><label>唤醒消息生成方式</label>' +
          '<select id="wuc-gen-sel" class="wuc-sel">' +
            '<option value="history" ' + (cfg.genMode === "history" ? "selected" : "") + ">角色设定 + 聊天记录</option>" +
            '<option value="descOnly" ' + (cfg.genMode === "descOnly" ? "selected" : "") + ">仅角色描述</option>" +
            '<option value="worldbook" ' + (cfg.genMode === "worldbook" ? "selected" : "") + ">世界书条目</option>" +
            '<option value="custom" ' + (cfg.genMode === "custom" ? "selected" : "") + ">自定义固定回复</option>" +
          "</select></div>" +
        '<div id="wuc-wb-row" class="wuc-field" style="display:' + (cfg.genMode === "worldbook" ? "block" : "none") + '">' +
          "<label>世界书条目</label>" +
          '<select id="wuc-wb-sel" class="wuc-sel"><option value="">— 选择条目 —</option>' +
          wbEntries.map(function (e) {
            return '<option value="' + e.uid + '" data-content="' + String(e.content || "").replace(/"/g, "&quot;") + '" ' + (cfg.genWorldbookUid === e.uid ? "selected" : "") + ">" + e.label + "</option>";
          }).join("") +
          "</select></div>" +
        '<div id="wuc-custom-row" class="wuc-field" style="display:' + (cfg.genMode === "custom" ? "block" : "none") + '">' +
          "<label>自定义唤醒回复</label>" +
          '<textarea id="wuc-custom-ta" class="wuc-ta" rows="2"></textarea></div>' +
        '<div class="wuc-field"><label>系统消息模板（支持 {{char}} {{time}}）</label>' +
          '<textarea id="wuc-msg-ta" class="wuc-ta" rows="2"></textarea></div>' +
        '<div class="wuc-field"><label>Termux 桥接地址</label>' +
          '<input type="text" id="wuc-bridge-url" class="wuc-inp"></div>' +
        '<div class="wuc-field"><label>桥接密钥</label>' +
          '<input type="text" id="wuc-bridge-key" class="wuc-inp"></div>' +
        '<div class="wuc-footer">' +
          '<span id="wuc-msg-tip" class="wuc-tip"></span>' +
          '<button id="wuc-test-btn" class="wuc-sec-btn">测试桥接</button>' +
          '<button id="wuc-save-btn" class="wuc-primary-btn">保存</button>' +
        "</div>" +
      "</div>";

    document.body.appendChild(root);
    var _mask = root.querySelector("#wuc-mask");
    var _modal = root.querySelector("#wuc-modal");
    if (_mask) _mask.style.cssText = "position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;background:rgba(0,0,0,.55)!important;z-index:2147483646!important;";
    if (_modal) _modal.style.cssText = "position:fixed!important;left:50vw!important;top:50vh!important;transform:translate(-50%,-50%)!important;width:min(92vw,420px)!important;max-height:86vh!important;overflow-y:auto!important;background:#1f2430!important;color:#e6e6e6!important;border-radius:16px!important;z-index:2147483647!important;padding:16px!important;box-sizing:border-box!important;box-shadow:0 10px 40px rgba(0,0,0,.5)!important;";
    // 填充含特殊字符的值（避免 innerHTML 转义问题）
    root.querySelector("#wuc-custom-ta").value = cfg.genCustomText;
    root.querySelector("#wuc-msg-ta").value = cfg.wakeMessage;
    root.querySelector("#wuc-bridge-url").value = cfg.bridgeUrl;
    root.querySelector("#wuc-bridge-key").value = cfg.bridgeKey;

    bindModalEvents(root);
    dbg("[WUC] 弹窗已创建");
  }

  function closeModal() {
    var root = document.getElementById("wuc-modal-root");
    if (root) root.remove();
    dbg("[WUC] 弹窗已关闭");
  }

  function setTip(text, isErr) {
    var el = document.getElementById("wuc-msg-tip");
    if (!el) return;
    el.textContent = text;
    el.className = "wuc-tip " + (isErr ? "wuc-err" : "wuc-ok");
    setTimeout(function () { el.textContent = ""; el.className = "wuc-tip"; }, 3000);
  }

  function bindModalEvents(root) {
    root.querySelector("#wuc-close-btn").addEventListener("click", closeModal);
    root.querySelector("#wuc-mask").addEventListener("click", closeModal);

    root.querySelector("#wuc-cancel-btn").addEventListener("click", function () {
      clearAlarm(true); bridgeCancel();
      injectSystemMessage("（系统：已取消提醒～）");
    });

    root.querySelectorAll(".wuc-q").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ts, label;
        if (btn.dataset.min) {
          var m = parseInt(btn.dataset.min, 10);
          ts = Date.now() + m * 60000; label = m + "分钟后";
        } else {
          var dt = new Date(); dt.setDate(dt.getDate() + 1);
          dt.setHours(cfg.defaultHour, cfg.defaultMinute, 0, 0);
          ts = dt.getTime(); label = "明天 " + pad(cfg.defaultHour) + ":" + pad(cfg.defaultMinute);
        }
        setAlarm(ts, label);
        bridgeSchedule(ts, label).then(function (ok) {
          injectSystemMessage("（系统：已设置 " + label + " 的提醒～）");
          setTip("✓ " + label + (ok ? " [桥✓]" : ""));
        });
      });
    });

    root.querySelector("#wuc-set-btn").addEventListener("click", function () {
      var v = root.querySelector("#wuc-timepick").value;
      if (!v) return;
      var parts = v.split(":");
      var h = +parts[0], m = +parts[1];
      var dt = new Date(); dt.setHours(h, m, 0, 0);
      if (dt.getTime() <= Date.now()) dt = new Date(dt.getTime() + 86400000);
      var label = pad(h) + ":" + pad(m);
      setAlarm(dt.getTime(), label);
      bridgeSchedule(dt.getTime(), label).then(function (ok) {
        injectSystemMessage("（系统：已设置 " + label + " 的提醒～）");
        setTip("✓ " + label + (ok ? " [桥✓]" : ""));
      });
    });

    var genSel = root.querySelector("#wuc-gen-sel");
    genSel.addEventListener("change", function () {
      root.querySelector("#wuc-wb-row").style.display = genSel.value === "worldbook" ? "block" : "none";
      root.querySelector("#wuc-custom-row").style.display = genSel.value === "custom" ? "block" : "none";
    });

    root.querySelector("#wuc-test-btn").addEventListener("click", function () {
      setTip("测试中…");
      var oldUrl = cfg.bridgeUrl, oldKey = cfg.bridgeKey;
      cfg.bridgeUrl = root.querySelector("#wuc-bridge-url").value;
      cfg.bridgeKey = root.querySelector("#wuc-bridge-key").value;
      bridgePing().then(function (ok) {
        cfg.bridgeUrl = oldUrl; cfg.bridgeKey = oldKey;
        setTip(ok ? "✓ 桥接连通！" : "✗ 无法连接", !ok);
      });
    });

    root.querySelector("#wuc-save-btn").addEventListener("click", function () {
      var dt = root.querySelector("#wuc-deftime").value;
      if (dt) { var p = dt.split(":"); cfg.defaultHour = +p[0]; cfg.defaultMinute = +p[1]; }
      cfg.enableAlarm = root.querySelector("#wuc-alarm-sw").checked;
      cfg.boundCharName = root.querySelector("#wuc-char-sel").value;
      cfg.genMode = root.querySelector("#wuc-gen-sel").value;
      cfg.genCustomText = root.querySelector("#wuc-custom-ta").value;
      cfg.wakeMessage = root.querySelector("#wuc-msg-ta").value;
      cfg.bridgeUrl = root.querySelector("#wuc-bridge-url").value;
      cfg.bridgeKey = root.querySelector("#wuc-bridge-key").value;
      var wbEl = root.querySelector("#wuc-wb-sel");
      if (wbEl) {
        cfg.genWorldbookUid = wbEl.value;
        cfg.genWorldbookContent = wbEl.options[wbEl.selectedIndex]?.dataset.content || "";
      }
      saveCfg();
      dbg("[WUC] 配置已保存");
      setTip("✓ 已保存");
    });
  }

  /* ═══════════════════════════════════════════════════════════
   *  世界书条目
   * ═══════════════════════════════════════════════════════════ */
  function getWbEntries() {
    try {
      var ctx = getCtx();
      var entries = [];
      var map = ctx?.world_info ?? window.world_info ?? {};
      for (var book in map) {
        var es = map[book]?.entries ?? map[book];
        if (!es) continue;
        for (var uid in es) {
          var e = es[uid];
          var c = e?.content;
          if (c == null) c = "";
          else if (typeof c !== "string") { try { c = JSON.stringify(c); } catch (_e) { c = String(c); } }
          entries.push({
            uid: uid,
            label: e?.comment || (Array.isArray(e?.key) ? e.key.join(", ") : uid),
            content: c
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
    loadCfg();
    injectCSS();

    var evSrc = getEventSource(), evTypes = getEventTypes();
    if (evSrc?.on) {
      evSrc.on(evTypes.MESSAGE_SENT ?? "MESSAGE_SENT", handleMessage);
    } else {
      var chatEl = document.getElementById("chat");
      if (chatEl) {
        new MutationObserver(function (muts) {
          muts.forEach(function (mu) {
            mu.addedNodes.forEach(function (node) {
              if (node.nodeType === 1 && node.classList?.contains("is_user")) {
                var t = node.querySelector(".mes_text")?.textContent?.trim() ?? "";
                if (t) handleMessage(t);
              }
            });
          });
        }).observe(chatEl, { childList: true });
      }
    }

    setInterval(pollBridgeEvent, 60000);

    function tryMount() {
      if (!document.body) return false;
      mountFab();
      return !!document.getElementById("wuc-fab");
    }
    if (!tryMount()) {
      var ob = new MutationObserver(function () {
        if (tryMount()) ob.disconnect();
      });
      ob.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(function () { tryMount(); ob.disconnect(); }, 8000);
    }

    console.log("[WUC] Wake-Up Call v6.2.1 已就绪");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
