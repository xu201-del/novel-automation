const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => [...(p || document).querySelectorAll(s)];
const API = '/api';
let state = {};

function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || ''; return d.innerHTML;
}

function fmt(n) {
    if (!n) return '0';
    if (n > 10000) return (n / 10000).toFixed(1) + '万';
    return String(n);
}

// ════════════════════════════════════════════
//  Dashboard
// ════════════════════════════════════════════

async function loadList() {
    const list = $('#list');
    const novels = await fetch(`${API}/novels`).then(r => r.json());

    if (!novels.length) {
        list.outerHTML = `
            <div class="empty-state">
                <div class="icon">📖</div>
                <h3>还没有作品</h3>
                <p>创建你的第一部小说，AI 会帮你完成它</p>
                <button class="btn btn-primary" onclick="showCreate()">开始创作</button>
            </div>`;
        return;
    }

    list.innerHTML = novels.map(n => `
        <div class="card" onclick="location.href='/novel/${n.id}'">
            <div class="card-cover">📖</div>
            <div class="card-info">
                <h3>${esc(n.title)}</h3>
                <div class="card-meta">
                    <span>${esc(n.genre) || '未分类'}</span>
                    <span>${n.chapter_count} 章</span>
                    <span>${fmt(n.word_count)} 字</span>
                </div>
                <div class="card-date">更新于 ${n.updated_at}</div>
            </div>
            <button class="btn-icon" onclick="event.stopPropagation();del(${n.id})" title="删除">×</button>
        </div>
    `).join('');
}

function showCreate() { $('#modal').style.display = 'flex'; $('#m-title').focus(); }
function closeModal() { $('#modal').style.display = 'none'; }

async function create() {
    const title = $('#m-title').value.trim();
    if (!title) return toast('请输入书名');
    const r = await fetch(`${API}/novels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title,
            genre: $('#m-genre').value.trim(),
            outline: $('#m-desc').value.trim()
        })
    });
    const n = await r.json();
    closeModal();
    $('#m-title').value = $('#m-genre').value = $('#m-desc').value = '';
    loadList();
    toast('作品已创建');
}

async function del(id) {
    if (!confirm('删除此作品及所有章节？')) return;
    await fetch(`${API}/novels/${id}`, { method: 'DELETE' });
    loadList();
    toast('已删除');
}

// ════════════════════════════════════════════
//  Novel Editor
// ════════════════════════════════════════════

async function init() {
    const id = +window.location.pathname.match(/\/novel\/(\d+)/)?.[1];
    if (!id) return;

    const [novel, chapters, chars] = await Promise.all([
        fetch(`${API}/novels/${id}`).then(r => r.json()),
        fetch(`${API}/novels/${id}/chapters`).then(r => r.json()),
        fetch(`${API}/novels/${id}/characters`).then(r => r.json()),
    ]);

    state = { novel, chapters, chars, currentChapter: null, aiText: '', tab: 'chapters' };

    render();
}

function render() {
    const { novel, chapters, chars, currentChapter, tab } = state;

    $('#app').innerHTML = `
        <aside class="sidebar">
            <div class="sidebar-header">
                <h3>《${esc(novel.title)}》</h3>
                <div class="meta">${esc(novel.genre) || '未分类'}</div>
                <div class="sidebar-stats">
                    <span><strong>${chapters.length}</strong> 章</span>
                    <span><strong>${fmt(novel.word_count)}</strong> 字</span>
                </div>
            </div>
            <div class="sidebar-body">
                <div class="section-title">章节</div>
                ${chapters.map(c => `
                    <div class="chapter-item ${currentChapter && currentChapter.id === c.id ? 'active' : ''}"
                         onclick="openChapter(${c.id})">
                        <span><span class="num">${c.chapter_num}.</span>${esc(c.title)}</span>
                        <span style="font-size:11px;color:var(--text3)">${c.word_count || 0}字</span>
                    </div>
                `).join('')}
            </div>
            <div class="sidebar-footer">
                <button class="btn btn-ghost" onclick="newChapter()" style="width:100%;justify-content:center">+ 新建章节</button>
                <button class="btn btn-ghost" onclick="window.open('/api/export/${novel.id}')" style="width:100%;justify-content:center">导出全文</button>
            </div>
        </aside>

        <div class="editor">
            <div class="editor-top">
                <select onchange="openChapter(this.value)">
                    <option value="">选择章节...</option>
                    ${chapters.map(c => `<option value="${c.id}" ${currentChapter && currentChapter.id === c.id ? 'selected' : ''}>${c.title}</option>`).join('')}
                </select>
                <button class="btn btn-sm btn-ghost" onclick="aiContinue()">AI 续写</button>
                <button class="btn btn-sm btn-ghost" onclick="aiPolish()">润色</button>
                <span class="word-count" id="wc">0 字</span>
            </div>
            <div class="editor-body">
                <input class="title" id="etitle" placeholder="章节标题"
                       value="${esc(currentChapter?.title || '')}"
                       onchange="autoSave()">
                <textarea class="content" id="econtent" placeholder="开始写作，或点击「AI 续写」让 AI 帮你..."
                          oninput="updateWC()">${currentChapter?.content || ''}</textarea>
            </div>
            ${currentChapter ? `
            <div class="editor-bottom">
                <button class="btn btn-primary btn-sm" onclick="save()">保存</button>
                <button class="btn btn-ghost btn-sm" onclick="deleteChapter()">删除此章</button>
            </div>` : ''}
        </div>

        <div class="ai-panel">
            <div class="tabs">
                <button class="tab ${tab === 'chapters' ? 'active' : ''}" onclick="switchTab('chapters')">章节</button>
                <button class="tab ${tab === 'outline' ? 'active' : ''}" onclick="switchTab('outline')">大纲</button>
                <button class="tab ${tab === 'chars' ? 'active' : ''}" onclick="switchTab('chars')">角色</button>
            </div>
            <div class="ai-panel-body">
                ${tab === 'chapters' ? renderChaptersPanel() : ''}
                ${tab === 'outline' ? renderOutlinePanel() : ''}
                ${tab === 'chars' ? renderCharsPanel() : ''}
            </div>
            <div class="ai-panel-footer">
                <input id="ai-prompt" placeholder="告诉 AI 怎么写..." onkeydown="if(event.key==='Enter')aiContinue()">
                <button class="btn btn-primary btn-sm" onclick="aiContinue()">生成</button>
            </div>
        </div>
    `;

    updateWC();
}

function renderChaptersPanel() {
    const { novel, chapters } = state;
    return `
        <p style="font-size:12px;color:var(--text2);margin-bottom:10px">共 ${chapters.length} 章 · ${fmt(novel.word_count)} 字</p>
        <div style="font-size:13px;color:var(--text2);line-height:1.8">
            ${chapters.length ? `<p>最近更新：${chapters[chapters.length-1].title}</p>` : '<p>还没有章节，点击侧栏「新建章节」开始</p>'}
            <p style="margin-top:8px">💡 在下方输入续写方向，点「生成」</p>
        </div>`;
}

function renderOutlinePanel() {
    return `
        <textarea class="outline-textarea" id="ot" onchange="saveOutline()"
                  placeholder="故事的梗概、分卷规划...">${esc(state.novel.outline || '')}</textarea>
        <button class="btn btn-sm btn-ghost" style="margin-top:6px" onclick="genOutline()">AI 生成大纲</button>`;
}

function renderCharsPanel() {
    return `
        ${(state.chars || []).map(c => `
            <div class="char-row">
                <div><span class="name">${esc(c.name)}</span><span class="role">${esc(c.role)}</span></div>
                <button class="btn-icon" onclick="delChar(${c.id})">×</button>
            </div>
        `).join('')}
        <button class="btn btn-sm btn-ghost" style="margin-top:6px" onclick="addChar()">+ 添加角色</button>`;
}

function switchTab(tab) {
    state.tab = tab;
    render();
}

// ════════════════════════════════════════════
//  Chapter Ops
// ════════════════════════════════════════════

async function openChapter(id) {
    const ch = await fetch(`${API}/chapters/${id}`).then(r => r.json());
    state.currentChapter = ch;
    render();
}

async function newChapter() {
    const num = (state.chapters.length || 0) + 1;
    const r = await fetch(`${API}/novels/${state.novel.id}/chapters`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapter_num: num, title: `第${num}章`, content: '' })
    });
    const data = await r.json();
    await refresh();
    state.currentChapter = state.chapters.find(c => c.id === data.id);
    render();
    toast('新章节已创建');
}

async function save() {
    if (!state.currentChapter) return toast('请先选择章节');
    const title = $('#etitle')?.value || '';
    const content = $('#econtent')?.value || '';
    await fetch(`${API}/chapters/${state.currentChapter.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content })
    });
    await refresh();
    toast('已保存');
}

async function autoSave() { if (state.currentChapter) await save(); }

async function deleteChapter() {
    if (!state.currentChapter) return;
    if (!confirm('删除此章节？')) return;
    await fetch(`${API}/chapters/${state.currentChapter.id}`, { method: 'DELETE' });
    state.currentChapter = null;
    await refresh();
    render();
    toast('已删除');
}

function updateWC() {
    const wc = $('#wc');
    if (!wc) return;
    const t = $('#econtent')?.value || '';
    wc.textContent = t.replace(/\s/g, '').length + ' 字';
}

async function refresh() {
    const id = state.novel.id;
    const [novel, chapters, chars] = await Promise.all([
        fetch(`${API}/novels/${id}`).then(r => r.json()),
        fetch(`${API}/novels/${id}/chapters`).then(r => r.json()),
        fetch(`${API}/novels/${id}/characters`).then(r => r.json()),
    ]);
    state.novel = novel;
    state.chapters = chapters;
    state.chars = chars;
}

// ════════════════════════════════════════════
//  AI
// ════════════════════════════════════════════

async function aiContinue() {
    const prompt = $('#ai-prompt')?.value || '继续推进剧情';
    const content = $('#econtent')?.value || '';

    // gather context
    let ctx = '';
    const last3 = state.chapters.slice(-3);
    for (const ch of last3) {
        if (ch.content) ctx += `${ch.title}\n${ch.content}\n\n`;
    }
    if (content && !ctx.includes(content)) ctx += content;

    const chars = (state.chars || []).map(c => `${c.name}(${c.role}): ${c.description}`).join('\n');

    // Show loading in AI panel
    state.tab = 'chapters';
    render();
    const body = document.querySelector('.ai-panel-body');
    body.innerHTML = '<div class="ai-output">⏳ AI 正在写作...</div>';

    const resp = await fetch(`${API}/ai/continue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            context: ctx || '新作品',
            direction: prompt,
            word_count: 1500,
            characters: chars,
            outline: state.novel.outline || ''
        })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let full = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
            if (line.startsWith('data: ')) {
                try {
                    const d = JSON.parse(line.slice(6));
                    if (d.content) { full += d.content; body.innerHTML = `<div class="ai-output">${full}</div>`; }
                    if (d.done) { state.aiText = d.full || full; body.innerHTML += '<p style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="insertAI()">插入正文</button></p>'; }
                } catch (e) { /* skip */ }
            }
        }
    }
}

function insertAI() {
    if (!state.aiText) return;
    const ta = $('#econtent');
    if (!ta) return;
    ta.value = ta.value + (ta.value ? '\n\n' : '') + state.aiText;
    state.aiText = '';
    updateWC();
    autoSave();
    render();
    toast('AI 内容已插入');
}

async function aiPolish() {
    const content = $('#econtent')?.value;
    if (!content) return toast('请先写内容');
    toast('润色中...');
    const r = await fetch(`${API}/ai/improve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, style: '' })
    });
    const d = await r.json();
    if (d.result) {
        $('#econtent').value = d.result;
        updateWC();
        autoSave();
        toast('润色完成');
    }
}

async function genOutline() {
    toast('生成大纲...');
    const r = await fetch(`${API}/ai/outline`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: state.novel.title,
            genre: state.novel.genre,
            description: state.novel.outline || ''
        })
    });
    const d = await r.json();
    if (d.result) {
        const ot = $('#ot');
        if (ot) { ot.value = d.result; saveOutline(); }
        toast('大纲已生成');
    }
}

async function saveOutline() {
    const outline = $('#ot')?.value || '';
    await fetch(`${API}/novels/${state.novel.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outline })
    });
    state.novel.outline = outline;
}

// ════════════════════════════════════════════
//  Characters
// ════════════════════════════════════════════

async function addChar() {
    const name = prompt('角色名称：');
    if (!name) return;
    const role = prompt('定位（主角/配角/反派）：', '配角');
    const desc = prompt('简介：', '');
    await fetch(`${API}/novels/${state.novel.id}/characters`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, description: desc })
    });
    await refresh();
    render();
}

async function delChar(id) {
    await fetch(`${API}/characters/${id}`, { method: 'DELETE' });
    await refresh();
    render();
}
