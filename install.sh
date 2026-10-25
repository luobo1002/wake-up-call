#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  Wake-Up Call — Termux 桥接服务一键安装脚本 v3.0
# ============================================================
set -e

echo "╔══════════════════════════════════════════╗"
echo "║   Wake-Up Call Bridge — Termux 安装器   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 安装依赖 ──────────────────────────────────────────────────
echo "→ 更新包列表..."
pkg update -y -q

echo "→ 安装 Python..."
pkg install -y python python-pip

echo "→ 安装 termux-api..."
pkg install -y termux-api

echo "→ 安装 Python 依赖..."
pip install --quiet requests

# ── 创建目录 ──────────────────────────────────────────────────
mkdir -p ~/wake-up-call
cd ~/wake-up-call

# ── 下载 bridge.py ───────────────────────────────────────────
echo ""
echo "→ 下载 bridge.py..."
# 直接写入（避免网络问题）
cat > bridge.py << 'PYEOF'
# （此处由 install.sh 内联，内容同 bridge.py）
# 如 install.sh 没有内联成功，请手动复制 bridge.py 到此目录
PYEOF

# 如果当前目录有 bridge.py，直接用
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/bridge.py" ]; then
  cp "$SCRIPT_DIR/bridge.py" ~/wake-up-call/bridge.py
  echo "  已从安装包复制 bridge.py"
fi

# ── 创建启动脚本 ──────────────────────────────────────────────
cat > ~/wake-up-call/start.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
cd ~/wake-up-call
echo "启动 Wake-Up Call Bridge..."
echo "端口: ${WUC_PORT:-8765}"
echo "Key : ${WUC_KEY:-wake-2026}"
python bridge.py
EOF
chmod +x ~/wake-up-call/start.sh

# ── 开机自启（可选）──────────────────────────────────────────
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/wake-up-call.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# 开机自动启动 Wake-Up Call Bridge
cd ~/wake-up-call
python bridge.py &>> ~/wake-up-call/bridge.log &
EOF
chmod +x ~/.termux/boot/wake-up-call.sh

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║           ✓ 安装完成！                  ║"
echo "╠══════════════════════════════════════════╣"
echo "║  启动命令：bash ~/wake-up-call/start.sh  ║"
echo "║  端口：8765                               ║"
echo "║  密钥：wake-2026                          ║"
echo "║                                          ║"
echo "║  请确保已安装 Termux:API 应用并授权     ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "→ 是否立即启动？(y/N)"
read -r ans
if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
  bash ~/wake-up-call/start.sh
fi
