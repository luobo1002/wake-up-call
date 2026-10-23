#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  wake_cancel.sh — 取消提醒（可被通知点击触发，或手动执行）
#  放置位置：~/bin/wake_cancel.sh
#  权限：chmod +x ~/bin/wake_cancel.sh
# ============================================================

termux-job-scheduler --cancel 4217
termux-toast "已取消提醒" 2>/dev/null || true
