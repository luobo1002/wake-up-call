#!/data/data/com.termux/files/usr/bin/python3
# ============================================================
#  morning.py — 早上到点：生成角色"早安"回复（调一次 AI API）
#  ------------------------------------------------------------
#  流程：读 ~/wakeup_cache.json（晚上酒馆扩展缓存的角色人格+
#        最近聊天）→ 构造提示词 → 调 OpenAI 兼容 API 生成
#        一句角色早安回复 → 打印到 stdout（由 wake_job.sh 弹窗）
#  ------------------------------------------------------------
#  配置：改下面 CONFIG 里的 api_base / api_key / model
#  常见 OpenAI 兼容服务商：
#    OpenAI   https://api.openai.com/v1         gpt-4o-mini
#    DeepSeek https://api.deepseek.com/v1       deepseek-chat
#    硅基流动 https://api.siliconflow.cn/v1     填你的模型名
#    智谱     https://open.bigmodel.cn/api/paas/v4  glm-4-flash
#  （和你在酒馆里用的同一个服务商即可）
# ============================================================
import json
import os
import urllib.request
import datetime

CONFIG = {
    "api_base": "https://api.openai.com/v1",   # 换成你的 API 地址
    "api_key": "sk-xxxxxxxx",                  # 换成你的 API Key
    "model": "gpt-4o-mini",                    # 换成你的模型名
    "max_tokens": 200,
    "temperature": 0.9,
}

CACHE_FILE = os.path.expanduser("~/wakeup_cache.json")


def load_cache():
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def build_messages(cache):
    if cache and cache.get("character"):
        ch = cache["character"]
        system = (
            f"你是角色「{ch.get('name','角色')}」，现在要以这个角色的身份和用户说话。\n"
            f"人设背景：{ch.get('description','')}\n"
            f"性格：{ch.get('personality','')}\n"
            f"场景：{ch.get('scenario','')}\n"
            f"示例对话：{ch.get('mes_example','')}\n"
            f"用户称呼：{cache.get('userName','用户')}"
        )
        history = cache.get("history", [])
    else:
        system = "你是一个温柔体贴、会关心人的角色，用第二人称对用户说话。"
        history = []

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
    url = CONFIG["api_base"].rstrip("/") + "/chat/completions"
    body = json.dumps({
        "model": CONFIG["model"],
        "messages": messages,
        "max_tokens": CONFIG["max_tokens"],
        "temperature": CONFIG["temperature"],
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {CONFIG['api_key']}",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"].strip()


if __name__ == "__main__":
    cache = load_cache()
    msgs = build_messages(cache)
    try:
        print(call_api(msgs))
    except Exception as e:
        print(f"早安～（生成失败：{e}）")
