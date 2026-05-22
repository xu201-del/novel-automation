# AI 小说自动化写作助手

基于 DeepSeek 大模型的 AI 小说写作工具，支持智能续写、润色、大纲生成、顾问对话等全流程写作辅助。

## 功能

- **作品管理** — 创建、编辑、删除小说，设置类型和风格指南
- **章节编辑** — 三栏布局（目录 | 编辑器 | AI 面板），实时保存
- **AI 续写** — 上下文+角色+大纲驱动，流式输出，指定方向+字数
- **AI 润色** — 改善文笔，自定义风格方向
- **大纲生成** — 一键生成分卷大纲 + 人物设定
- **写作顾问** — AI 对话解答创作难题
- **角色管理** — 维护角色档案，续写时自动代入
- **章节工具** — 智能标题建议、章节摘要
- **导出** — 支持 TXT / HTML 格式

## 快速开始

```bash
pip install flask requests
set DEEPSEEK_API_KEY=sk-your-key
python app.py
# → http://localhost:8080
```

## 项目结构

```
├── app.py            # Flask 路由 + 入口
├── config.py         # 配置（API、模型参数）
├── database.py       # 数据库模型（SQLite）
├── ai_client.py      # DeepSeek API 客户端
├── static/
│   ├── app.js        # 前端逻辑
│   └── style.css     # 样式
├── templates/
│   ├── index.html    # 作品列表
│   └── novel.html    # 写作编辑器
└── requirements.txt
```

## License

MIT
