#!/usr/bin/env python3
"""
Wake-Up Call Bridge v3.0
Termux 侧桥接服务，监听来自酒馆插件的调度请求，触发 Android 系统闹钟。

依赖安装（Termux）：
  pip install flask
  
启动：
  python bridge.py

默认端口：8765
"""

import json
import os
import subprocess
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

# ── 配置 ──────────────────────────────────────────────────────
PORT    = int(os.environ.get("WUC_PORT", "8765"))
API_KEY = os.environ.get("WUC_KEY", "wake-2026")
ALARM_CMD = "am"           # Android am 命令（Termux 可调用）
NOTIF_CMD = "termux-notification"

# ── 状态 ─────────────────────────────────────────────────────
state = {
    "scheduled_ts":   None,
    "scheduled_label": None,
    "event_pending":  False,
    "event_text":     None,
    "cache":          None,    # 角色 + 历史缓存
}
state_lock = threading.Lock()
alarm_timer = None


def check_key(qs):
    keys = qs.get("key", [""])
    return keys[0] == API_KEY


def schedule_alarm(ts_ms, label, enable_alarm=True):
    """用 Android am 设置系统闹钟（Termux 版）"""
    global alarm_timer

    # 取消已有定时器
    if alarm_timer:
        alarm_timer.cancel()
        alarm_timer = None

    delay_s = (ts_ms - time.time() * 1000) / 1000.0
    if delay_s < 1:
        return

    if enable_alarm:
        # 通过 am 广播设置系统闹钟（Android intent）
        ts_sec = int(ts_ms / 1000)
        try:
            subprocess.Popen([
                ALARM_CMD, "start", "-a", "android.intent.action.SET_ALARM",
                "--ei", "android.intent.extra.alarm.HOUR", str(datetime.fromtimestamp(ts_sec).hour),
                "--ei", "android.intent.extra.alarm.MINUTES", str(datetime.fromtimestamp(ts_sec).minute),
                "--ez", "android.intent.extra.alarm.SKIP_UI", "true",
                "--es", "android.intent.extra.alarm.MESSAGE", f"WUC: {label}",
            ], stderr=subprocess.DEVNULL)
            print(f"[WUC] 系统闹钟已设置：{label}")
        except Exception as e:
            print(f"[WUC] am 调用失败：{e}")

        # 也发送 termux 通知
        try:
            subprocess.Popen([
                NOTIF_CMD,
                "--title", "Wake-Up Call",
                "--content", f"提醒已设置：{label}",
                "--id", "wuc-scheduled",
            ], stderr=subprocess.DEVNULL)
        except Exception:
            pass

    # 本地 Python 定时器（作为备用 / 触发事件）
    def on_fire():
        with state_lock:
            state["event_pending"] = True
            state["event_text"]    = label
        print(f"[WUC] 提醒触发：{label}")
        # 发送到点通知
        try:
            subprocess.Popen([
                NOTIF_CMD,
                "--title", "⏰ Wake-Up Call",
                "--content", label,
                "--id", "wuc-fired",
                "--priority", "high",
                "--sound",
            ], stderr=subprocess.DEVNULL)
        except Exception:
            pass

    alarm_timer = threading.Timer(delay_s, on_fire)
    alarm_timer.daemon = True
    alarm_timer.start()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass   # 静默日志

    def send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        path = parsed.path

        # ── /ping ──
        if path == "/ping":
            self.send_json(200, {"ok": True, "version": "3.0"})
            return

        if not check_key(qs):
            self.send_json(403, {"ok": False, "error": "bad key"})
            return

        # ── /schedule?ts=...&text=...&alarm=1 ──
        if path == "/schedule":
            ts_list = qs.get("ts", [])
            label   = qs.get("text", ["提醒"])[0]
            alarm   = qs.get("alarm", ["1"])[0] == "1"
            if not ts_list:
                self.send_json(400, {"ok": False, "error": "missing ts"}); return
            ts_ms = int(ts_list[0])
            with state_lock:
                state["scheduled_ts"]    = ts_ms
                state["scheduled_label"] = label
                state["event_pending"]   = False
            schedule_alarm(ts_ms, label, alarm)
            self.send_json(200, {"ok": True, "ts": ts_ms, "label": label})
            return

        # ── /cancel ──
        if path == "/cancel":
            global alarm_timer
            if alarm_timer:
                alarm_timer.cancel()
                alarm_timer = None
            with state_lock:
                state["scheduled_ts"] = None
                state["event_pending"] = False
            self.send_json(200, {"ok": True})
            return

        # ── /event（查询是否有到点事件，不消费） ──
        if path == "/event":
            with state_lock:
                pending = state["event_pending"]
                text    = state["event_text"]
            self.send_json(200, {"ok": pending, "text": text if pending else None})
            return

        # ── /event-consume（消费事件） ──
        if path == "/event-consume":
            with state_lock:
                pending = state["event_pending"]
                text    = state["event_text"]
                state["event_pending"] = False
                state["event_text"]    = None
            self.send_json(200, {"ok": pending, "text": text if pending else None})
            return

        # ── /status ──
        if path == "/status":
            with state_lock:
                s = dict(state)
                s.pop("cache", None)   # 不暴露缓存
            self.send_json(200, {"ok": True, "state": s})
            return

        self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        path = parsed.path

        if not check_key(qs):
            self.send_json(403, {"ok": False, "error": "bad key"}); return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(body)
        except Exception:
            data = {}

        # ── POST /cache ── 存储角色 + 历史数据（供未来生成晨安消息用）
        if path == "/cache":
            with state_lock:
                state["cache"] = data
            print(f"[WUC] 角色缓存已更新：{data.get('character', {}).get('name', '?')}")
            self.send_json(200, {"ok": True})
            return

        self.send_json(404, {"ok": False, "error": "not found"})


def main():
    print(f"[WUC] Wake-Up Call Bridge v3.0 启动中...")
    print(f"[WUC] 监听端口：{PORT}")
    print(f"[WUC] API Key：{API_KEY}")
    print(f"[WUC] 按 Ctrl+C 停止")

    server = HTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[WUC] 已停止")


if __name__ == "__main__":
    main()
