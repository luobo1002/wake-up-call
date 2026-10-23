# Wake-Up Call — 酒馆「定时提醒 / 叫醒」脚本

适用于 SillyTavern（Termux 本地部署，sillydroid）的一套提醒自动化：

- **任意时间**：「十五分钟后提醒我」「半小时后」「明天 7 点叫醒我」「下午 3 点半」「晚上 10 点」都支持；
- **晚安默认**：说「晚安/睡了」→ 默认时间（默认 08:00）提醒；
- **可取消**：说「取消提醒/取消闹钟」即可取消；到点通知也可点击取消；
- 到点后（**全程不打开酒馆**）：手机**普通通知弹窗**显示角色用 AI 生成的「早安」回复（调一次 API）；
- 酒馆聊天记录里会附加一条系统消息「已醒来」，带 `is_system` 标志：**显示但不进入 AI 生成上下文，不计入主线剧情**。

---

## 运行流程（完整版：全程不打开酒馆）

```
前一天晚上 你在酒馆聊天里发"晚安" / "明天7点叫醒我" / "十五分钟后提醒我"
        │
        ▼
酒馆扩展 Wake-Up Call（index.js）
        ├── 解析目标时间（相对时间 / 绝对时间 / 晚安默认 / 取消指令）
        ├── 把【角色人格 + 最近聊天记录】POST 给 Termux 桥（/cache）→ 存到 ~/wakeup_cache.json
        └── 调 Termux 桥（/schedule 或 /cancel）
                                        │
                                        ▼
                        Termux 桥 bridge.py（127.0.0.1:8765）
                        └── termux-job-scheduler      → 注册一次性后台任务
                                                            │ 到点
                                                            ▼
                                                wake_job.sh（酒馆网页全程不参与）
                                                    ├── python3 ~/morning.py
                                                    │      └── 读角色缓存 → 调 AI API（OpenAI 兼容）
                                                    │            生成角色"早安"回复
                                                    └── termux-notification 普通通知弹窗
                                                          （标题=角色名，内容=角色的话，
                                                           声音+震动，点击可取消）
```

**关键点：到点后酒馆网页（浏览器）完全不用打开**——通知是 Termux 系统通知，角色回复由 Termux 直接调 AI API 生成。酒馆只需要在前一天晚上被打开过一次（说晚安/设提醒），之后可以完全关掉。

---

## API 配置（morning.py）

编辑 `morning.py` 顶部的 `CONFIG`：

```python
CONFIG = {
    "api_base": "https://api.openai.com/v1",   # 你的 API 地址
    "api_key": "sk-xxxxxxxx",                  # 你的 API Key
    "model": "gpt-4o-mini",                    # 你的模型名
}
```

常见 OpenAI 兼容服务商（**和你在酒馆里用的同一个服务商即可**）：

| 服务商 | api_base | 示例模型 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | 填你的模型名 |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 本地 Ollama（可选） | `http://127.0.0.1:11434/v1` | `qwen2.5` 等 |

> 如果你的服务商不是 OpenAI 兼容格式（如 Anthropic Claude 原生接口），需要在 morning.py 里把 `call_api` 改成对应格式。

---

## 不打开酒馆也能被提醒（重点）

到点提醒你的东西**不依赖酒馆**，酒馆关着也一样生效：

- **普通通知弹窗**：`wake_job.sh` 里的 `termux-notification` 弹出高优先级通知横幅（声音+震动），内容就是角色生成的早安回复；
- 默认**不调系统闹钟**（`bridge.py` 里 `ALARM_ENABLED = False`）；如果你想要系统闹钟响铃，把它改成 `True` 即可（注意部分 ROM 会弹新建闹钟界面需手动确认）。

酒馆里那条"已醒来"系统消息只是附加项——酒馆没打开时，它会被写入聊天记录，下次打开酒馆即可看到，不影响提醒本身。**如果你完全不想要酒馆消息**，把 `wake_job.sh` 里的 `curl` 那几行注释掉即可。

## 独立弹窗设提醒（完全绕开酒馆）

如果连"设提醒"都不想打开酒馆，用 `wake_dialog.sh`：

```bash
mkdir -p ~/.shortcuts
cp wake_dialog.sh ~/.shortcuts/wake_dialog.sh
chmod +x ~/.shortcuts/wake_dialog.sh
pkg install termux-api termux-widget
```

然后**长按手机桌面 → 添加小部件 → Termux:Widget → 选 wake_dialog**，桌面上就会多一个按钮。点一下直接弹出系统时间选择器，选好时间就设好提醒，全程不碰酒馆。

---

## 生效范围（适配手机端使用方式）

扩展加载后默认**所有聊天都生效**——手机端任何聊天里说"晚安/明天X点"都会触发。

如果你不想主线剧情聊天被误触发，可以在扩展设置里改「生效范围」：

| 模式 | 适用场景 | 说明 |
|---|---|---|
| 所有聊天都生效 | 手机平时聊天直接用 | 任何角色聊天里说"晚安"都会设闹钟 |
| 仅指定角色聊天生效 | **新开一个"闹钟管家"聊天专用** | 在设置里填角色名白名单（逗号分隔），只有这些聊天里说"晚安"才触发；主线剧情里说"晚安"完全不触发 |
| 停用 | 临时关闭 | 完全关闭叫醒功能 |

> 角色名 = 你新建聊天时用的角色卡片名字，白名单填角色名即可（如 `闹钟管家`）。

---

## 文件说明

| 文件 | 位置 | 作用 |
|---|---|---|
| `wake-up-call/` 整个文件夹 | SillyTavern `data/<user>/extensions/` | 酒馆扩展（manifest + index.js + settings.html） |
| `bridge.py` | Termux 任意目录 | 本地 HTTP 桥：设定/取消提醒 + 接收角色缓存 |
| `morning.py` | Termux `~/` | 读角色缓存 → 调 AI API 生成角色早安回复 |
| `wake_job.sh` | Termux `~/bin/` | 到点执行：弹普通通知显示角色回复（+可选酒馆记录） |
| `wake_cancel.sh` | Termux `~/bin/` | 取消提醒（通知点击 / 手动执行） |
| `wake_dialog.sh` | Termux `~/.shortcuts/` | 桌面快捷方式弹窗，不打开酒馆直接设提醒 |

---

## 安装步骤

### 0. 安装扩展（二选一）

**方式 A — 手动安装（最稳）：**
把整个 `wake-up-call` 文件夹（或解压 `wake-up-call.zip`）放到：

```
SillyTavern/data/<user>/extensions/wake-up-call/
```

**方式 B — 填地址安装：**
1. 把 `wake-up-call.zip` 传到任意可直接下载的地址（GitHub Release、网盘直链等）；
2. 酒馆 → 右侧扩展面板 → **Install extension** → 粘贴该地址 → 安装；
3. 之后从 `data/<user>/extensions/wake-up-call/` 取出 Termux 脚本（bridge.py、morning.py、wake_job.sh、wake_cancel.sh、wake_dialog.sh）布置（见下）。

（默认用户一般是 `default-user`。）重启酒馆（或刷新扩展页）即可。扩展设置出现在酒馆右侧「扩展」面板里，可改默认提醒时间、消息模板、密钥、生效范围。

### 1. 安装 Termux 依赖

```bash
pkg install python termux-api
termux-setup-storage
```

### 2. 放好回调脚本

```bash
mkdir -p ~/bin
# 把 wake_job.sh 和 wake_cancel.sh 放到 ~/bin/ 并加执行权限
cp wake_job.sh ~/bin/wake_job.sh
cp wake_cancel.sh ~/bin/wake_cancel.sh
chmod +x ~/bin/wake_job.sh ~/bin/wake_cancel.sh
```

### 3. 启动桥服务

```bash
python3 bridge.py          # 前台测试
nohup python3 bridge.py > wake_bridge.log 2>&1 &   # 后台常驻
```

**重要**：给 Termux 开启「后台运行」（部分系统需在 Termux 设置里开启 wake-lock 常驻）并**关闭电池优化**，否则锁屏后进程会被系统杀掉，定时任务不触发：

```bash
termux-wake-lock
```

### 4. 放置 morning.py 并配置 API

```bash
cp morning.py ~/morning.py
nano ~/morning.py    # 填好 CONFIG 里的 api_base / api_key / model（见上文「API 配置」）
```

### 5. 统一密钥

四处 `wake-2026` 必须改成同一个值（防止本地其他程序误调用）：

| 文件 | 变量 |
|---|---|
| `index.js` 默认设置 | `bridgeKey` / `apiKey` |
| `bridge.py` | `KEY` |
| `wake_job.sh` | `API_KEY` |
| `wake_dialog.sh` | `KEY` |

### 6. 确认酒馆端口

SillyTavern 默认 `127.0.0.1:8000`。若你用 `--port` 改过端口，同步改 `wake_job.sh` 里的 `API_URL`。

---

## 支持的说法

| 你在聊天里说 | 效果 |
|---|---|
| 晚安 / 睡了 / 睡觉 | 默认时间（默认 08:00）提醒 + 缓存角色 |
| 明天 7 点叫醒我 / 明天7点叫我 | 明天 07:00 提醒 + 缓存角色 |
| 明天 7:30 叫我 / 明天七点半叫我 | 明天 07:30 提醒 + 缓存角色 |
| 明天 7点15分叫我 | 明天 07:15 提醒 + 缓存角色 |
| 十五分钟后提醒我 | 15 分钟后提醒 + 缓存角色 |
| 半小时后叫我 | 30 分钟后提醒 |
| 2 小时后提醒我 | 120 分钟后提醒 |
| 下午 3 点半叫我 | 当天 15:30（已过则顺延一天） |
| 晚上 10 点提醒我 | 当天 22:00 |
| 15:30 叫我 | 当天 15:30（已过则顺延一天） |
| 取消提醒 / 取消闹钟 | 取消已设定的提醒 |

到点后：**普通通知弹窗显示角色生成的早安回复**（调用你配置的 AI API，角色人格和最近聊天取自晚上缓存的 `~/wakeup_cache.json`）；点击通知可取消；酒馆聊天记录附加系统消息（可选）。

---

## 注意事项 / 已知限制

1. **提醒方式**：默认只用**普通通知弹窗**（`ALARM_ENABLED = False`），简单可靠。想要系统闹钟响铃，把 `bridge.py` 里 `ALARM_ENABLED` 改成 `True`（注意：`am start SET_ALARM` 在部分 ROM 上会弹出新建闹钟界面，需手动点一次保存）。
2. **不计入主线**：注入消息 `is_system: true`，SillyTavern 默认不把它放入 AI 生成上下文，角色不会因此自动回复，剧情不受影响。若你希望它被 AI 感知（进上下文），把 `index.js` 里 `injectSystem` 的 `is_system: true` 改为 `false` 即可。
3. **安全**：扩展端点和桥都只监听 `127.0.0.1`。**不要**给 SillyTavern 加 `--listen` 暴露到公网（否则 `/api/wake-up` 无公网防护）。
4. **定时可靠性**：依赖 Termux 进程存活（后台常驻 + 关电池优化）。Termux 被彻底划掉/重启后，需重新 `nohup python3 bridge.py &`。
5. **"明天"语义**：扩展把「明天 X 点」算成下一个自然日；若该时刻已过（如凌晨说"明天 7 点"），会再顺延一天。
6. **API 费用与失败兜底**：`morning.py` 每次到点会调一次 AI API（按你的服务商计费）。API 调用失败时弹窗会显示「早安～（生成失败：…）」兜底文案，**提醒本身不受影响**。

---

## 排障

| 现象 | 排查 |
|---|---|
| 发晚安后聊天里没有确认消息 | 看酒馆浏览器控制台（F12）有无 `[WakeUp]` 报错；确认扩展已加载（扩展面板可见设置） |
| 确认消息出现但手机没提醒 | 确认 `bridge.py` 在运行（手动测：`curl "http://127.0.0.1:8765/schedule?key=xxx&ts=$(( $(date +%s) * 1000 + 60000 ))"`）；看 `wake_bridge.log` |
| 设错了想取消 | 聊天里说「取消提醒」；或 `~/bin/wake_cancel.sh`；或点弹窗通知 |
| 到点没弹窗 | 确认 Termux 没被系统杀后台；手动执行 `~/bin/wake_job.sh` 测试；检查 `morning.py` 的 API 配置是否填对 |
| 弹窗出现了但内容是"生成失败" | `morning.py` 的 `api_base` / `api_key` / `model` 有误或网络不通；先在 Termux 手动跑 `python3 ~/morning.py` 看报错 |
| 弹窗内容是通用问候、不像角色 | 角色缓存没写入（`~/wakeup_cache.json` 不存在）——说明说晚安时 `bridge.py` 没在运行或密钥不一致，扩展没法 POST /cache |
| 到点有弹窗但酒馆记录没写入 | `wake_job.sh` 里 `API_URL` 端口或 `API_KEY` 与扩展设置不一致（不想要酒馆记录就直接注释掉 curl 行） |
