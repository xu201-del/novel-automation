const API = '/api';

// ─── Toast ────────────────────────────────────────────

function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

// ─── Dashboard ────────────────────────────────────────

async function loadNovels() {
    const list = document.getElementById('novel-list');
    const resp = await fetch(`${API}/novels`);
    const novels = await resp.json();
    if (!novels.length) {
        list.innerHTML = '<div class="empty-hint">还没有作品，点击上方按钮创建第一本书 📝</div>';
        return;
    }
    list.innerHTML = novels.map(n => `
        <div class="novel-card" onclick="location.href='/novel/${n.id}'">
            <div class="card-cover">📚</div>
            <div class="card-body">
                <h3>《${esc(n.title)}》</h3>
                <div class="card-meta">
                    <span>${esc(n.genre) || '未分类'}</span>
                    <span>${n.chapter_count} 章</span>
                    <span>${n.word_count || 0} 字</span>
                </div>
                <div class="card-time">更新于 ${n.updated_at}</div>
            </div>
            <button class="btn-icon" onclick="event.stopPropagation();deleteNovel(${n.id})" title="删除">🗑</button>
        </div>
    `).join('');
}

function showCreateModal() {
    document.getElementById('create-modal').style.display = 'flex';
    document.getElementById('new-title').focus();
}

function closeCreateModal() {
    document.getElementById('create-modal').style.display = 'none';
    ['new-title', 'new-genre', 'new-desc'].forEach(id => document.getElementById(id).value = '');
}

async function createNovel() {
    const title = document.getElementById('new-title').value.trim();
    if (!title) return toast('请输入书名');
    const genre = document.getElementById('new-genre').value.trim();
    const desc = document.getElementById('new-desc').value.trim();
    const autoOutline = document.getElementById('auto-outline').checked;

    const resp = await fetch(`${API}/novels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, genre, outline: desc })
    });
    const novel = await resp.json();
    closeCreateModal();

    if (autoOutline && desc) {
        toast('正在生成大纲，请稍候...');
        const outlineResp = await fetch(`${API}/ai/outline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, genre, description: desc })
        });
        const outlineData = await outlineResp.json();
        await fetch(`${API}/novels/${novel.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outline: outlineData.result })
        });
    }

    loadNovels();
    toast('作品创建成功！');
    if (autoOutline) setTimeout(() => location.href = `/novel/${novel.id}`, 1000);
}

async function deleteNovel(id) {
    if (!confirm('确定删除该作品？所有章节将被永久删除。')) return;
    await fetch(`${API}/novels/${id}`, { method: 'DELETE' });
    loadNovels();
    toast('已删除');
}

// ─── Novel Editor ─────────────────────────────────────

async function initNovelPage(novelId) {
    const main = document.getElementById('main');
    const resp = await fetch(`${API}/novels/${novelId}`);
    const novel = await resp.json();
    const chaptersResp = await fetch(`${API}/novels/${novelId}/chapters`);
    const chapters = await chaptersResp.json();
    const charsResp = await fetch(`${API}/novels/${novelId}/characters`);
    const characters = await charsResp.json();

    main.innerHTML = `
        <div class="novel-layout">
            <!-- 侧边栏 -->
            <aside class="sidebar">
                <div class="novel-info">
                    <h2>《${esc(novel.title)}》</h2>
                    <p>${esc(novel.genre) || '未分类'} · ${chapters.length} 章 · ${novel.word_count || 0} 字</p>
                    <p><small>创建于 ${novel.created_at}</small></p>
                </div>
                <div class="sidebar-tabs">
                    <button class="stab active" onclick="switchTab('chapters')">📄 章节</button>
                    <button class="stab" onclick="switchTab('outline')">📋 大纲</button>
                    <button class="stab" onclick="switchTab('chars')">👥 角色</button>
                    <button class="stab" onclick="switchTab('ai')">🤖 AI 助手</button>
                </div>
                <div id="tab-content" class="tab-body"></div>
                <div class="sidebar-footer">
                    <button class="btn btn-primary" onclick="aiContinue()" style="width:100%">✨ AI 续写下一章</button>
                    <button class="btn btn-ghost" onclick="location.href='/api/export/${novelId}'" style="width:100%;margin-top:8px">📥 导出全文</button>
                </div>
            </aside>

            <!-- 编辑区 -->
            <div class="editor-area">
                <div class="editor-toolbar">
                    <select id="chapter-select" onchange="loadChapter(this.value)">
                        <option value="">选择章节编辑...</option>
                        ${chapters.map((c, i) => `<option value="${c.id}">${c.title}</option>`).join('')}
                    </select>
                    <button class="btn btn-sm" onclick="openNewChapter()">+ 新建章节</button>
                    <button class="btn btn-sm btn-ghost" onclick="aiImprove()">✨ 润色</button>
                    <span id="word-indicator">0 字</span>
                </div>
                <div id="chapter-editor">
                    <input type="text" id="chap-title" placeholder="章节标题" class="chap-title-input">
                    <textarea id="chap-content" placeholder="在这里写作，或点击 AI 续写按钮..." class="chap-content-textarea"></textarea>
                    <div class="editor-actions" id="editor-actions" style="display:none">
                        <button class="btn btn-primary" onclick="saveChapter()">💾 保存</button>
                        <button class="btn btn-ghost" onclick="deleteCurrentChapter()">🗑 删除</button>
                    </div>
                </div>
                <div id="ai-output" class="ai-output" style="display:none">
                    <div class="ai-output-header">
                        <span>🤖 AI 生成内容</span>
                        <button class="btn btn-sm" onclick="insertAIOutput()">✅ 插入正文</button>
                        <button class="btn btn-sm btn-ghost" onclick="closeAIOutput()">✕</button>
                    </div>
                    <div id="ai-text" class="ai-text"></div>
                </div>
            </div>
        </div>
    `;

    window._novel = novel;
    window._chapters = chapters;
    window._characters = characters;
    window._currentChapterId = null;
    window._aiFullText = '';

    // Load tab content
    switchTab('chapters');
}

function switchTab(tab) {
    document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    const container = document.getElementById('tab-content');

    if (tab === 'chapters') {
        const chs = window._chapters;
        container.innerHTML = chs.length
            ? `<ul class="chapter-list">${chs.map(c => `
                <li onclick="loadChapter(${c.id})" class="${window._currentChapterId == c.id ? 'active' : ''}">
                    <span>${esc(c.title)}</span>
                    <span style="color:#999;font-size:12px">${c.word_count || 0}字</span>
                </li>`).join('')}</ul>`
            : '<p class="empty-hint">暂无章节</p>';
    } else if (tab === 'outline') {
        container.innerHTML = `
            <textarea id="outline-text" class="outline-textarea" onchange="saveOutline()">${esc(window._novel.outline || '')}</textarea>
            <button class="btn btn-sm" onclick="generateOutline()" style="margin-top:8px">🤖 AI 生成大纲</button>`;
    } else if (tab === 'chars') {
        container.innerHTML = `
            ${(window._characters || []).map(c => `
                <div class="char-card">
                    <strong>${esc(c.name)}</strong> <span class="badge">${esc(c.role)}</span>
                    <p>${esc(c.description)}</p>
                    <button class="btn btn-sm btn-ghost" onclick="deleteChar(${c.id})">删除</button>
                </div>`).join('')}
            <button class="btn btn-sm" onclick="showAddChar()" style="margin-top:8px">+ 添加角色</button>`;
    } else if (tab === 'ai') {
        container.innerHTML = `
            <div class="ai-chat">
                <div id="chat-history" class="chat-history"></div>
                <div class="chat-input-row">
                    <textarea id="chat-input" placeholder="问 AI 关于写作的问题..." rows="2"></textarea>
                    <button class="btn btn-sm btn-primary" onclick="aiChat()">发送</button>
                </div>
            </div>`;
    }
}

// ─── Chapter CRUD ──────────────────────────────────────

async function loadChapter(id) {
    if (!id) return;
    const resp = await fetch(`${API}/chapters/${id}`);
    const ch = await resp.json();
    document.getElementById('chap-title').value = ch.title;
    document.getElementById('chap-content').value = ch.content;
    document.getElementById('editor-actions').style.display = 'flex';
    document.getElementById('word-indicator').textContent = (ch.word_count || 0) + ' 字';
    document.getElementById('chapter-select').value = id;
    window._currentChapterId = id;
    countWords();
}

async function openNewChapter() {
    const num = (window._chapters.length || 0) + 1;
    const resp = await fetch(`${API}/novels/${window._novel.id}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chapter_num: num,
            title: `第${num}章`,
            content: ''
        })
    });
    const newCh = await resp.json();
    // refresh chapters
    const chResp = await fetch(`${API}/novels/${window._novel.id}/chapters`);
    window._chapters = await chResp.json();
    // reload novel info
    const nResp = await fetch(`${API}/novels/${window._novel.id}`);
    window._novel = await nResp.json();
    // refresh UI
    initNovelPage(window._novel.id);
    toast('新章节已创建');
}

async function saveChapter() {
    if (!window._currentChapterId) return toast('请先选择或创建章节');
    const title = document.getElementById('chap-title').value;
    const content = document.getElementById('chap-content').value;
    await fetch(`${API}/chapters/${window._currentChapterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content })
    });
    toast('已保存 ✅');
    countWords();
    // refresh data
    const chResp = await fetch(`${API}/novels/${window._novel.id}/chapters`);
    window._chapters = await chResp.json();
    const nResp = await fetch(`${API}/novels/${window._novel.id}`);
    window._novel = await nResp.json();
    switchTab('chapters');
}

async function deleteCurrentChapter() {
    if (!window._currentChapterId) return;
    if (!confirm('确定删除此章节？')) return;
    await fetch(`${API}/chapters/${window._currentChapterId}`, { method: 'DELETE' });
    window._currentChapterId = null;
    document.getElementById('chap-title').value = '';
    document.getElementById('chap-content').value = '';
    document.getElementById('editor-actions').style.display = 'none';
    const chResp = await fetch(`${API}/novels/${window._novel.id}/chapters`);
    window._chapters = await chResp.json();
    const nResp = await fetch(`${API}/novels/${window._novel.id}`);
    window._novel = await nResp.json();
    switchTab('chapters');
    toast('已删除');
}

function countWords() {
    const content = document.getElementById('chap-content')?.value || '';
    const count = content.replace(/\s/g, '').length;
    document.getElementById('word-indicator').textContent = count + ' 字';
}

// ─── AI Features ──────────────────────────────────────

async function aiContinue() {
    const content = document.getElementById('chap-content')?.value || '';
    const direction = prompt('续写方向（可选）：', '继续推进剧情');
    if (direction === null) return;

    document.getElementById('ai-output').style.display = 'block';
    const aiText = document.getElementById('ai-text');
    aiText.innerHTML = '<span class="typing">⏳ AI 正在写作中...</span>';

    const chars = window._characters?.map(c => `${c.name}(${c.role}): ${c.description}`).join('\n') || '';

    // Collect context from last few chapters
    let context = '';
    const chs = window._chapters || [];
    const lastChs = chs.slice(-3);
    for (const ch of lastChs) {
        if (ch.content) {
            context += `${ch.title}\n${ch.content}\n\n`;
        }
    }
    if (content && !context.includes(content)) {
        context += content;
    }

    const resp = await fetch(`${API}/ai/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            context: context || '新作品，请直接开始',
            direction: direction || '继续推进剧情',
            word_count: 1500,
            characters: chars,
            outline: window._novel.outline || ''
        })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
            if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.content) {
                        fullText += data.content;
                        aiText.textContent = fullText;
                    }
                    if (data.done) {
                        window._aiFullText = data.full || fullText;
                        window._aiWordCount = data.word_count;
                    }
                } catch (e) { /* ignore parse errors */ }
            }
        }
    }
    aiText.textContent = fullText || aiText.textContent;
    window._aiFullText = fullText;
}

function insertAIOutput() {
    if (!window._aiFullText) return toast('没有可插入的内容');
    const contentArea = document.getElementById('chap-content');
    const current = contentArea.value;
    contentArea.value = current + (current ? '\n\n' : '') + window._aiFullText;
    closeAIOutput();
    countWords();
    toast('AI 内容已插入，记得保存');
}

function closeAIOutput() {
    document.getElementById('ai-output').style.display = 'none';
    window._aiFullText = '';
}

async function aiImprove() {
    const content = document.getElementById('chap-content')?.value;
    if (!content) return toast('请先写一些内容');
    const style = prompt('润色风格（可选，直接回车保持原风格）：', '');
    if (style === null) return;

    toast('正在润色...');
    const resp = await fetch(`${API}/ai/improve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, style })
    });
    const data = await resp.json();
    if (data.result) {
        document.getElementById('chap-content').value = data.result;
        countWords();
        toast('润色完成 ✅');
    }
}

async function generateOutline() {
    toast('正在生成大纲...');
    const resp = await fetch(`${API}/ai/outline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: window._novel.title,
            genre: window._novel.genre,
            description: window._novel.outline || ''
        })
    });
    const data = await resp.json();
    if (data.result) {
        document.getElementById('outline-text').value = data.result;
        saveOutline();
        toast('大纲已生成 ✅');
    }
}

async function saveOutline() {
    const outline = document.getElementById('outline-text')?.value || '';
    await fetch(`${API}/novels/${window._novel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outline })
    });
    window._novel.outline = outline;
}

async function aiChat() {
    const input = document.getElementById('chat-input');
    const prompt = input.value.trim();
    if (!prompt) return;

    const history = document.getElementById('chat-history');
    history.innerHTML += `<div class="chat-msg user"><b>我：</b>${esc(prompt)}</div>`;

    // Collect novel context
    const chs = window._chapters || [];
    let context = `《${window._novel.title}》\n类型：${window._novel.genre}\n`;
    context += `大纲：${window._novel.outline || '无'}\n`;
    context += chs.map(c => `${c.title}: ${c.content.slice(0, 200)}...`).join('\n');

    const resp = await fetch(`${API}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, context })
    });
    const data = await resp.json();
    history.innerHTML += `<div class="chat-msg ai"><b>🤖 AI：</b>${esc(data.result)}</div>`;
    history.scrollTop = history.scrollHeight;
    input.value = '';
}

async function deleteChar(id) {
    await fetch(`${API}/characters/${id}`, { method: 'DELETE' });
    const resp = await fetch(`${API}/novels/${window._novel.id}/characters`);
    window._characters = await resp.json();
    switchTab('chars');
    toast('已删除');
}

async function showAddChar() {
    const name = prompt('角色名称：');
    if (!name) return;
    const role = prompt('角色定位（主角/配角/反派）：', '配角');
    const desc = prompt('角色简介：', '');
    await fetch(`${API}/novels/${window._novel.id}/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, description: desc })
    });
    const resp = await fetch(`${API}/novels/${window._novel.id}/characters`);
    window._characters = await resp.json();
    switchTab('chars');
    toast('角色已添加');
}

// ─── Utils ────────────────────────────────────────────

function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}
