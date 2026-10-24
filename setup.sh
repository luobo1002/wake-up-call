#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  setup.sh — Wake-Up Call 一键部署（在 Termux 里运行一次即可）
#  ------------------------------------------------------------
#  用法：bash ~/SillyTavern/data/default-user/extensions/wake-up-call/setup.sh
#  （如果酒馆装在别的路径，把前面路径换成你的实际路径）
#  ------------------------------------------------------------
#  作用：
#   1) 把桥服务/生成脚本复制到 Termux 常用目录并加执行权限
#   2) 写入默认配置文件 ~/wakeup_config.json（密钥先统一默认值）
#   3) 启动桥服务 bridge（已运行则跳过）
#   4) 检查依赖并给出提示
# ============================================================

set -u

# ---- 定位扩展目录（脚本自身所在目录）----
EXT_DIR="$(cd "$(dirname "$0")" && pwd)"

HOME_DIR="$HOME"
BIN_DIR="$HOME/bin"
SHORTCUTS_DIR="$HOME/.shortcuts"
CONFIG_FILE="$HOME/wakeup_config.json"

echo "== Wake-Up Call 一键部署 =="
echo "扩展目录: $EXT_DIR"

# ---- 依赖检查 ----
echo "== 检查依赖 =="
for cmd in python3 curl termux-notification termux-job-scheduler; do
    if command -v "$cmd" >/dev/null 2>&1; then
        echo "  [OK] $cmd"
    else
        echo "  [缺] $cmd —— 请运行: pkg install python termux-api"
    fi
done

# ---- 目录准备 ----
mkdir -p "$BIN_DIR" "$SHORTCUTS_DIR"

# ---- 复制脚本 ----
echo "== 复制脚本 =="
cp -f "$EXT_DIR/bridge.py"         "$BIN_DIR/wake_bridge.py"
cp -f "$EXT_DIR/morning.py"        "$HOME/morning.py"
cp -f "$EXT_DIR/wake_job.sh"       "$BIN_DIR/wake_job.sh"
cp -f "$EXT_DIR/wake_cancel.sh"    "$BIN_DIR/wake_cancel.sh"
cp -f "$EXT_DIR/wake_quick.sh"     "$SHORTCUTS_DIR/wake_quick.sh"
cp -f "$EXT_DIR/wake_dialog.sh"    "$SHORTCUTS_DIR/wake_dialog.sh"
chmod +x "$BIN_DIR/wake_bridge.py" "$HOME/morning.py" \
         "$BIN_DIR/wake_job.sh"    "$BIN_DIR/wake_cancel.sh" \
         "$SHORTCUTS_DIR/wake_quick.sh" "$SHORTCUTS_DIR/wake_dialog.sh"
echo "  已部署:"
echo "    bridge.py        -> $BIN_DIR/wake_bridge.py"
echo "    morning.py       -> $HOME/morning.py"
echo "    wake_job.sh      -> $BIN_DIR/wake_job.sh"
echo "    wake_cancel.sh   -> $BIN_DIR/wake_cancel.sh"
echo "    wake_quick.sh    -> $SHORTCUTS_DIR/wake_quick.sh（桌面图标菜单）"
echo "    wake_dialog.sh   -> $SHORTCUTS_DIR/wake_dialog.sh（桌面时间选择器）"

# ---- 默认配置（存在则不覆盖，避免改过的配置丢失）----
if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" <<EOF
{
    "bridge_key": "wake-2026",
    "api_wake_key": "wake-2026",
    "api_base": "",
    "api_key": "",
    "model": "",
    "gen_mode": "auto",
    "gen_custom_text": "",
    "gen_character": "",
    "gen_worldinfo": ""
}
EOF
    echo "== 已生成默认配置 $CONFIG_FILE =="
    echo "  密钥默认: wake-2026（正式使用请到酒馆扩展设置里修改，保存后自动同步）"
else
    echo "== 配置已存在，跳过生成 =="
fi

# ---- 启动桥服务（幂等）----
if pgrep -f "wake_bridge.py" >/dev/null 2>&1; then
    echo "== 桥服务已在运行 =="
else
    nohup python3 "$BIN_DIR/wake_bridge.py" > "$HOME/wake_bridge.log" 2>&1 &
    sleep 1
    if pgrep -f "wake_bridge.py" >/dev/null 2>&1; then
        echo "== 桥服务已启动（日志: ~/wake_bridge.log）=="
    else
        echo "== 桥服务启动失败，请查看 ~/wake_bridge.log =="
    fi
fi

echo ""
echo "======== 部署完成 ========"
echo "接下来：在酒馆扩展设置面板里填好 AI API 配置（api_base/api_key/model）"
echo "并点「保存」——会自动同步到 Termux。之后直接说晚安就能用。"
echo "提示：给 Termux 开启后台运行并关闭电池优化，定时任务才可靠。"
