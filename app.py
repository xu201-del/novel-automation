"""AI 小说写作助手 - Flask 后端"""
import sqlite3
import json
import os
import requests
from datetime import datetime
from flask import Flask, render_template, request, jsonify, g, Response, stream_with_context

app = Flask(__name__)
DATABASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'novels.db')
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
API_BASE = "https://api.deepseek.com/v1"


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.executescript('''
            CREATE TABLE IF NOT EXISTS novels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                genre TEXT DEFAULT '',
                outline TEXT DEFAULT '',
                word_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE TABLE IF NOT EXISTS chapters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                novel_id INTEGER NOT NULL,
                chapter_num INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT DEFAULT '',
                word_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'draft',
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (novel_id) REFERENCES novels(id)
            );
            CREATE TABLE IF NOT EXISTS characters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                novel_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                role TEXT DEFAULT '',
                description TEXT DEFAULT '',
                FOREIGN KEY (novel_id) REFERENCES novels(id)
            );
        ''')
        db.commit()


# ─── Pages ────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/novel/<int:novel_id>')
def novel_page(novel_id):
    return render_template('novel.html', novel_id=novel_id)


# ─── Novels API ────────────────────────────────────────

@app.route('/api/novels', methods=['GET'])
def list_novels():
    db = get_db()
    novels = db.execute(
        'SELECT n.*, (SELECT COUNT(*) FROM chapters WHERE novel_id=n.id) as chapter_count '
        'FROM novels n ORDER BY updated_at DESC'
    ).fetchall()
    return jsonify([dict(row) for row in novels])


@app.route('/api/novels', methods=['POST'])
def create_novel():
    data = request.json
    db = get_db()
    cur = db.execute(
        'INSERT INTO novels (title, genre, outline) VALUES (?, ?, ?)',
        (data.get('title', '未命名作品'), data.get('genre', ''), data.get('outline', ''))
    )
    db.commit()
    return jsonify({'id': cur.lastrowid, 'title': data.get('title')})


@app.route('/api/novels/<int:novel_id>', methods=['GET'])
def get_novel(novel_id):
    db = get_db()
    novel = db.execute('SELECT * FROM novels WHERE id = ?', (novel_id,)).fetchone()
    if not novel:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(dict(novel))


@app.route('/api/novels/<int:novel_id>', methods=['PUT'])
def update_novel(novel_id):
    data = request.json
    db = get_db()
    fields, values = [], []
    for key in ['title', 'genre', 'outline']:
        if key in data:
            fields.append(f'{key} = ?')
            values.append(data[key])
    if fields:
        fields.append("updated_at = datetime('now', 'localtime')")
        values.append(novel_id)
        db.execute(f'UPDATE novels SET {", ".join(fields)} WHERE id = ?', values)
        db.commit()
    return jsonify({'ok': True})


@app.route('/api/novels/<int:novel_id>', methods=['DELETE'])
def delete_novel(novel_id):
    db = get_db()
    db.execute('DELETE FROM chapters WHERE novel_id = ?', (novel_id,))
    db.execute('DELETE FROM characters WHERE novel_id = ?', (novel_id,))
    db.execute('DELETE FROM novels WHERE id = ?', (novel_id,))
    db.commit()
    return jsonify({'ok': True})


# ─── Chapters API ──────────────────────────────────────

@app.route('/api/novels/<int:novel_id>/chapters', methods=['GET'])
def list_chapters(novel_id):
    db = get_db()
    chapters = db.execute(
        'SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_num',
        (novel_id,)
    ).fetchall()
    return jsonify([dict(row) for row in chapters])


@app.route('/api/novels/<int:novel_id>/chapters', methods=['POST'])
def create_chapter(novel_id):
    data = request.json
    db = get_db()
    max_num = db.execute(
        'SELECT COALESCE(MAX(chapter_num), 0) as m FROM chapters WHERE novel_id = ?',
        (novel_id,)
    ).fetchone()['m']
    chapter_num = data.get('chapter_num', max_num + 1)
    title = data.get('title', f'第{chapter_num}章')
    cur = db.execute(
        'INSERT INTO chapters (novel_id, chapter_num, title, content, word_count) VALUES (?, ?, ?, ?, ?)',
        (novel_id, chapter_num, title, data.get('content', ''), len(data.get('content', '')))
    )
    # update novel word count
    db.execute(
        'UPDATE novels SET word_count = (SELECT COALESCE(SUM(word_count),0) FROM chapters WHERE novel_id = ?), '
        "updated_at = datetime('now', 'localtime') WHERE id = ?",
        (novel_id, novel_id)
    )
    db.commit()
    return jsonify({'id': cur.lastrowid, 'chapter_num': chapter_num})


@app.route('/api/chapters/<int:chapter_id>', methods=['GET'])
def get_chapter(chapter_id):
    db = get_db()
    chapter = db.execute('SELECT * FROM chapters WHERE id = ?', (chapter_id,)).fetchone()
    if not chapter:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(dict(chapter))


@app.route('/api/chapters/<int:chapter_id>', methods=['PUT'])
def update_chapter(chapter_id):
    data = request.json
    db = get_db()
    fields, values = [], []
    for key in ['title', 'content', 'status', 'chapter_num']:
        if key in data:
            fields.append(f'{key} = ?')
            values.append(data[key])
    if 'content' in data:
        fields.append('word_count = ?')
        values.append(len(data['content']))
    if fields:
        fields.append("updated_at = datetime('now', 'localtime')")
        values.append(chapter_id)
        db.execute(f'UPDATE chapters SET {", ".join(fields)} WHERE id = ?', values)
        # update novel word count
        ch = db.execute('SELECT novel_id FROM chapters WHERE id = ?', (chapter_id,)).fetchone()
        if ch:
            db.execute(
                'UPDATE novels SET word_count = (SELECT COALESCE(SUM(word_count),0) FROM chapters WHERE novel_id = ?), '
                "updated_at = datetime('now', 'localtime') WHERE id = ?",
                (ch['novel_id'], ch['novel_id'])
            )
        db.commit()
    return jsonify({'ok': True})


@app.route('/api/chapters/<int:chapter_id>', methods=['DELETE'])
def delete_chapter(chapter_id):
    db = get_db()
    ch = db.execute('SELECT novel_id FROM chapters WHERE id = ?', (chapter_id,)).fetchone()
    if ch:
        db.execute('DELETE FROM chapters WHERE id = ?', (chapter_id,))
        db.execute(
            'UPDATE novels SET word_count = (SELECT COALESCE(SUM(word_count),0) FROM chapters WHERE novel_id = ?), '
            "updated_at = datetime('now', 'localtime') WHERE id = ?",
            (ch['novel_id'], ch['novel_id'])
        )
        db.commit()
    return jsonify({'ok': True})


# ─── Characters API ────────────────────────────────────

@app.route('/api/novels/<int:novel_id>/characters', methods=['GET'])
def list_characters(novel_id):
    db = get_db()
    chars = db.execute('SELECT * FROM characters WHERE novel_id = ?', (novel_id,)).fetchall()
    return jsonify([dict(row) for row in chars])


@app.route('/api/novels/<int:novel_id>/characters', methods=['POST'])
def create_character(novel_id):
    data = request.json
    db = get_db()
    cur = db.execute(
        'INSERT INTO characters (novel_id, name, role, description) VALUES (?, ?, ?, ?)',
        (novel_id, data.get('name', ''), data.get('role', ''), data.get('description', ''))
    )
    db.commit()
    return jsonify({'id': cur.lastrowid})


@app.route('/api/characters/<int:char_id>', methods=['DELETE'])
def delete_character(char_id):
    db = get_db()
    db.execute('DELETE FROM characters WHERE id = ?', (char_id,))
    db.commit()
    return jsonify({'ok': True})


# ─── AI API ────────────────────────────────────────────

def call_deepseek(messages, temperature=0.8, max_tokens=3000, stream=False):
    headers = {
        'Authorization': f'Bearer {API_KEY}',
        'Content-Type': 'application/json'
    }
    payload = {
        'model': 'deepseek-chat',
        'messages': messages,
        'temperature': temperature,
        'max_tokens': max_tokens,
        'stream': stream
    }
    resp = requests.post(
        f'{API_BASE}/chat/completions',
        headers=headers,
        json=payload,
        timeout=120,
        stream=stream
    )
    if stream:
        return resp
    data = resp.json()
    return data['choices'][0]['message']['content']


def estimate_chinese_chars(text):
    return len([c for c in text if '一' <= c <= '鿿' or '㐀' <= c <= '䶿'])


@app.route('/api/ai/outline', methods=['POST'])
def ai_outline():
    """生成小说大纲"""
    data = request.json
    title = data.get('title', '')
    genre = data.get('genre', '')
    desc = data.get('description', '')

    prompt = f"""请为一部小说生成大纲。
小说标题：{title}
类型：{genre}
补充说明：{desc}

请包含：
1. 故事梗概（200字以内）
2. 主要人物设定（3-5个）
3. 分卷大纲（3-5卷，每卷简要说明）

用中文输出，格式清晰。"""

    messages = [{'role': 'user', 'content': prompt}]
    result = call_deepseek(messages, temperature=0.7, max_tokens=2000)
    return jsonify({'result': result})


@app.route('/api/ai/continue', methods=['POST'])
def ai_continue():
    """AI 续写 - 流式输出"""
    data = request.json
    context = data.get('context', '')
    direction = data.get('direction', '继续写下去')
    word_count = data.get('word_count', 1500)
    characters = data.get('characters', '')
    outline = data.get('outline', '')

    prompt = f"""你是一位专业网络小说作家。请根据以下内容续写小说。

【前文内容】
{context[-3000:] if len(context) > 3000 else context}

【主要角色】
{characters if characters else '沿用前文的角色设定'}

【大纲规划】
{outline if outline else '延续当前剧情发展'}

【续写要求】
{direction}
请续写约{word_count}字，保持文风一致，情节连贯，直接输出正文内容，不需要章节标题。"""

    messages = [{'role': 'user', 'content': prompt}]

    def generate():
        try:
            resp = call_deepseek(messages, temperature=0.85, max_tokens=3000, stream=True)
            full_text = ''
            for line in resp.iter_lines():
                if line:
                    line = line.decode('utf-8')
                    if line.startswith('data: '):
                        chunk = line[6:]
                        if chunk == '[DONE]':
                            break
                        try:
                            delta = json.loads(chunk)
                            content = delta['choices'][0]['delta'].get('content', '')
                            if content:
                                full_text += content
                                yield f"data: {json.dumps({'content': content})}\n\n"
                        except (json.JSONDecodeError, KeyError, IndexError):
                            pass
            yield f"data: {json.dumps({'done': True, 'full': full_text, 'word_count': estimate_chinese_chars(full_text)})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')


@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    """AI 对话 - 用于头脑风暴"""
    data = request.json
    prompt = data.get('prompt', '')
    novel_context = data.get('context', '')

    system = "你是一位专业的小说创作顾问，帮助解答写作相关的问题。回答简洁有建设性。"
    messages = [
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': f"【当前小说背景】\n{novel_context[-2000:]}\n\n【问题】\n{prompt}"}
    ] if novel_context else [
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': prompt}
    ]

    result = call_deepseek(messages, temperature=0.7, max_tokens=1500)
    return jsonify({'result': result})


@app.route('/api/ai/improve', methods=['POST'])
def ai_improve():
    """AI 润色文本"""
    data = request.json
    content = data.get('content', '')
    style = data.get('style', '')

    prompt = f"""请润色以下小说段落，{"风格要求：" + style if style else "保持原风格，改善文笔流畅度和表达。"}

【原文】
{content}

请直接输出润色后的文本，保持原意不变。"""

    messages = [{'role': 'user', 'content': prompt}]
    result = call_deepseek(messages, temperature=0.5, max_tokens=3000)
    return jsonify({'result': result})


# ─── BFF: proxy calls so the frontend stays on localhost ───

@app.route('/api/export/<int:novel_id>')
def export_novel(novel_id):
    """导出小说全文"""
    db = get_db()
    novel = db.execute('SELECT * FROM novels WHERE id = ?', (novel_id,)).fetchone()
    chapters = db.execute(
        'SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_num', (novel_id,)
    ).fetchall()

    text = f"《{novel['title']}》\n"
    text += f"类型：{novel['genre']}\n"
    text += f"总字数：{novel['word_count']}\n"
    text += "=" * 40 + "\n\n"

    for ch in chapters:
        text += f"{ch['title']}\n\n{ch['content']}\n\n{'─' * 30}\n\n"

    return Response(text, mimetype='text/plain; charset=utf-8',
                    headers={'Content-Disposition': f'attachment; filename="{novel["title"]}.txt"'})


if __name__ == '__main__':
    init_db()
    print("AI 小说写作助手已启动 → http://localhost:8080")
    app.run(host='0.0.0.0', port=8080, debug=True, threaded=True)
