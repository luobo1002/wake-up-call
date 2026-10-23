#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  wake_quick.sh — 桌面图标：一键设置提醒菜单
#  ------------------------------------------------------------
#  用法（安装后一次性设置）：
#     1) pkg install termux-api termux-widget
#     2) 长按手机桌面 → 添加小部件 → Termux:Widget → 选 wake_quick
#     之后桌面就有图标，点一下弹出快捷菜单：
#       15分钟后 / 30分钟后 / 1小时后 / 明天早上8点 /
#       自定义时间 / 取消提醒
#  全程不打开酒馆，只依赖 wake_bridge.py 在运行。
#  由 setup.sh 自动部署到 ~/.shortcuts/wake_quick.sh
# ============================================================

# 密钥从 ~/wakeup_config.json 读取（酒馆扩展设置里统一管理）
KEY=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/wakeup_config.json"))).get("bridge_key","wake-2026"))' 2>/dev/null || echo "wake-2026")
BRIDGE="http://127.0.0.1:8765"

# 检测桥是否在运行
if ! curl -s -o /dev/null "$BRIDGE/ping" 2>/dev/null; then
    termux-toast "桥未运行：请先跑 setup.sh 部署"
    exit 1
fi

RESULT=$(termux-dialog radio -t "Wake-Up 提醒" -v "15分钟后,30分钟后,1小时后,明天早上8点,自定义时间,取消提醒")
CHOICE=$(echo "$RESULT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("text",""))' 2>/dev/null)

if [ -z "$CHOICE" ]; then
    termux-toast "已取消"
    exit 0
fi

case "$CHOICE" in
    "15分钟后")
        TS=$(( $(date +%s) * 1000 + 15 * 60 * 1000 ))
        ;;
    "30分钟后")
        TS=$(( $(date +%s) * 1000 + 30 * 60 * 1000 ))
        ;;
    "1小时后")
        TS=$(( $(date +%s) * 1000 + 60 * 60 * 1000 ))
        ;;
    "明天早上8点")
        TS=$(python3 -c '
import datetime, sys
now = datetime.datetime.now()
d = now.replace(hour=8, minute=0, second=0, microsecond=0)
if d <= now: d += datetime.timedelta(days=1)
print(int(d.timestamp() * 1000))
')
        ;;
    "自定义时间")
        T=$(termux-dialog time -t "08:00" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("text",""))' 2>/dev/null)
        if [ -z "$T" ]; then
            termux-toast "已取消"
            exit 0
        fi
        TS=$(python3 -c "
import datetime, sys
t = '$T'.strip()
h, m = map(int, t.split(':'))
now = datetime.datetime.now()
d = now.replace(hour=h, minute=m, second=0, microsecond=0)
if d <= now: d += datetime.timedelta(days=1)
print(int(d.timestamp() * 1000))
")
        ;;
    "取消提醒")
        curl -s "$BRIDGE/cancel?key=$KEY" >/dev/null 2>&1
        termux-toast "提醒已取消"
        exit 0
        ;;
    *)
        termux-toast "未识别选项"
        exit 0
        ;;
esac

curl -s "$BRIDGE/schedule?key=$KEY&ts=$TS&text=桌面快捷设置" >/dev/null 2>&1
if [ $? -eq 0 ]; then
    termux-toast "提醒已设置 ✔"
else
    termux-toast "设置失败：请检查桥"
fi
