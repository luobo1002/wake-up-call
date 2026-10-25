!/data/data/com.termux/files/usr/bin/python3
# ============================================================
#  wake_bridge.py v2.0 — Wake-Up 桥（Termux 本地 HTTP 服务）
#  ------------------------------------------------------------
#  端点：
#    GET  /ping                              健康检查
#    GET  /schedule?key=&ts=<毫秒>&text=&alarm=1  设定提醒
#    GET  /cancel?key=                       取消提醒
#    GET  /event?key=                        读取"已醒来"事件
#    GET  /event-consume?key=                消费事件（清除）
#    POST /cache?key=                        保存角色+聊天缓存
#    POST /config?key=                       保存配置
#  ------------------------------------------------------------
#  配置文件：~/wakeup_config.json
#  启动：python3 ~/bin/wake_bridge.py
#  常驻：nohup python3 ~/bin/wake_bridge.py > ~/wake_bridge.log 2>&1 &
# ============================================================
import json
import os
import subprocess
import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

PORT = 8765
JOB_ID = 4217
CONFIG_FILE = os.path.expanduser("~/wakeup_config.json")
CACHE_FILE  = os.path.expanduser("~/wakeup_cache.json")
EVENT_FILE  = os.path.expanduser("~/wakeup_event.json")
JOB_SCRIPT  = os.path.expanduser("~/bin/wake_job.sh")

DEFAULTS = {
    "bridge_key":      "wake-2026",
    "gen_mode":        "auto",
    "gen_custom_text": "",
    "gen_character":   "",
    "gen_worldinfo":   "",
}

# ── 配置读写 ────────────────────────────────────────────────
def load_config():
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            cfg.update({k: data.get(k, v) for k, v in cfg.items()})
    except Exception:
        pass
    return cfg

def save_config(data):
    cfg = load_config()
    cfg.update({k: v for k, v in data.items() if k in DEFAULTS})
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    return cfg

def log(msg):
    print(f"[{datetime.datetime.now():%H:%M:%S}] {msg}", flush=True)

# ── 系统闹钟（通过 Android am 命令）──────────────────────────
def set_system_alarm(ts_ms):
    dt = datetime.datetime.fromtimestamp(ts_ms / 1000)
    cmd = [
        "am", "start",
        "-a", "android.intent.action.SET_ALARM",
        "--ei", "android.intent.extra.alarm.HOUR",    str(dt.hour),
        "--ei", "android.intent.extra.alarm.MINUTES", str(dt.minute),
        "--es", "android.intent.extra.alarm.MESSAGE", "起床啦～",
        "--ez", "android.intent.extra.alarm.SKIP_UI", "true",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        log(f"系统闹钟 → {dt:%H:%M}  {r.stderr.strip() or 'ok'}")
    except Exception as e:
        log(f"设置系统闹钟失败: {e}")

# ── Termux Job Scheduler ─────────────────────────────────────
def schedule_job(timestamp_ms):
    cmd = [
        "termux-job-scheduler",
        "--job-id",      str(JOB_ID),
        "--timestamp",   str(timestamp_ms),
        "--script-path", JOB_SCRIPT,
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        log(f"job-scheduler: {r.stdout.strip()} {r.stderr.strip()}")
    except Exception as e:
        log(f"注册定时任务失败: {e}")

def cancel_job():
    try:
        subprocess.run(
            ["termux-job-scheduler", "--cancel", str(JOB_ID)],
            capture_output=True, text=True, timeout=15
        )
        return True
    except Exception as e:
        log(f"取消任务失败: {e}")
        return False

# ── HTTP 处理器 ───────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):

    def _key_ok(self, q):
        return q.get("key", [""])[0] == load_config()["bridge_key"]

    def do_GET(self):
        parsed = urlparse(self.path)
        q = parse_qs(parsed.query)
        path = parsed.path

        # 健康检查
        if path == "/ping":
            self.reply(200, {"ok": True, "version": "2.0", "config": os.path.exists(CONFIG_FILE)})
            return

        if not self._key_ok(q):
            self.reply(403, {"ok": False, "error": "bad key"})
            return

        # 设定提醒
        if path == "/schedule":
            try:
                ts = int(q["ts"][0])
            except Exception:
                self.reply(400, {"ok": False, "error": "bad ts"}); return
            now_ms = int(datetime.datetime.now().timestamp() * 1000)
            if ts <= now_ms:
                self.reply(400, {"ok": False, "error": "ts in the past"}); return

            text      = q.get("text",  [""])[0]
            use_alarm = q.get("alarm", ["0"])[0] == "1"

            if use_alarm:
                set_system_alarm(ts)
            schedule_job(ts)

            target = datetime.datetime.fromtimestamp(ts / 1000)
            log(f"已设定提醒 {target:%m-%d %H:%M}（{text}，系统闹钟={'开' if use_alarm else '关'}）")
            self.reply(200, {"ok": True, "target": target.strftime("%Y-%m-%d %H:%M")})

        # 取消提醒
        elif path == "/cancel":
            ok = cancel_job()
            log("提醒已取消")
            self.reply(200, {"ok": ok})

        # 读取醒来事件
        elif path == "/event":
            try:
                with open(EVENT_FILE, encoding="utf-8") as f:
                    data = json.load(f)
                self.reply(200, {"ok": True, "text": data.get("text", "")})
            except Exception:
                self.reply(200, {"ok": True, "text": ""})

        # 消费醒来事件
        elif path == "/event-consume":
            try:
                os.remove(EVENT_FILE)
            except Exception:
                pass
            log("醒来事件已消费")
            self.reply(200, {"ok": True})

        else:
            self.reply(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        q = parse_qs(parsed.query)
        path = parsed.path

        if not self._key_ok(q):
            self.reply(403, {"ok": False, "error": "bad key"}); return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self.reply(400, {"ok": False, "error": "bad body"}); return

        # 保存角色+聊天缓存
        if path == "/cache":
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(body, f, ensure_ascii=False, indent=2)
            char = (body.get("character") or {}).get("name", "未知角色")
            hist = len(body.get("history", []))
            log(f"缓存已更新：角色={char}，历史={hist}条，生成方式={body.get('genMode','?')}")
            self.reply(200, {"ok": True})

        # 保存配置
        elif path == "/config":
            cfg = save_config(body)
            log(f"配置已同步：gen_mode={cfg.get('gen_mode')}，char={cfg.get('gen_character') or '(全局)'}")
            self.reply(200, {"ok": True, "config": {"bridge_key": cfg["bridge_key"]}})

        else:
            self.reply(404, {"ok": False, "error": "not found"})

    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type",   "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass   # 静默 HTTP 访问日志，只保留 log() 输出


if __name__ == "__main__":
    cfg = load_config()
    log(f"Wake-Up 桥 v2.0 已启动: http://127.0.0.1:{PORT}")
    log(f"密钥={cfg['bridge_key']}，生成方式={cfg['gen_mode']}")
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        log("已停止")
