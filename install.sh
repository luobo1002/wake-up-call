!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  install.sh — Wake-Up Call v2.0 一键安装（sillydroid / Termux）
#  ------------------------------------------------------------
#  用法：
#    curl -sL https://raw.githubusercontent.com/luobo1002/wake-up-call/main/install.sh | bash
#  国内镜像：
#    curl -sL https://ghfast.top/https://raw.githubusercontent.com/luobo1002/wake-up-call/main/install.sh | bash
# ============================================================

set -u
echo ""
echo "╔══════════════════════════════════════╗"
echo "║     Wake-Up Call v2.0 一键安装       ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ---- 1. 定位酒馆目录 ----
CANDIDATES=(
  "/data/user/0/com.jm.sillydroid/files/android-tavern/data/server"
  "$HOME/SillyTavern"
  "$HOME/SillyTavern-release"
  "$HOME/tavern"
)
ST_ROOT=""
for d in "${CANDIDATES[@]}"; do
  if [ -f "$d/package.json" ]; then
    ST_ROOT="$d"
    break
  fi
done

if [ -z "$ST_ROOT" ]; then
  echo "【未找到酒馆目录】请手动指定，例如："
  echo "  ST_ROOT=/path/to/SillyTavern bash install.sh"
  exit 1
fi
echo "▸ 酒馆目录: $ST_ROOT"

# ---- 2. 扩展目标位置 ----
EXT_PARENT="$ST_ROOT/public/scripts/extensions/third-party"
EXT_DIR="$EXT_PARENT/wake-up-call"
mkdir -p "$EXT_PARENT"

# ---- 3. 拉取 / 更新扩展 ----
REPO_URL="https://github.com/luobo1002/wake-up-call"
MIRROR_URL="https://ghfast.top/https://github.com/luobo1002/wake-up-call"

if [ -d "$EXT_DIR/.git" ]; then
  echo "▸ 扩展已存在，更新中…"
  (cd "$EXT_DIR" && git reset --hard && git pull) || \
  (cd "$EXT_DIR" && git reset --hard && git pull "$MIRROR_URL" HEAD) || {
    echo "【更新失败】可手动 cd $EXT_DIR && git pull"; exit 1
  }
else
  echo "▸ 拉取扩展代码…"
  rm -rf "$EXT_DIR"
  git clone "$REPO_URL" "$EXT_DIR" || git clone "$MIRROR_URL" "$EXT_DIR" || {
    echo "【拉取失败】网络问题，可手动下载 zip 解压到: $EXT_DIR"; exit 1
  }
fi
echo "▸ 扩展已就位: $EXT_DIR"

# ---- 4. 确保 ~/bin 存在 ----
mkdir -p "$HOME/bin"

# ---- 5. 部署桥服务脚本 ----
echo "▸ 部署桥服务…"
cp "$EXT_DIR/bridge.py" "$HOME/bin/wake_bridge.py"
chmod +x "$HOME/bin/wake_bridge.py"

# ---- 6. 生成 wake_job.sh（到点时由 termux-job-scheduler 调用）----
cat > "$HOME/bin/wake_job.sh" << 'JOBEOF'
#!/data/data/com.termux/files/usr/bin/bash
# 到点执行：生成早安回复并发送通知 + 写入醒来事件
CONFIG="$HOME/wakeup_config.json"
CACHE="$HOME/wakeup_cache.json"
EVENT="$HOME/wakeup_event.json"
NOW=$(date +"%H:%M")

# 读配置
GEN_MODE=$(python3 -c "import json,sys; d=json.load(open('$CONFIG')); print(d.get('gen_mode','auto'))" 2>/dev/null || echo "auto")
CUSTOM_TEXT=$(python3 -c "import json,sys; d=json.load(open('$CONFIG')); print(d.get('gen_custom_text',''))" 2>/dev/null || echo "")

REPLY_TEXT="早安～现在是 $NOW，新的一天开始了！"

if [ "$GEN_MODE" = "custom" ] && [ -n "$CUSTOM_TEXT" ]; then
  REPLY_TEXT="$CUSTOM_TEXT"
fi

# 发送手机通知
termux-notification \
  --title "⏰ Wake-Up" \
  --content "$REPLY_TEXT" \
  --id 9001 \
  --action "am start -n com.jm.sillydroid/.MainActivity" \
  2>/dev/null || true

# 写入醒来事件（酒馆前端轮询消费）
python3 -c "
import json, os
text = '''$REPLY_TEXT'''
with open('$EVENT', 'w', encoding='utf-8') as f:
    json.dump({'text': text, 'time': '$NOW'}, f, ensure_ascii=False)
" 2>/dev/null || true

echo "[$(date +%H:%M:%S)] 早安任务已执行: $REPLY_TEXT" >> "$HOME/wake_bridge.log"
JOBEOF
chmod +x "$HOME/bin/wake_job.sh"

# ---- 7. 停止旧桥进程（如果在运行）----
pkill -f "wake_bridge.py" 2>/dev/null || true
sleep 1

# ---- 8. 启动桥服务 ----
echo "▸ 启动桥服务…"
nohup python3 "$HOME/bin/wake_bridge.py" > "$HOME/wake_bridge.log" 2>&1 &
BRIDGE_PID=$!
sleep 1.5

if kill -0 "$BRIDGE_PID" 2>/dev/null; then
  echo "▸ 桥服务已启动 (PID=$BRIDGE_PID)"
else
  echo "【警告】桥服务启动可能失败，查看日志: cat ~/wake_bridge.log"
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║               安装完成！                        ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  接下来：                                        ║"
echo "║  1) 完全退出 sillydroid，重新打开               ║"
echo "║  2) 右下角出现 ⏰ 悬浮窗，点击展开设置面板     ║"
echo "║  3) 在聊天里说「晚安」或「明天7点叫醒我」       ║"
echo "║                                                  ║"
echo "║  日志: cat ~/wake_bridge.log                     ║"
echo "║  重启桥: pkill -f wake_bridge.py && nohup \\    ║"
echo "║    python3 ~/bin/wake_bridge.py &                ║"
echo "╚══════════════════════════════════════════════════╝"
