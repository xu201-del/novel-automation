import os

DATABASE = os.path.join(os.path.dirname(__file__), 'novels.db')

API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
API_BASE = "https://api.deepseek.com/v1"
API_MODEL = "deepseek-chat"

MAX_CONTEXT_CHARS = 4000
DEFAULT_WORD_COUNT = 1500

TEMPERATURE = {
    "outline": 0.7,
    "continue": 0.85,
    "improve": 0.5,
    "chat": 0.7,
}

MAX_TOKENS = {
    "outline": 2000,
    "continue": 3000,
    "improve": 3000,
    "chat": 1500,
}
