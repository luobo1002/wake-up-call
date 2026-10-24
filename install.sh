#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  install.sh — Wake-Up Call 一键安装脚本（sillydroid / Termux 通用）
#  ------------------------------------------------------------
#  自动完成：
#    1) 找到酒馆目录（sillydroid 或 Termux 常见位置）
#    2) 把扩展装到标准扩展目录（不存在则 clone，已存在则 pull 更新）
#    3) 部署桥服务（调用 setup.sh，装脚本 + 配置 + 启动桥）
#  用法：
#    curl -sL https://raw.githubusercontent.com/luobo1002/wake-up-call/main/install.sh | bash
#  国内网络不稳时用镜像：
#    curl -sL https://ghfast.top/https://raw.githubusercontent.com/luobo1002/wake-up-call/main/install.sh | bash
# ============================================================

set -u

echo "== Wake-Up Call 一键安装 =="

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
  echo "【未找到酒馆目录】请在命令里手动指定，例如："
  echo "  bash install.sh /data/user/0/com.jm.sillydroid/files/android-tavern/data/server"
  exit 1
fi
echo "酒馆目录: $ST_ROOT"

# ---- 2. 扩展目标位置 ----
EXT_PARENT="$ST_ROOT/public/scripts/extensions/third-party"
EXT_DIR="$EXT_PARENT/wake-up-call"
mkdir -p "$EXT_PARENT"

# ---- 3. 拉取扩展 ----
REPO_URL="https://github.com/luobo1002/wake-up-call"
MIRROR_URL="https://ghfast.top/https://github.com/luobo1002/wake-up-call"

if [ -d "$EXT_DIR/.git" ]; then
  echo "== 扩展已存在，更新中 =="
  (cd "$EXT_DIR" && git reset --hard && git pull) || \
  (cd "$EXT_DIR" && git reset --hard && git pull "$MIRROR_URL" HEAD)
else
  echo "== 拉取扩展 =="
  rm -rf "$EXT_DIR"
  git clone "$REPO_URL" "$EXT_DIR" || git clone "$MIRROR_URL" "$EXT_DIR" || {
    echo "【拉取失败】网络连不上 GitHub，可手动下载 zip 解压到：$EXT_DIR"
    exit 1
  }
fi

# ---- 4. 部署桥 ----
echo "== 部署桥服务 =="
bash "$EXT_DIR/setup.sh"

echo ""
echo "======== 安装完成 ========"
echo "接下来："
echo "  1) 重启酒馆（完全退出 sillydroid 再打开）→ 右下角出现 ⏰ 悬浮窗"
echo "  2) 扩展设置面板里填 AI API 配置（地址/模型/Key）→ 保存"
echo "  3) 说「晚安」或点悬浮窗设置提醒即可"
echo "若桥服务启动失败，查看: ~/wake_bridge.log"
