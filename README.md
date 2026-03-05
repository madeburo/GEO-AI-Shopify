# GEO AI Shopify

![GEO AI Shopify](Geo-AI-Shopify.png)

**Generative Engine Optimization for Shopify**

[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/gpl-2.0)
[![Shopify](https://img.shields.io/badge/Shopify-App-green.svg)](https://shopify.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933.svg)](https://nodejs.org/)

An open-source Shopify app that optimizes your store for AI search engines like ChatGPT, Claude, Gemini, Perplexity, DeepSeek, Grok, YandexGPT, GigaChat, Apple Siri, Amazon Alexa, and more.

**Focus:** **Shopify-native** | **Embedded app** | **Zero-config setup**

---

## Features

### llms.txt Generator

Generates `llms.txt` and `llms-full.txt` content served via Shopify App Proxy at `/apps/llms/`. Content is cached in the database with configurable TTL and regenerated automatically on content changes via webhooks.

**Supported AI Crawlers:**
| Bot | Provider |
|-----|----------|
| GPTBot | OpenAI / ChatGPT |
| OAI-SearchBot | OpenAI / Copilot Search |
| ClaudeBot | Anthropic / Claude |
| claude-web | Anthropic / Claude Web |
| Google-Extended | Google / Gemini |
| PerplexityBot | Perplexity AI |
| DeepSeekBot | DeepSeek |
| GrokBot | xAI / Grok |
| meta-externalagent | Meta / LLaMA |
| PanguBot | Alibaba / Qwen |
| YandexBot | Yandex / YandexGPT |
| SputnikBot | Sber / GigaChat |
| Bytespider | ByteDance / Douyin |
| Baiduspider | Baidu / ERNIE |
| Amazonbot | Amazon / Alexa |
| Applebot | Apple / Siri & Spotlight |

### Metafields Integration

AI metadata stored as Shopify Metafields (namespace: `geo_ai`) on products, pages, and collections:

- **AI Description** — Concise summary for LLMs (max 200 characters)
- **AI Keywords** — Topics and context hints
- **Exclude from AI** — Opt specific content out of llms.txt
- **Generate with AI** — One-click description generation via Claude or OpenAI

### Product Data

- Products included in llms.txt with price ranges, stock status, ratings, and attributes
- Variable product support with available variations
- Sale price display (regular vs. sale)
- Collections and pages support

### AI Auto-Generation

- Generate AI descriptions via **Claude (Anthropic)** or **OpenAI** APIs
- Customizable prompt template with `{title}`, `{content}`, `{type}`, `{price}`, `{category}` placeholders
- Bulk generation for up to 50 resources (batched by 5)
- Rate limiting (10 requests/minute)
- AES-256-GCM encrypted API key storage

### SEO & AI Visibility

- Theme Extension injecting `<meta name="llms">` and JSON-LD Schema.org into storefront `<head>`
- Per-bot `robots.txt` block for merchants to copy into their theme
- Automatic cache invalidation on content changes via webhooks

### Multilingual Support

- Shopify Translations API integration
- Per-locale llms.txt files via App Proxy (`/apps/llms/{locale}`)

### Crawl Tracking

- AI bot visit logging with GDPR-compliant IP anonymization (SHA-256)
- Bot activity summary on dashboard (last 30 days)
- Auto-cleanup of records older than 90 days

### Onboarding

- Setup wizard for first-time configuration
- Onboarding checklist on dashboard

---

## Installation

### Development Setup

```bash
# Clone the repository
git clone https://github.com/madeburo/geo-ai-shopify.git
cd geo-ai-shopify

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Start development server
shopify app dev
```

### Environment Variables

Create a `.env` file with:

```env
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
ENCRYPTION_KEY=64_character_hex_string
DATABASE_URL=file:dev.db
SCOPES=read_products,write_products,read_content,write_content,read_themes,read_metafields,write_metafields,read_translations
SHOPIFY_APP_URL=https://your-app-url
```

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Production (Docker)

```bash
docker build -t geo-ai-shopify .
docker run -p 3000:3000 --env-file .env geo-ai-shopify
```

---

## Configuration

### Basic Setup

After installation, the app works with sensible defaults:

- All published products, pages, and collections are included in llms.txt
- All supported AI crawlers are allowed by default
- Cache duration: 24 hours

### Settings Page

Navigate to the Settings tab in the embedded app to configure:

- **Content Types**: Toggle products, pages, collections, blog posts
- **Bot Rules**: Allow or disallow specific AI crawlers
- **Cache**: Set regeneration frequency (1, 6, 12, 24, or 48 hours)
- **AI Generation**: Provider, API key, model, prompt template
- **Advanced**: Multilingual, crawl tracking

---

## API

### Public Endpoints

```
GET /api/llms?shop=mystore.myshopify.com
GET /api/llms/full?shop=mystore.myshopify.com
```

### App Proxy (Storefront)

```
GET /apps/llms/              → llms.txt
GET /apps/llms/{locale}      → llms.txt (per locale)
GET /apps/llms/full          → llms-full.txt
GET /apps/llms/full/{locale} → llms-full.txt (per locale)
```

### Admin Endpoints (Authenticated)

```
GET  /api/status
POST /api/regenerate
GET  /api/settings
POST /api/settings
POST /api/ai-generate
POST /api/ai-bulk
```

---

## Security

- HMAC-SHA256 signature verification on App Proxy routes using `crypto.timingSafeEqual()` (constant-time comparison)
- Mandatory `SHOPIFY_API_SECRET` — app refuses to verify signatures with an empty secret
- Shop parameter validation on public API endpoints (must match `*.myshopify.com` pattern)
- Rate limiting on public API endpoints (60 req/min per shop) with `Retry-After` header
- JSON input validation with proper error responses (HTTP 400) instead of unhandled exceptions
- CORS headers (`Access-Control-Allow-Origin: *`) on public API endpoints for cross-origin access
- AES-256-GCM encrypted API key storage
- GDPR-compliant IP anonymization (SHA-256 hashing) in crawl logs
- Database URL read from `DATABASE_URL` environment variable (not hardcoded)
- In-memory rate limiting documented with scaling recommendations for multi-instance deployments

---

## File Structure

```text
geo-ai-shopify/
├── shopify.app.toml              # Shopify app config
├── package.json                  # Dependencies and scripts
├── prisma/schema.prisma          # Database schema
├── app/
│   ├── shopify.server.ts         # Shopify app initialization
│   ├── db.server.ts              # Prisma client singleton
│   ├── components/               # React (Polaris) UI components
│   ├── routes/                   # Remix file-based routing
│   ├── services/                 # Server-side business logic
│   └── utils/                    # Shared utilities and constants
├── extensions/
│   └── geo-ai-seo/              # Theme Extension (meta tags, JSON-LD)
├── CHANGELOG.md                  # Version history
├── CONTRIBUTING.md               # Contribution guidelines
└── LICENSE                       # GPL v2
```

---

## Requirements

- Node.js 20 or higher
- Shopify Partner account
- Shopify CLI

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
git clone https://github.com/madeburo/geo-ai-shopify.git
```

---

## License

GEO AI Shopify is open-source software licensed under the [GPL v2](LICENSE).

---

## Credits

Developed by [Made Büro](https://madeburo.com) — UI-first delivery studio.

- **Author:** Made Büro
- **Website:** [madeburo.com](https://madeburo.com)
- **GitHub:** [@madeburo](https://github.com/madeburo)
- **X:** [@imadeburo](https://x.com/imadeburo)
