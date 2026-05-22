# 小说自动化项目

基于 DeepSeek 大模型的 AI 小说自动化写作工具，提供续写、润色、大纲生成等功能。

## 功能

- **作品管理**：创建、编辑、删除小说作品
- **章节编辑**：三栏布局编辑器（侧栏目录 | 正文编辑 | AI 面板）
- **AI 续写**：基于上下文、角色设定、大纲自动续写，流式输出
- **AI 润色**：改善文笔流畅度
- **AI 大纲**：自动生成分卷大纲和人物设定
- **角色管理**：添加/删除角色，AI 续写时自动代入
- **导出全文**：一键导出 TXT 文件

## 技术栈

- **后端**：Python / Flask
- **数据库**：SQLite
- **AI 模型**：DeepSeek Chat API（流式 SSE）
- **前端**：原生 HTML/CSS/JS，Linear/Notion 极简风格

## 快速开始

```bash
# 1. 安装依赖
pip install flask requests

# 2. 设置 API Key
set DEEPSEEK_API_KEY=sk-your-key-here

# 3. 启动服务
python app.py

# 4. 打开浏览器
# http://localhost:8080
```

## 项目结构

```
ai-novel-writer/
├── app.py              # Flask 后端，API + AI 调用
├── novels.db           # SQLite 数据库（自动创建）
├── static/
│   ├── app.js          # 前端逻辑
│   └── style.css       # 样式
├── templates/
│   ├── index.html      # 作品列表页
│   └── novel.html      # 编辑器页
└── requirements.txt
```

## API 说明

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/novels` | GET/POST | 作品列表 / 创建 |
| `/api/novels/:id` | GET/PUT/DELETE | 作品详情 / 更新 / 删除 |
| `/api/novels/:id/chapters` | GET/POST | 章节列表 / 创建 |
| `/api/chapters/:id` | GET/PUT/DELETE | 章节详情 / 更新 / 删除 |
| `/api/novels/:id/characters` | GET/POST | 角色列表 / 添加 |
| `/api/ai/continue` | POST (SSE) | AI 续写（流式） |
| `/api/ai/improve` | POST | AI 润色 |
| `/api/ai/outline` | POST | AI 生成大纲 |
| `/api/ai/chat` | POST | AI 写作顾问 |
| `/api/export/:id` | GET | 导出全文 |

## License

MIT
