// ─── API helpers ─────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Index page ──────────────────────────────────────────

async function loadNovels() {
  const list = $("#novel-list");
  if (!list) return;
  const novels = await api("/api/novels");
  if (!novels.length) {
    list.innerHTML = '<div class="empty"><h2>还没有作品</h2><p>点击右上角按钮创建你的第一部作品</p></div>';
    return;
  }
  list.innerHTML = novels.map(n => `
    <div class="novel-card" onclick="location='/novel/${n.id}'">
      <h3>${esc(n.title)}</h3>
      <div class="meta">
        <span>${esc(n.genre) || '未分类'}</span>
        <span>${n.chapter_count} 章</span>
        <span>${n.word_count} 字</span>
      </div>
      <div class="actions" onclick="event.stopPropagation()">
        <button class="btn" onclick="location='/novel/${n.id}'">编辑</button>
        <button class="btn danger" onclick="deleteNovel(${n.id})">删除</button>
      </div>
    </div>`).join("");
}

function showCreateModal() { $("#create-modal").classList.remove("hidden"); }
function closeCreateModal() { $("#create-modal").classList.add("hidden"); }

async function createNovel() {
  const title = $("#new-title").value.trim() || "未命名作品";
  const genre = $("#new-genre").value.trim();
  const style_guide = $("#new-style").value.trim();
  const res = await api("/api/novels", {
    method: "POST",
    body: JSON.stringify({ title, genre, style_guide }),
  });
  location.href = `/novel/${res.id}`;
}

async function deleteNovel(id) {
  if (!confirm("确认删除这部作品及其所有章节？此操作不可撤销。")) return;
  await api(`/api/novels/${id}`, { method: "DELETE" });
  loadNovels();
}

// ─── Editor page ─────────────────────────────────────────

let currentChapterId = null;
let aiFullText = "";
let improvedText = "";

async function loadEditor() {
  await loadNovelInfo();
  await loadChapters();
  await loadCharacters();
}

async function loadNovelInfo() {
  const novel = await api(`/api/novels/${NOVEL_ID}`);
  $("#novel-info").innerHTML = `
    <h2>${esc(novel.title)}</h2>
    <p>类型：${esc(novel.genre) || '未设置'}</p>
    <p>总字数：${novel.word_count}</p>
    ${novel.style_guide ? `<p>风格：${esc(novel.style_guide)}</p>` : ''}`;
}

async function loadChapters() {
  const chapters = await api(`/api/novels/${NOVEL_ID}/chapters`);
  const nav = $("#chapter-nav");
  nav.innerHTML = '<button class="btn full" onclick="addChapter()" style="margin-bottom:8px">+ 新章节</button>';
  chapters.forEach(ch => {
    const div = document.createElement("div");
    div.className = `chapter-item${ch.id === currentChapterId ? ' active' : ''}`;
    div.innerHTML = `<span>${esc(ch.title)}</span><span class="del" onclick="delChapter(${ch.id},event)">✕</span>`;
    div.onclick = (e) => { if (!e.target.classList.contains("del")) openChapter(ch.id); };
    nav.appendChild(div);
  });
}

async function addChapter() {
  const res = await api(`/api/novels/${NOVEL_ID}/chapters`, {
    method: "POST",
    body: JSON.stringify({ title: "新章节", content: "" }),
  });
  openChapter(res.id);
}

async function openChapter(id) {
  currentChapterId = id;
  const ch = await api(`/api/chapters/${id}`);
  $("#chapter-title-input").value = ch.title;
  $("#content-editor").value = ch.content;
  $("#word-count").textContent = `${ch.word_count} 字`;
  await loadChapters();
}

async function saveChapter() {
  if (!currentChapterId) return;
  const title = $("#chapter-title-input").value.trim();
  const content = $("#content-editor").value;
  await api(`/api/chapters/${currentChapterId}`, {
    method: "PUT",
    body: JSON.stringify({ title, content }),
  });
  $("#word-count").textContent = `${content.length} 字`;
  await loadChapters();
}

async function delChapter(id, ev) {
  ev.stopPropagation();
  if (!confirm("删除此章节？")) return;
  await api(`/api/chapters/${id}`, { method: "DELETE" });
  if (currentChapterId === id) { currentChapterId = null; $("#content-editor").value = ""; }
  await loadChapters();
}

// ─── Characters ──────────────────────────────────────────

async function loadCharacters() {
  const chars = await api(`/api/novels/${NOVEL_ID}/characters`);
  const panel = $("#char-panel");
  panel.innerHTML = `<h3>角色管理</h3>
    <div style="display:flex;gap:4px;margin-bottom:8px">
      <input id="char-name" placeholder="角色名" style="flex:1;padding:6px;font-size:12px">
      <button class="btn" style="padding:4px 8px;font-size:12px" onclick="addCharacter()">+</button>
    </div>` +
    chars.map(c => `<div class="char-item"><span>${esc(c.name)}${c.role ? ' ('+esc(c.role)+')' : ''}</span><span class="del" style="color:var(--danger);cursor:pointer" onclick="delChar(${c.id})">✕</span></div>`).join("");
}

async function addCharacter() {
  const name = $("#char-name").value.trim();
  if (!name) return;
  await api(`/api/novels/${NOVEL_ID}/characters`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  loadCharacters();
}

async function delChar(id) {
  await api(`/api/characters/${id}`, { method: "DELETE" });
  loadCharacters();
}

// ─── AI Panel ────────────────────────────────────────────

function switchAITab(name, btn) {
  $$(".tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  $$(".tab-content").forEach(c => c.classList.add("hidden"));
  $(`#tab-${name}`).classList.remove("hidden");
}

async function aiContinue() {
  const streamBox = $("#ai-stream");
  const btnInsert = $("#btn-insert");
  streamBox.textContent = "生成中...";
  btnInsert.classList.add("hidden");
  aiFullText = "";

  const chContent = $("#content-editor").value;
  const chars = await api(`/api/novels/${NOVEL_ID}/characters`);
  const charsStr = chars.map(c => `${c.name}(${c.role})：${c.personality || ''}`).join("\n");
  const novel = await api(`/api/novels/${NOVEL_ID}`);

  const resp = await fetch("/api/ai/continue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: chContent,
      direction: $("#ai-direction").value || "继续写下去",
      word_count: parseInt($("#ai-wordcount").value) || 1500,
      characters: charsStr,
      outline: novel.outline,
      style_guide: novel.style_guide,
    }),
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  streamBox.textContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (data.content) { streamBox.textContent += data.content; aiFullText += data.content; }
        if (data.done) { btnInsert.classList.remove("hidden"); streamBox.textContent += `\n\n— ${data.word_count} 字`; }
      }
    }
  }
}

function insertAI() {
  const editor = $("#content-editor");
  editor.value += "\n\n" + aiFullText;
  $("#ai-stream").textContent = "";
  $("#btn-insert").classList.add("hidden");
  aiFullText = "";
  saveChapter();
}

async function aiImprove() {
  const content = $("#content-editor").value;
  if (!content) return alert("请先选择或创建章节内容");
  const resultBox = $("#improve-result");
  resultBox.textContent = "润色中...";
  const data = await api("/api/ai/improve", {
    method: "POST",
    body: JSON.stringify({ content, style: $("#improve-style").value }),
  });
  improvedText = data.result;
  resultBox.textContent = data.result;
  $("#btn-replace").classList.remove("hidden");
}

function replaceImproved() {
  $("#content-editor").value = improvedText;
  $("#improve-result").textContent = "";
  $("#btn-replace").classList.add("hidden");
  saveChapter();
}

async function aiChat() {
  const prompt = $("#advisor-prompt").value.trim();
  if (!prompt) return;
  const resultBox = $("#advisor-result");
  resultBox.textContent = "思考中...";
  const novel = await api(`/api/novels/${NOVEL_ID}`);
  const data = await api("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({ prompt, context: novel.outline }),
  });
  resultBox.textContent = data.result;
}

async function aiGenerateOutline() {
  if (!confirm("将根据已有内容重新生成大纲，确定？")) return;
  const novel = await api(`/api/novels/${NOVEL_ID}`);
  const chContent = $("#content-editor").value;
  const data = await api("/api/ai/outline", {
    method: "POST",
    body: JSON.stringify({
      title: novel.title, genre: novel.genre,
      description: chContent.slice(-1000), style_guide: novel.style_guide,
    }),
  });
  await api(`/api/novels/${NOVEL_ID}`, {
    method: "PUT",
    body: JSON.stringify({ outline: data.result }),
  });
  alert("大纲已生成并保存！");
  loadNovelInfo();
}

async function aiSuggestTitle() {
  const ch = await api(`/api/chapters/${currentChapterId}`);
  if (!ch) return;
  const data = await api("/api/ai/title", {
    method: "POST",
    body: JSON.stringify({ context: ch.content, chapter_num: ch.chapter_num }),
  });
  $("#chapter-title-input").value = data.result;
  saveChapter();
}

async function aiSummarize() {
  if (!currentChapterId) return alert("请先选择章节");
  const ch = await api(`/api/chapters/${currentChapterId}`);
  const data = await api("/api/ai/summary", {
    method: "POST",
    body: JSON.stringify({ content: ch.content }),
  });
  await api(`/api/chapters/${currentChapterId}`, {
    method: "PUT",
    body: JSON.stringify({ summary: data.result }),
  });
  alert("摘要已生成");
}

function exportNovel(fmt) {
  window.open(`/api/export/${NOVEL_ID}?format=${fmt}`, "_blank");
}

// ─── Keyboard shortcuts ──────────────────────────────────

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveChapter(); }
});

// ─── Utils ───────────────────────────────────────────────

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ─── Boot ────────────────────────────────────────────────

if (window.NOVEL_ID) loadEditor(); else loadNovels();
