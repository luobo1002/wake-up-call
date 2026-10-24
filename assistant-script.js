// ============================================================
//  Wake-Up Call — 酒馆助手（Tavern-Helper）脚本版
//  ------------------------------------------------------------
//  用法：酒馆助手 → 脚本 → +脚本 → 把下面这一行复制进去 → 启用
//    import 'https://testingcf.jsdelivr.net/gh/luobo1002/wake-up-call@main/assistant-script.js'
//  （一行 import 即可，以后仓库更新脚本会自动更新）
//
//  功能（在酒馆打开时生效）：
//    1) 右下角 ⏰ 悬浮图标：长按拖动位置，点按展开面板
//    2) 面板：15分钟/30分钟/1小时/明早8点/自定义/取消
//    3) 聊天里说「晚安」「明天7点叫醒我」「十五分钟后提醒我」
//       「取消提醒」自动识别
//    4) 到点：调酒馆当前 API/预设 生成角色早安回复 →
//       手机通知 + 聊天里注入系统消息（is_system，不计入主线）
//    5) 生成方式：auto=角色+聊天 / description=仅角色设定(不读聊天)
//       / custom=自定义文本(不调AI)
//  注意：脚本在酒馆页面里运行，酒馆需要开着才会到点通知；
//        想酒馆关闭也通知，请用本仓库的 Termux 扩展版。
// ============================================================
(() => {
  const CFG_KEY = "wakeup_cfg_v2";
  const defaultCfg = {
    hour: 8, minute: 0,
    genMode: "auto",          // auto | description | custom
    customText: "早上好呀，新的一天开始啦～",
  };
  const cnNum = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  let timer = null;
  let alarmLabel = "";

  function loadCfg() {
    try { return Object.assign({}, defaultCfg, JSON.parse(localStorage.getItem(CFG_KEY) || "{}")); }
    catch (e) { return Object.assign({}, defaultCfg); }
  }
  function saveCfg(c) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ }
  }
  function parseCnNumber(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    let total = 0, current = 0;
    for (const ch of s) {
      const v = cnNum[ch];
      if (v === undefined) return null;
      if (v === 10) current = (current || 1) * 10;
      else { total += current; current = v; }
    }
    return total + current;
  }
  function parseRelativeMinutes(t) {
    let m = t.match(/([0-9一二两三四五六七八九十]+)\s*分钟(?:后|钟)?/);
    if (m) { const n = parseCnNumber(m[1]); if (n !== null && n > 0) return n; }
    if (/半小时/.test(t)) return 30;
    if (/一刻钟/.test(t)) return 15;
    m = t.match(/([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:小时|钟头)(?:后|钟)?/);
    if (m) { const n = parseCnNumber(m[1]); if (n !== null && n > 0) return n * 60; }
    return null;
  }
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
  function computeTarget(text) {
    const t = text.replace(/\s+/g, "");
    const now = Date.now();
    if (/提醒|闹钟|叫我|叫醒/.test(text)) {
      const mins = parseRelativeMinutes(t);
      if (mins !== null) return { ts: now + mins * 60000, label: `${mins}分钟后` };
    }
    const abs = parseAbsoluteTime(t);
    if (abs) {
      let d = new Date(now);
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + abs.dayOffset, abs.hour, abs.minute, 0, 0);
      if (d.getTime() <= now) d = new Date(d.getTime() + 86400000);
      const label = `${d.getMonth() + 1}月${d.getDate()}日 ${String(abs.hour).padStart(2, "0")}:${String(abs.minute).padStart(2, "0")}`;
      return { ts: d.getTime(), label };
    }
    if (/晚安|睡了|睡觉|就寝/.test(text)) {
      const cfg = loadCfg();
      const d = new Date(now);
      const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, cfg.hour, cfg.minute, 0, 0);
      const label = `明天 ${String(cfg.hour).padStart(2, "0")}:${String(cfg.minute).padStart(2, "0")}`;
      return { ts: dt.getTime(), label };
    }
    return null;
  }

  function notify(title, body) {
    try {
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification(title, { body, icon: undefined });
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission().then(p => {
            if (p === "granted") new Notification(title, { body });
          });
        }
      }
    } catch (e) { /* ignore */ }
    try { if (typeof toastr !== "undefined") toastr.info(body, title); } catch (e) { /* ignore */ }
  }

  function injectSystem(text) {
    try {
      if (typeof SillyTavern === "undefined" || !SillyTavern.addOneMessage) return;
      SillyTavern.addOneMessage({
        name: "System",
        is_system: true,
        mes: text,
        extra: { wakeup: true },
      });
    } catch (e) { console.error("[WakeUp] 注入失败:", e); }
  }

  function cancelReminder() {
    if (timer) { clearTimeout(timer); timer = null; }
    alarmLabel = "";
    try { if (typeof toastr !== "undefined") toastr.info("已取消提醒"); } catch (e) { /* ignore */ }
  }

  async function fireReminder() {
    const cfg = loadCfg();
    let text = cfg.customText || "早安～";
    if (cfg.genMode !== "custom") {
      const prompt = `现在是早上 ${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}，新的一天开始了。请以角色的身份，用一句不超过50字的话温柔地叫醒用户、道早安，符合角色性格，自然口语化，不要用括号描述动作。`;
      try {
        let r;
        if (cfg.genMode === "description") {
          r = await generateRaw({
            user_input: prompt,
            ordered_prompts: ["char_description", "char_personality", "scenario", "user_input"],
            should_silence: true,
          });
        } else {
          r = await generate({ user_input: prompt, should_silence: true });
        }
        text = (typeof r === "string" ? r : r && r.content) || text;
      } catch (e) {
        console.error("[WakeUp] 生成失败，用默认文本:", e);
      }
    }
    notify("⏰ Wake-Up", text);
    injectSystem(text);
    timer = null;
  }

  function scheduleAlarm(ts, label) {
    cancelReminder();
    const delay = ts - Date.now();
    if (delay < 1000) return;
    alarmLabel = label;
    timer = setTimeout(fireReminder, delay);
    try { if (typeof toastr !== "undefined") toastr.success(`已设置 ${label} 提醒`); } catch (e) { /* ignore */ }
  }

  function onUserMessage(data) {
    const text = (data && (data.mes !== undefined ? data.mes : data.content)) || "";
    if (!text) return;
    const s = String(text);
    if (/取消(闹钟|提醒|叫醒|定时|时间)/.test(s)) { cancelReminder(); return; }
    const target = computeTarget(s);
    if (target) scheduleAlarm(target.ts, target.label);
  }

  // ---------- 悬浮窗 ----------
  function ensureFab() {
    if (document.getElementById("wakeup-fab")) return;
    const fab = document.createElement("div");
    fab.id = "wakeup-fab";
    fab.textContent = "⏰";
    fab.title = "Wake-Up 提醒（长按移动，点按展开）";
    Object.assign(fab.style, {
      position: "fixed", right: "16px", bottom: "110px", zIndex: "99998",
      width: "52px", height: "52px", borderRadius: "50%",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "26px", cursor: "grab", userSelect: "none", touchAction: "none",
      background: "rgba(40,40,50,.92)", border: "1px solid rgba(128,128,128,.4)",
      boxShadow: "0 4px 14px rgba(0,0,0,.35)",
    });
    let dragging = false, moved = false, startX = 0, startY = 0, downTime = 0;
    fab.addEventListener("pointerdown", e => {
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY; downTime = Date.now();
      fab.style.cursor = "grabbing";
      e.preventDefault();
    });
    document.addEventListener("pointermove", e => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
      if (moved) {
        const r = fab.getBoundingClientRect();
        fab.style.left = (r.left + dx) + "px";
        fab.style.top = (r.top + dy) + "px";
        fab.style.right = "auto";
        fab.style.bottom = "auto";
        startX = e.clientX; startY = e.clientY;
      }
    });
    document.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;
      fab.style.cursor = "grab";
      if (!moved && Date.now() - downTime < 400) openPanel();
      else if (moved) {
        try {
          const r = fab.getBoundingClientRect();
          localStorage.setItem("wakeup_fab_pos", JSON.stringify({ left: r.left, top: r.top }));
        } catch (e) { /* ignore */ }
      }
    });
    try {
      const p = JSON.parse(localStorage.getItem("wakeup_fab_pos") || "null");
      if (p && typeof p.left === "number") {
        fab.style.left = p.left + "px";
        fab.style.top = p.top + "px";
        fab.style.right = "auto";
        fab.style.bottom = "auto";
      }
    } catch (e) { /* ignore */ }
    document.body.appendChild(fab);
  }

  function openPanel() {
    const old = document.getElementById("wakeup-panel");
    if (old) { old.remove(); }
    const cfg = loadCfg();
    const mask = document.createElement("div");
    mask.id = "wakeup-panel";
    Object.assign(mask.style, {
      position: "fixed", inset: "0", zIndex: "99999",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,.45)",
    });
    const card = document.createElement("div");
    Object.assign(card.style, {
      width: "300px", maxWidth: "88vw", borderRadius: "14px", padding: "18px 20px",
      background: "#222", border: "1px solid #555",
      boxShadow: "0 10px 40px rgba(0,0,0,.5)", color: "#eee",
    });
    const btnStyle = "display:inline-block;margin:3px;padding:8px 12px;border-radius:8px;border:1px solid #555;background:#333;color:#eee;cursor:pointer;font-size:13px;";
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <b style="font-size:15px;">⏰ Wake-Up 提醒</b>
        <span id="wu-close" style="cursor:pointer;padding:0 8px;">✕</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <button class="wu-q" data-min="15" style="${btnStyle}">15分钟后</button>
        <button class="wu-q" data-min="30" style="${btnStyle}">30分钟后</button>
        <button class="wu-q" data-min="60" style="${btnStyle}">1小时后</button>
        <button class="wu-q" data-tomorrow="1" style="${btnStyle}">明天早上8点</button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
        <input id="wu-time" type="time" value="08:00" style="flex:1;padding:6px;border-radius:6px;border:1px solid #555;background:#333;color:#eee;">
        <button id="wu-custom" style="${btnStyle}">自定义</button>
      </div>
      <div style="margin-bottom:10px;">
        <div style="font-size:11px;opacity:.75;margin-bottom:3px;">早安生成方式</div>
        <select id="wu-genmode" style="width:100%;padding:6px;border-radius:6px;border:1px solid #555;background:#333;color:#eee;font-size:12px;">
          <option value="auto">角色 + 最近聊天</option>
          <option value="description">仅角色设定（不读聊天）</option>
          <option value="custom">自定义固定文本</option>
        </select>
      </div>
      <button id="wu-cancel" style="width:100%;${btnStyle}margin-left:0;">取消提醒</button>
      <div id="wu-msg" style="font-size:11px;opacity:.7;min-height:14px;margin-top:6px;"></div>
    `;
    mask.addEventListener("click", e => { if (e.target === mask) mask.remove(); });
    card.querySelector("#wu-close").addEventListener("click", () => mask.remove());
    card.querySelector("#wu-time").value = `${String(cfg.hour).padStart(2, "0")}:${String(cfg.minute).padStart(2, "0")}`;
    card.querySelector("#wu-genmode").value = cfg.genMode;
    card.querySelector("#wu-genmode").addEventListener("change", e => {
      cfg.genMode = e.target.value;
      saveCfg(cfg);
      card.querySelector("#wu-msg").textContent = "已切换生成方式";
    });
    card.querySelectorAll(".wu-q").forEach(b => b.addEventListener("click", () => {
      const min = b.getAttribute("data-min");
      if (min) {
        const ts = Date.now() + parseInt(min, 10) * 60000;
        scheduleAlarm(ts, `${min}分钟后`);
        card.querySelector("#wu-msg").textContent = `已设置 ${min}分钟后 提醒`;
      } else {
        const now = new Date();
        const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, cfg.hour, cfg.minute, 0, 0);
        const label = `明天 ${String(cfg.hour).padStart(2, "0")}:${String(cfg.minute).padStart(2, "0")}`;
        scheduleAlarm(dt.getTime(), label);
        card.querySelector("#wu-msg").textContent = `已设置 ${label} 提醒`;
      }
    }));
    card.querySelector("#wu-custom").addEventListener("click", () => {
      const v = card.querySelector("#wu-time").value;
      if (!v) return;
      const [h, m] = v.split(":").map(Number);
      const now = new Date();
      let dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
      if (dt.getTime() <= now.getTime()) dt = new Date(dt.getTime() + 86400000);
      const label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      scheduleAlarm(dt.getTime(), label);
      card.querySelector("#wu-msg").textContent = `已设置 ${label} 提醒`;
    });
    card.querySelector("#wu-cancel").addEventListener("click", () => {
      cancelReminder();
      card.querySelector("#wu-msg").textContent = "已取消提醒";
    });
    mask.appendChild(card);
    document.body.appendChild(mask);
  }

  // ---------- 初始化 ----------
  $(() => {
    ensureFab();
    try {
      if (typeof eventOn === "function" && typeof tavern_events !== "undefined") {
        eventOn(tavern_events.MESSAGE_SENT, onUserMessage);
      }
    } catch (e) {
      console.error("[WakeUp] 事件监听失败:", e);
    }
  });

  $(window).on("pagehide", () => {
    if (timer) clearTimeout(timer);
  });
})();
