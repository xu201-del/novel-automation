import json
import requests
from config import API_KEY, API_BASE, API_MODEL, TEMPERATURE, MAX_TOKENS


def _call_api(messages, mode="outline", stream=False):
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": API_MODEL,
        "messages": messages,
        "temperature": TEMPERATURE.get(mode, 0.7),
        "max_tokens": MAX_TOKENS.get(mode, 2000),
        "stream": stream,
    }
    resp = requests.post(
        f"{API_BASE}/chat/completions",
        headers=headers,
        json=payload,
        timeout=180,
        stream=stream,
    )
    if stream:
        return resp
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def generate_outline(title, genre, description, style_guide=""):
    prompt = f"""你是一位资深小说编辑。请为以下小说生成完整大纲。

**小说标题**：{title}
**类型**：{genre}
**创作说明**：{description}
{"**风格指南**：" + style_guide if style_guide else ""}

请输出：
## 故事梗概
（200字以内的核心故事）

## 主要角色
为每个角色提供：姓名、身份、性格关键词、背景简述（3-5个角色）

## 分卷大纲
（3-5卷，每卷包含3-5个核心情节点）"""
    return _call_api([{"role": "user", "content": prompt}], mode="outline")


def continue_writing(context, direction, word_count, characters, outline, style_guide):
    prompt = f"""你是一位专业网络小说作家，请根据以下信息续写小说。

【前文内容】
{context[-3000:]}
{chr(10) + '【主要角色】' + chr(10) + characters if characters else ''}
{chr(10) + '【大纲】' + chr(10) + outline if outline else ''}
{chr(10) + '【文风要求】' + chr(10) + style_guide if style_guide else ''}

【续写方向】{direction}
【字数要求】约{word_count}字

直接输出正文，保持文风一致、情节连贯。不要加章节标题。"""
    return _call_api([{"role": "user", "content": prompt}], mode="continue", stream=True)


def improve_text(content, style=""):
    prompt = f"""请润色以下小说段落{chr(10) + '风格要求：' + style if style else '，改善文笔流畅度、增强感染力'}。

【原文】
{content}

直接输出润色后文本。"""
    return _call_api([{"role": "user", "content": prompt}], mode="improve")


def chat_advisor(prompt, novel_context=""):
    system = "你是资深小说创作顾问，提供专业写作建议。回答简洁、实用、有建设性。"
    if novel_context:
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"【小说背景】\n{novel_context[-2000:]}\n\n【问题】\n{prompt}"},
        ]
    else:
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ]
    return _call_api(messages, mode="chat")


def generate_chapter_title(context, chapter_num):
    prompt = f"""根据以下小说内容，为第{chapter_num}章生成一个吸引人的章节标题（10字以内）。

【前文】
{context[-2000:]}

只输出标题。"""
    return _call_api([{"role": "user", "content": prompt}], mode="outline", max_tokens=50)


def generate_summary(content):
    prompt = f"""为以下章节写一个简要摘要（50字以内）。

【章节内容】
{content[:2000]}

只输出摘要。"""
    return _call_api([{"role": "user", "content": prompt}], mode="outline", max_tokens=200)
