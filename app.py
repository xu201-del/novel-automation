"""AI 小说自动化写作助手 — Flask 后端"""
import json
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response, stream_with_context

from config import DEFAULT_WORD_COUNT
from database import get_db, init_db, close_db
import ai_client as ai

app = Flask(__name__)

# ─── Pages ────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/novel/<int:novel_id>")
def novel_page(novel_id):
    return render_template("novel.html", novel_id=novel_id)


# ─── Novels API ───────────────────────────────────────────

@app.route("/api/novels", methods=["GET"])
def list_novels():
    db = get_db()
    novels = db.execute(
        "SELECT n.*, (SELECT COUNT(*) FROM chapters WHERE novel_id=n.id) AS chapter_count "
        "FROM novels n ORDER BY updated_at DESC"
    ).fetchall()
    return jsonify([dict(r) for r in novels])


@app.route("/api/novels", methods=["POST"])
def create_novel():
    data = request.json
    db = get_db()
    cur = db.execute(
        "INSERT INTO novels (title, genre, outline, style_guide, target_words) VALUES (?, ?, ?, ?, ?)",
        (data.get("title", "未命名"), data.get("genre", ""), data.get("outline", ""),
         data.get("style_guide", ""), data.get("target_words", 0)),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid})


@app.route("/api/novels/<int:novel_id>", methods=["GET"])
def get_novel(novel_id):
    db = get_db()
    novel = db.execute("SELECT * FROM novels WHERE id = ?", (novel_id,)).fetchone()
    if not novel:
        return jsonify({"error": "Not found"}), 404
    return jsonify(dict(novel))


@app.route("/api/novels/<int:novel_id>", methods=["PUT"])
def update_novel(novel_id):
    data = request.json
    db = get_db()
    fields, vals = [], []
    for k in ["title", "genre", "outline", "style_guide", "target_words"]:
        if k in data:
            fields.append(f"{k}=?")
            vals.append(data[k])
    if fields:
        fields.append("updated_at=datetime('now','localtime')")
        vals.append(novel_id)
        db.execute(f"UPDATE novels SET {','.join(fields)} WHERE id=?", vals)
        db.commit()
    return jsonify({"ok": True})


@app.route("/api/novels/<int:novel_id>", methods=["DELETE"])
def delete_novel(novel_id):
    db = get_db()
    db.execute("DELETE FROM chapters WHERE novel_id=?", (novel_id,))
    db.execute("DELETE FROM characters WHERE novel_id=?", (novel_id,))
    db.execute("DELETE FROM plot_points WHERE novel_id=?", (novel_id,))
    db.execute("DELETE FROM novels WHERE id=?", (novel_id,))
    db.commit()
    return jsonify({"ok": True})


# ─── Chapters API ─────────────────────────────────────────

@app.route("/api/novels/<int:novel_id>/chapters", methods=["GET"])
def list_chapters(novel_id):
    db = get_db()
    rows = db.execute(
        "SELECT * FROM chapters WHERE novel_id=? ORDER BY chapter_num", (novel_id,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/novels/<int:novel_id>/chapters", methods=["POST"])
def create_chapter(novel_id):
    data = request.json
    db = get_db()
    max_num = db.execute(
        "SELECT COALESCE(MAX(chapter_num),0) AS m FROM chapters WHERE novel_id=?", (novel_id,)
    ).fetchone()["m"]
    num = data.get("chapter_num", max_num + 1)
    title = data.get("title", f"第{num}章")
    cur = db.execute(
        "INSERT INTO chapters (novel_id, chapter_num, title, content, summary, word_count) VALUES (?,?,?,?,?,?)",
        (novel_id, num, title, data.get("content", ""), data.get("summary", ""),
         len(data.get("content", ""))),
    )
    _recalc_words(db, novel_id)
    db.commit()
    return jsonify({"id": cur.lastrowid, "chapter_num": num})


@app.route("/api/chapters/<int:chapter_id>", methods=["GET"])
def get_chapter(chapter_id):
    db = get_db()
    row = db.execute("SELECT * FROM chapters WHERE id=?", (chapter_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify(dict(row))


@app.route("/api/chapters/<int:chapter_id>", methods=["PUT"])
def update_chapter(chapter_id):
    data = request.json
    db = get_db()
    fields, vals = [], []
    for k in ["title", "content", "status", "chapter_num", "summary"]:
        if k in data:
            fields.append(f"{k}=?")
            vals.append(data[k])
    if "content" in data:
        fields.append("word_count=?")
        vals.append(len(data["content"]))
    if fields:
        fields.append("updated_at=datetime('now','localtime')")
        vals.append(chapter_id)
        db.execute(f"UPDATE chapters SET {','.join(fields)} WHERE id=?", vals)
        ch = db.execute("SELECT novel_id FROM chapters WHERE id=?", (chapter_id,)).fetchone()
        if ch:
            _recalc_words(db, ch["novel_id"])
        db.commit()
    return jsonify({"ok": True})


@app.route("/api/chapters/<int:chapter_id>", methods=["DELETE"])
def delete_chapter(chapter_id):
    db = get_db()
    ch = db.execute("SELECT novel_id FROM chapters WHERE id=?", (chapter_id,)).fetchone()
    if ch:
        db.execute("DELETE FROM chapters WHERE id=?", (chapter_id,))
        _recalc_words(db, ch["novel_id"])
        db.commit()
    return jsonify({"ok": True})


# ─── Characters API ───────────────────────────────────────

@app.route("/api/novels/<int:novel_id>/characters", methods=["GET"])
def list_characters(novel_id):
    db = get_db()
    rows = db.execute("SELECT * FROM characters WHERE novel_id=?", (novel_id,)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/novels/<int:novel_id>/characters", methods=["POST"])
def create_character(novel_id):
    data = request.json
    db = get_db()
    cur = db.execute(
        "INSERT INTO characters (novel_id, name, role, personality, background) VALUES (?,?,?,?,?)",
        (novel_id, data.get("name", ""), data.get("role", ""), data.get("personality", ""),
         data.get("background", "")),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid})


@app.route("/api/characters/<int:char_id>", methods=["PUT"])
def update_character(char_id):
    data = request.json
    db = get_db()
    fields, vals = [], []
    for k in ["name", "role", "personality", "background"]:
        if k in data:
            fields.append(f"{k}=?")
            vals.append(data[k])
    if fields:
        vals.append(char_id)
        db.execute(f"UPDATE characters SET {','.join(fields)} WHERE id=?", vals)
        db.commit()
    return jsonify({"ok": True})


@app.route("/api/characters/<int:char_id>", methods=["DELETE"])
def delete_character(char_id):
    db = get_db()
    db.execute("DELETE FROM characters WHERE id=?", (char_id,))
    db.commit()
    return jsonify({"ok": True})


# ─── Plot Points API ──────────────────────────────────────

@app.route("/api/novels/<int:novel_id>/plots", methods=["GET"])
def list_plots(novel_id):
    db = get_db()
    rows = db.execute(
        "SELECT * FROM plot_points WHERE novel_id=? ORDER BY chapter_num", (novel_id,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/novels/<int:novel_id>/plots", methods=["POST"])
def create_plot(novel_id):
    data = request.json
    db = get_db()
    cur = db.execute(
        "INSERT INTO plot_points (novel_id, chapter_num, description) VALUES (?,?,?)",
        (novel_id, data.get("chapter_num"), data.get("description", "")),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid})


@app.route("/api/plots/<int:plot_id>", methods=["PUT"])
def update_plot(plot_id):
    data = request.json
    db = get_db()
    fields, vals = [], []
    for k in ["description", "resolved", "chapter_num"]:
        if k in data:
            fields.append(f"{k}=?")
            vals.append(data[k])
    if fields:
        vals.append(plot_id)
        db.execute(f"UPDATE plot_points SET {','.join(fields)} WHERE id=?", vals)
        db.commit()
    return jsonify({"ok": True})


@app.route("/api/plots/<int:plot_id>", methods=["DELETE"])
def delete_plot(plot_id):
    db = get_db()
    db.execute("DELETE FROM plot_points WHERE id=?", (plot_id,))
    db.commit()
    return jsonify({"ok": True})


# ─── AI API ───────────────────────────────────────────────

@app.route("/api/ai/outline", methods=["POST"])
def api_outline():
    data = request.json
    result = ai.generate_outline(
        title=data.get("title", ""),
        genre=data.get("genre", ""),
        description=data.get("description", ""),
        style_guide=data.get("style_guide", ""),
    )
    return jsonify({"result": result})


@app.route("/api/ai/continue", methods=["POST"])
def api_continue():
    data = request.json

    def generate():
        try:
            resp = ai.continue_writing(
                context=data.get("context", ""),
                direction=data.get("direction", "继续写"),
                word_count=data.get("word_count", DEFAULT_WORD_COUNT),
                characters=data.get("characters", ""),
                outline=data.get("outline", ""),
                style_guide=data.get("style_guide", ""),
            )
            full = ""
            for line in resp.iter_lines():
                if not line:
                    continue
                line = line.decode("utf-8")
                if line.startswith("data: "):
                    chunk = line[6:]
                    if chunk == "[DONE]":
                        break
                    try:
                        delta = json.loads(chunk)
                        content = delta["choices"][0]["delta"].get("content", "")
                        if content:
                            full += content
                            yield f"data: {json.dumps({'content': content})}\n\n"
                    except (json.JSONDecodeError, KeyError, IndexError):
                        pass
            chinese = len([c for c in full if "一" <= c <= "鿿"])
            yield f"data: {json.dumps({'done': True, 'full': full, 'word_count': chinese})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


@app.route("/api/ai/improve", methods=["POST"])
def api_improve():
    data = request.json
    result = ai.improve_text(
        content=data.get("content", ""),
        style=data.get("style", ""),
    )
    return jsonify({"result": result})


@app.route("/api/ai/chat", methods=["POST"])
def api_chat():
    data = request.json
    result = ai.chat_advisor(
        prompt=data.get("prompt", ""),
        novel_context=data.get("context", ""),
    )
    return jsonify({"result": result})


@app.route("/api/ai/title", methods=["POST"])
def api_title():
    data = request.json
    result = ai.generate_chapter_title(
        context=data.get("context", ""),
        chapter_num=data.get("chapter_num", 1),
    )
    return jsonify({"result": result})


@app.route("/api/ai/summary", methods=["POST"])
def api_summary():
    data = request.json
    result = ai.generate_summary(content=data.get("content", ""))
    return jsonify({"result": result})


# ─── Export ───────────────────────────────────────────────

@app.route("/api/export/<int:novel_id>")
def export_novel(novel_id):
    db = get_db()
    novel = db.execute("SELECT * FROM novels WHERE id=?", (novel_id,)).fetchone()
    if not novel:
        return jsonify({"error": "Not found"}), 404
    chapters = db.execute(
        "SELECT * FROM chapters WHERE novel_id=? ORDER BY chapter_num", (novel_id,)
    ).fetchall()
    fmt = request.args.get("format", "txt")

    if fmt == "html":
        html = f"<h1>{novel['title']}</h1><p>类型：{novel['genre']} | 字数：{novel['word_count']}</p><hr>"
        for ch in chapters:
            html += f"<h2>{ch['title']}</h2><div>{ch['content'].replace(chr(10), '<br>')}</div><br>"
        return Response(html, mimetype="text/html; charset=utf-8")

    text = f"《{novel['title']}》\n类型：{novel['genre']}\n总字数：{novel['word_count']}\n{'='*40}\n\n"
    for ch in chapters:
        text += f"{ch['title']}\n\n{ch['content']}\n\n{'─'*30}\n\n"
    return Response(text, mimetype="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{novel["title"]}.txt"'})


# ─── Helpers ──────────────────────────────────────────────

def _recalc_words(db, novel_id):
    db.execute(
        "UPDATE novels SET word_count=(SELECT COALESCE(SUM(word_count),0) FROM chapters WHERE novel_id=?), "
        "updated_at=datetime('now','localtime') WHERE id=?",
        (novel_id, novel_id),
    )


# ─── Entry ────────────────────────────────────────────────

if __name__ == "__main__":
    init_db(app)
    app.teardown_appcontext(close_db)
    print("AI 小说写作助手 → http://localhost:8080")
    app.run(host="0.0.0.0", port=8080, debug=True, threaded=True)
