#!/data/data/com.termux/files/usr/bin/python3
# ============================================================
#  Wake-Up 桥 — Termux 本地 HTTP 服务
#  ------------------------------------------------------------
#  端点：
#    GET /schedule?key=&ts=<unix毫秒>&text=  设定提醒（普通通知弹窗）
#    GET /cancel?key=                        取消已设定的提醒
#    POST /cache?key=                        保存角色缓存（供早上生成回复）
#  ------------------------------------------------------------
#  启动：python3 bridge.py
#  常驻：nohup python3 bridge.py > wake_bridge.log 2>&1 &
#  依赖：pkg install python termux-api
#        并给 Termux 开启后台运行 + 关闭电池优化（否则锁屏被杀）
# ============================================================
import json
import os
import subprocess
import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

PORT = 8765
KEY = "wake-2026"                        # 与酒馆扩展里的 bridgeKey 一致
JOB_ID = 4217                            # 任务 ID（固定，避免重复）
JOB_SCRIPT = os.path.expanduser("~/bin/wake_job.sh")  # 到点执行的脚本
CACHE_FILE = os.path.expanduser("~/wakeup_cache.json")  # 角色缓存

# 是否同时调起系统闹钟（默认 False = 只弹普通通知）
# 想要系统闹钟响铃：改成 True（注意部分 ROM 会弹新建闹钟界面需手动确认）
ALARM_ENABLED = False


def log(msg):
    print(f"[{datetime.datetime.now():%H:%M:%S}] {msg}", flush=True)


def set_system_alarm(ts):
    """可选：调起系统闹钟（默认关闭，用普通通知即可）。"""
    dt = datetime.datetime.fromtimestamp(ts / 1000)
    cmd = [
        "am", "start",
        "-a", "android.intent.action.SET_ALARM",
        "--ei", "android.intent.extra.alarm.HOUR", str(dt.hour),
        "--ei", "android.intent.extra.alarm.MINUTES", str(dt.minute),
        "--es", "android.intent.extra.alarm.MESSAGE", "起床啦",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        log(f"系统闹钟 Intent 已发送: {r.stdout.strip()} {r.stderr.strip()}")
    except Exception as e:
        log(f"设置系统闹钟失败: {e}")


def schedule_job(timestamp_ms):
    """注册一次性后台任务，到点执行 wake_job.sh。"""
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
    """取消已设定的提醒。"""
    cmd = ["termux-job-scheduler", "--cancel", str(JOB_ID)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        log(f"取消任务: {r.stdout.strip()} {r.stderr.strip()}")
        return True
    except Exception as e:
        log(f"取消任务失败: {e}")
        return False


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)

        if self.path.startswith("/schedule"):
            if q.get("key", [""])[0] != KEY:
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

        elif self.path.startswith("/cancel"):
            if q.get("key", [""])[0] != KEY:
                self.reply(403, {"ok": False, "error": "bad key"})
                return
            ok = cancel_job()
            log("提醒已取消")
            self.reply(200, {"ok": ok})

        else:
            self.reply(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        q = parse_qs(urlparse(self.path).query)

        if not self.path.startswith("/cache"):
            self.reply(404, {"ok": False, "error": "not found"})
            return

        if q.get("key", [""])[0] != KEY:
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

    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # 静默默认访问日志


if __name__ == "__main__":
    log(f"Wake-Up 桥已启动: http://127.0.0.1:{PORT}（系统闹钟={'开' if ALARM_ENABLED else '关'}）")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
