#!/data/data/com.termux/files/usr/bin/python3
# ============================================================
#  morning.py — 早上到点：生成角色"早安"回复（调一次 AI API）
#  ------------------------------------------------------------
#  流程：读 ~/wakeup_cache.json（晚上酒馆扩展缓存的角色人格+
#        最近聊天）→ 构造提示词 → 调 OpenAI 兼容 API 生成
#        一句角色早安回复 → 打印到 stdout（由 wake_job.sh 弹窗）
#  ------------------------------------------------------------
#  AI API 配置：不用改本文件！
#    在酒馆扩展设置面板里填 api_base / api_key / model，
#    点保存会自动同步到 ~/wakeup_config.json，本脚本启动时读取。
#  常见 OpenAI 兼容服务商：
#    OpenAI   https://api.openai.com/v1         gpt-4o-mini
#    DeepSeek https://api.deepseek.com/v1       deepseek-chat
#    硅基流动 https://api.siliconflow.cn/v1     填你的模型名
#    智谱     https://open.bigmodel.cn/api/paas/v4  glm-4-flash
# ============================================================
import json
import os
import urllib.request
import datetime

CONFIG_FILE = os.path.expanduser("~/wakeup_config.json")
CACHE_FILE = os.path.expanduser("~/wakeup_cache.json")

# 默认值（配置同步前也能跑；酒馆设置面板保存后覆盖）
FALLBACK = {
    "api_base": "https://api.openai.com/v1",
    "api_key": "",
    "model": "gpt-4o-mini",
    "max_tokens": 200,
    "temperature": 0.9,
}


def load_config():
    cfg = dict(FALLBACK)
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            for k in ("api_base", "api_key", "model",
                      "gen_mode", "gen_custom_text", "gen_character", "gen_worldinfo"):
                if data.get(k):
                    cfg[k] = data[k]
    except Exception:
        pass
    return cfg


def load_cache():
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def build_messages(cache, mode="auto"):
    cfg = load_config()
    ch = (cache or {}).get("character") if cache else None
    ch_name = (ch or {}).get("name", "角色")
    ch_desc = (ch or {}).get("description", "")
    ch_personality = (ch or {}).get("personality", "")
    ch_scenario = (ch or {}).get("scenario", "")
    ch_example = (ch or {}).get("mes_example", "")
    user_name = ((cache or {}).get("userName")) or "用户"
    history = (cache or {}).get("history", []) if cache else []

    if mode == "description":
        # 仅角色设定，不读最近聊天
        system = (
            f"你是角色「{ch_name}」，现在要以这个角色的身份和用户说话。\n"
            f"人设背景：{ch_desc}\n"
            f"性格：{ch_personality}\n"
            f"场景：{ch_scenario}\n"
            f"示例对话：{ch_example}\n"
            f"用户称呼：{user_name}"
        )
        history = []
    elif mode == "worldinfo":
        # 用绑定的世界书内容生成
        wi = cfg.get("gen_worldinfo", "") or ""
        system = (
            f"你是角色「{ch_name}」，现在要以这个角色的身份和用户说话。\n"
            f"以下是世界书设定内容，请严格依据它来扮演：\n{wi}\n"
            f"用户称呼：{user_name}"
        )
        history = []
    else:
        # auto：角色设定 + 最近聊天
        system = (
            f"你是角色「{ch_name}」，现在要以这个角色的身份和用户说话。\n"
            f"人设背景：{ch_desc}\n"
            f"性格：{ch_personality}\n"
            f"场景：{ch_scenario}\n"
            f"示例对话：{ch_example}\n"
            f"用户称呼：{user_name}"
        )

    messages = [{"role": "system", "content": system}]
    for m in history[-8:]:
        role = "user" if m.get("is_user") else "assistant"
        messages.append({"role": role, "content": f"{m.get('name','')}: {m.get('mes','')}"})

    now = datetime.datetime.now()
    messages.append({
        "role": "user",
        "content": (
            f"现在是早上 {now:%H:%M}，新的一天开始了。"
            "请以角色的身份，用一句不超过50字的话温柔地叫醒用户、道早安，"
            "要符合角色性格，自然口语化，不要用括号描述动作。"
        ),
    })
    return messages


def call_api(messages):
    cfg = load_config()
    if not cfg["api_key"]:
        return "早安～（请先在酒馆扩展设置里填好 AI API 配置）"
    url = cfg["api_base"].rstrip("/") + "/chat/completions"
    body = json.dumps({
        "model": cfg["model"],
        "messages": messages,
        "max_tokens": cfg["max_tokens"],
        "temperature": cfg["temperature"],
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['api_key']}",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"].strip()


if __name__ == "__main__":
    cfg = load_config()
    mode = cfg.get("gen_mode", "auto")
    # 自定义文本模式：直接发固定内容，不调 AI
    if mode == "custom" and cfg.get("gen_custom_text"):
        print(cfg["gen_custom_text"].strip())
    else:
        cache = load_cache()
        msgs = build_messages(cache, mode)
        try:
            print(call_api(msgs))
        except Exception as e:
            print(f"早安～（生成失败：{e}）")
