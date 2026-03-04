/**
 * Supported AI crawlers: bot User-Agent identifier → human-readable name.
 */
export const AI_BOTS: Record<string, string> = {
  'GPTBot':             'OpenAI / ChatGPT',
  'OAI-SearchBot':      'OpenAI / Copilot Search',
  'ClaudeBot':          'Anthropic / Claude',
  'Google-Extended':    'Google / Gemini',
  'PerplexityBot':      'Perplexity AI',
  'DeepSeekBot':        'DeepSeek',
  'GrokBot':            'xAI / Grok',
  'meta-externalagent': 'Meta / LLaMA',
  'PanguBot':           'Alibaba / Qwen',
  'YandexBot':          'Yandex / YandexGPT',
  'SputnikBot':         'Sber / GigaChat',
  'Bytespider':         'ByteDance / Douyin',
  'Baiduspider':        'Baidu / ERNIE',
  'claude-web':         'Anthropic / Claude Web',
  'Amazonbot':          'Amazon / Alexa',
  'Applebot':           'Apple / Siri & Spotlight',
};
