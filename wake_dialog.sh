#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  wake_dialog.sh — 独立设闹钟弹窗（不打开酒馆）
#  ------------------------------------------------------------
#  用法：运行后弹出系统时间选择器，选好时间即设定叫醒闹钟
#        （复用 bridge.py 的 /schedule 逻辑：系统闹钟 + 定时任务）
#  桌面快捷方式（推荐）：
#     1) 把本文件放进 ~/.shortcuts/
#        （pkg install termux-api termux-widget 之后）
#     2) chmod +x ~/.shortcuts/wake_dialog.sh
#     3) 长按手机桌面 → 添加小部件 → Termux:Widget → 选本脚本
#     之后在桌面点一下图标，就直接弹出时间选择器。
#  依赖：bridge.py 正在运行（nohup python3 bridge.py &）
# ============================================================

KEY="wake-2026"                          # 与 bridge.py 的 KEY 一致
BRIDGE="http://127.0.0.1:8765"

# 弹出时间选择器（默认 08:00）
RESULT=$(termux-dialog time -t "08:00")
TIME=$(echo "$RESULT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("text",""))' 2>/dev/null)

if [ -z "$TIME" ]; then
    termux-toast "已取消设置"
    exit 0
fi

HOUR=$(echo "$TIME" | cut -d: -f1)
MINUTE=$(echo "$TIME" | cut -d: -f2)
HOUR=$((10#$HOUR))
MINUTE=$((10#$MINUTE))

# 计算目标时间戳（该时刻若已过，顺延到下一个自然日）
TS=$(python3 -c 'import datetime; h=int('"$HOUR"'); m=int('"$MINUTE"'); n=datetime.datetime.now(); d=n.replace(hour=h,minute=m,second=0,microsecond=0); d = d if d > n else d + datetime.timedelta(days=1); print(int(d.timestamp()*1000))')

# 调桥设定提醒 + 注册到点任务
if curl -s "$BRIDGE/schedule?key=$KEY&ts=$TS&text=桌面快捷设定" >/dev/null; then
    termux-notification \
        --title "酒馆 · 提醒" \
        --content "已设定 $TIME 的提醒" \
        --alert-once \
        2>/dev/null
    termux-toast "已设定 $TIME 提醒"
else
    termux-toast "设置失败：bridge.py 未运行？"
    echo "错误：无法连接 $BRIDGE，请确认 bridge.py 在运行"
    exit 1
fi
