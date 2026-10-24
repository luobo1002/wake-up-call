#!/data/data/com.termux/files/usr/bin/python3
# ============================================================
#  wake_bridge.py — Wake-Up 桥（Termux 本地 HTTP 服务）
#  ------------------------------------------------------------
#  端点：
#    GET  /ping                         健康检查
#    GET  /schedule?key=&ts=<毫秒>&text= 设定提醒（普通通知弹窗）
#    GET  /cancel?key=                  取消提醒
#    GET  /event?key=                   读取"已醒来"事件（酒馆前端补注入用）
#    GET  /event-consume?key=           消费事件（清除）
#    POST /cache?key=                   保存角色缓存
#    POST /config?key=                  保存配置（密钥 + AI API，来自酒馆扩展）
#  ------------------------------------------------------------
#  配置文件：~/wakeup_config.json（由 setup.sh 生成、酒馆扩展同步）
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
CACHE_FILE = os.path.expanduser("~/wakeup_cache.json")
EVENT_FILE = os.path.expanduser("~/wakeup_event.json")
JOB_SCRIPT = os.path.expanduser("~/bin/wake_job.sh")

# 是否同时调起系统闹钟（默认 False = 只弹普通通知）
ALARM_ENABLED = False

DEFAULTS = {
    "bridge_key": "wake-2026",
    "api_wake_key": "wake-2026",
    "api_base": "",
    "api_key": "",
    "model": "",
    "gen_mode": "auto",
    "gen_custom_text": "",
    "gen_character": "",
    "gen_worldinfo": "",
}


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


def set_system_alarm(ts):
    dt = datetime.datetime.fromtimestamp(ts / 1000)
    cmd = [
        "am", "start",
        "-a", "android.intent.action.SET_ALARM",
        "--ei", "android.intent.extra.alarm.HOUR", str(dt.hour),
        "--ei", "android.intent.extra.alarm.MINUTES", str(dt.minute),
        "--es", "android.intent.extra.alarm.MESSAGE", "起床啦",
    ]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    except Exception as e:
        log(f"设置系统闹钟失败: {e}")


def schedule_job(timestamp_ms):
    cmd = [
        "termux-job-scheduler",
        "--job-id", str(JOB_ID),
        "--timestamp", str(timestamp_ms),
        "--script-path", JOB_SCRIPT,
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        log(f"job-scheduler: {r.stdout.strip()} {r.stderr.strip()}")
    except Exception as e:
        log(f"注册定时任务失败: {e}")


def cancel_job():
    cmd = ["termux-job-scheduler", "--cancel", str(JOB_ID)]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        return True
    except Exception as e:
        log(f"取消任务失败: {e}")
        return False


class Handler(BaseHTTPRequestHandler):
    def _key_ok(self, q):
        return q.get("key", [""])[0] == load_config()["bridge_key"]

    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)

        if self.path.startswith("/ping"):
            self.reply(200, {"ok": True, "deployed": True, "config": os.path.exists(CONFIG_FILE)})

        elif self.path.startswith("/schedule"):
            if not self._key_ok(q):
                self.reply(403, {"ok": False, "error": "bad key"})
                return
            try:
                ts = int(q["ts"][0])
            except Exception:
                self.reply(400, {"ok": False, "error": "bad ts"})
                return
            if ts < int(datetime.datetime.now().timestamp() * 1000):
                self.reply(400, {"ok": False, "error": "ts in the past"})
                return
            text = q.get("text", [""])[0]
            if ALARM_ENABLED:
                set_system_alarm(ts)
            schedule_job(ts)
            target = datetime.datetime.fromtimestamp(ts / 1000)
            log(f"已设定提醒 {target:%m-%d %H:%M}（{text}）")
            self.reply(200, {"ok": True, "target": target.strftime("%Y-%m-%d %H:%M")})

        elif self.path.startswith("/event-consume"):
            if not self._key_ok(q):
                self.reply(403, {"ok": False, "error": "bad key"})
                return
            try:
                os.remove(EVENT_FILE)
            except Exception:
                pass
            log("醒来事件已消费")
            self.reply(200, {"ok": True})

        elif self.path.startswith("/event"):
            if not self._key_ok(q):
                self.reply(403, {"ok": False, "error": "bad key"})
                return
            try:
                with open(EVENT_FILE, encoding="utf-8") as f:
                    data = json.load(f)
                self.reply(200, {"ok": True, "text": data.get("text", "")})
            except Exception:
                self.reply(200, {"ok": True, "text": ""})

        elif self.path.startswith("/cancel"):
            if not self._key_ok(q):
                self.reply(403, {"ok": False, "error": "bad key"})
                return
            ok = cancel_job()
            log("提醒已取消")
            self.reply(200, {"ok": ok})

        else:
            self.reply(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        q = parse_qs(urlparse(self.path).query)

        if self.path.startswith("/cache"):
            if not self._key_ok(q):
                self.reply(403, {"ok": False, "error": "bad key"})
                return
            try:
                length = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
            except Exception:
                self.reply(400, {"ok": False, "error": "bad body"})
                return
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            hist = len(data.get("history", []))
            char = (data.get("character") or {}).get("name", "未知角色")
            log(f"角色缓存已更新: {CACHE_FILE}（角色={char}，历史 {hist} 条）")
            self.reply(200, {"ok": True})

        elif self.path.startswith("/config"):
            if not self._key_ok(q):
                self.reply(403, {"ok": False, "error": "bad key"})
                return
            try:
                length = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
            except Exception:
                self.reply(400, {"ok": False, "error": "bad body"})
                return
            cfg = save_config(data)
            log("配置已同步（密钥 + AI API）")
            self.reply(200, {"ok": True, "config": {k: cfg[k] for k in ("bridge_key", "api_wake_key")}})

        else:
            self.reply(404, {"ok": False, "error": "not found"})

    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    cfg = load_config()
    log(f"Wake-Up 桥已启动: http://127.0.0.1:{PORT}（系统闹钟={'开' if ALARM_ENABLED else '关'}）")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
