#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  wake_job.sh — 到点执行（由 termux-job-scheduler 触发）
#  1) 调 morning.py 用 AI API 生成角色"早安"回复
#  2) termux-notification 弹普通通知（标题=角色名，内容=角色的话）
#  3) 写 ~/wakeup_event.json（酒馆前端下次打开时自动补注入
#     "已醒来"系统消息，不计入主线剧情）
#  ------------------------------------------------------------
#  放置位置：~/bin/wake_job.sh（由 setup.sh 自动部署，无需手动）
# ============================================================

TEXT="【系统】主人已在闹钟时间醒来，新的一天开始咯～"

# 1) 生成角色早安回复（调 AI API，不打开酒馆）
REPLY=$(python3 ~/morning.py 2>/dev/null || echo "主人早安～")

# 角色名（用于通知标题）
CHAR_NAME=$(python3 -c 'import json,os;c=json.load(open(os.path.expanduser("~/wakeup_cache.json")));print((c.get("character") or {}).get("name","角色"))' 2>/dev/null || echo "角色")

# 2) 弹普通通知（高优先级横幅 + 声音 + 震动；点击通知可取消提醒）
termux-notification \
    --title "$CHAR_NAME · 早安" \
    --content "$REPLY" \
    --priority high \
    --sound \
    --vibrate \
    --alert-once \
    --action "sh ~/bin/wake_cancel.sh" \
    2>/dev/null || echo "[wake_job] 通知发送失败"

# 3) 写"已醒来"事件（酒馆前端下次打开时自动补注入系统消息，不计入主线）
echo "{\"text\":\"$TEXT\",\"ts\":$(date +%s)}" > ~/wakeup_event.json 2>/dev/null \
    || echo "[wake_job] 事件写入失败"
