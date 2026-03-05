# Changelog

All notable changes to GEO AI Shopify will be documented in this file.

## [0.2.0] - 2026-03-05

### Security
- HMAC signature comparison replaced with `crypto.timingSafeEqual()` to prevent timing attacks (`proxy-helpers.server.ts`)
- Empty `SHOPIFY_API_SECRET` now throws an error instead of silently using an empty HMAC key
- Shop parameter validated against `*.myshopify.com` pattern on public API endpoints — returns HTTP 400 for invalid format
- `JSON.parse()` in settings action wrapped in try/catch — returns HTTP 400 instead of unhandled 500
- Rate limiting added to public API endpoints (`/api/llms`, `/api/llms/full`): 60 req/min per shop, HTTP 429 with `Retry-After`
- CORS headers (`Access-Control-Allow-Origin: *`) added to public API responses with OPTIONS preflight support
- In-memory rate limiting limitations documented with Redis/DB-based recommendations for horizontal scaling

### Changed
- `DATABASE_URL` now read from environment variable via `env("DATABASE_URL")` in `prisma/schema.prisma` (was hardcoded `file:dev.db`)
- Docker base image updated from `node:18-alpine` to `node:20-alpine` (Node 18 EOL)
- Webhook API version in `shopify.app.toml` synced to `2025-01` (was `2024-10`, now matches `shopify.server.ts`)

### Added
- `DATABASE_URL=file:dev.db` in `.env` for development environment
- Security hardening test suite: exploration tests (6) and preservation tests (9) using Vitest + fast-check

## [0.1.1] - 2026-03-04

### Added — New AI Crawlers
- claude-web (Anthropic / Claude Web)
- Amazonbot (Amazon / Alexa)
- Applebot (Apple / Siri & Spotlight)

### Changed
- Supported AI crawlers expanded from 13 to 16

## [0.1.0] - 2026-03-04

### Added
- Shopify App Remix scaffold with Prisma, Polaris, and App Bridge
- LlmsGenerator service: generates llms.txt and llms-full.txt via Shopify Admin GraphQL API
- Products, pages, and collections with metafield-based AI descriptions
- Product data: price ranges, sale prices, stock status, variant options, reviews
- ShopifyApiService GraphQL wrapper with exponential backoff, proactive throttling, and cursor-based pagination
- CacheService with TTL-based content caching in ContentCache Prisma model
- App Proxy routes serving llms.txt at /apps/llms/ with HMAC-SHA256 signature verification
- Deferred regeneration triggered when pendingRegeneration is overdue
- Per-locale App Proxy routes (/apps/llms/{locale}, /apps/llms/full/{locale})
- Public API: GET /api/llms?shop=..., GET /api/llms/full?shop=...
- Admin API: GET /api/status, POST /api/regenerate (60s cooldown), GET/POST /api/settings
- Webhook handlers for products, pages, collections (create/update/delete) and app/uninstalled
- DB-based debounce (5s) for cache invalidation on content changes
- MetafieldsService for Shopify Metafield CRUD (namespace: geo_ai)
- Auto-registration of metafield definitions on first use
- Claude (Anthropic) and OpenAI API integration for AI description generation
- Single generation via POST /api/ai-generate, bulk via POST /api/ai-bulk
- Bulk AI generation up to 50 resources, batched by 5, rate limited 10 req/min
- BulkGenerationJob Prisma model for tracking bulk progress
- AES-256-GCM encryption for API keys via CryptoService
- Crawl tracking with GDPR-compliant IP hashing (SHA-256), auto-cleanup after 90 days
- Multilingual support via Shopify Translations API, per-locale cache keys
- Theme Extension geo-ai-seo injecting meta tags and JSON-LD into storefront head
- Onboarding wizard and checklist for first-time setup
- Dashboard page with content stats, crawl activity, and quick actions
- Products and Pages management pages with AI metadata editing
- Robots.txt block page for merchants to copy bot rules
- Settings page with all configuration sections
- 13 supported AI crawlers: GPTBot, OAI-SearchBot, ClaudeBot, Google-Extended, PerplexityBot, DeepSeekBot, GrokBot, meta-externalagent, PanguBot, YandexBot, SputnikBot, Bytespider, Baiduspider
- Prisma schema: Session, AppSettings, ContentCache, CrawlLog, BulkGenerationJob
- Docker support via Dockerfile
- Vitest test suite with property-based tests (fast-check)
