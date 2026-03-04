# Contributing to GEO AI Shopify

Thanks for your interest in contributing! GEO AI Shopify is an open-source Shopify app and we welcome pull requests, bug reports, and feature suggestions.

## Getting Started

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

## Requirements

- Node.js 20+
- Shopify Partner account
- Shopify CLI (`npm install -g @shopify/cli`)

## Project Structure

```
geo-ai-shopify/
├── app/
│   ├── components/       # React (Polaris) UI components
│   ├── routes/           # Remix file-based routing
│   ├── services/         # Server-side business logic (.server.ts)
│   └── utils/            # Shared utilities and constants
├── extensions/
│   └── geo-ai-seo/      # Theme Extension (Liquid templates)
├── prisma/
│   └── schema.prisma     # Database schema
└── package.json
```

## Coding Standards

This project uses TypeScript with strict mode and follows these conventions:

- TypeScript strict mode enabled
- ESLint with Remix config (`npm run lint`)
- Path aliases: `~/` maps to `./app/`
- Server-only code uses `.server.ts` suffix (never bundled to client)
- Services are stateless classes, instantiated per-request (no singletons)
- All admin routes authenticate via `authenticate.admin(request)`
- All proxy routes verify HMAC via `verifyProxySignature()`

### Naming Conventions

- Files: `kebab-case.ts` for utils/services, `PascalCase.tsx` for components
- Route files: Remix flat-file convention (`app.settings.tsx`, `api.llms.tsx`)
- Metafield namespace: `geo_ai` with keys `description`, `keywords`, `exclude`
- Database models: `PascalCase` (Prisma convention)

### Testing

Tests use Vitest with fast-check for property-based testing:

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

Test files live alongside source code in `__tests__/` directories.

## Submitting Changes

### Bug Reports

Open an [issue](https://github.com/madeburo/geo-ai-shopify/issues) with:

- Node.js version
- Shopify CLI version
- Steps to reproduce
- Expected vs. actual behavior

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main`: `git checkout -b feature/your-feature`
3. Make your changes following the coding standards above
4. Add tests for new functionality
5. Run `npm test` and `npm run lint` to verify
6. Commit with a clear message: `git commit -m "Add: brief description"`
7. Push and open a PR against `main`

### Commit Message Format

```
Add: new feature description
Fix: bug description
Update: what was changed
Remove: what was removed
```

## Database Changes

When modifying the Prisma schema:

1. Edit `prisma/schema.prisma`
2. Create a migration: `npx prisma migrate dev --name describe-change`
3. Include the migration file in your PR

## Theme Extension

The `extensions/geo-ai-seo/` directory contains Liquid templates injected into the storefront `<head>`. Changes here require `shopify app deploy` to take effect.

## Architecture Notes

- Remix v2 with Vite and file-based routing
- Shopify App Remix SDK handles OAuth, session management, and API access
- Prisma ORM with SQLite for development (any Prisma-supported DB in production)
- GraphQL wrapper (`ShopifyApiService`) handles retries, throttling, and pagination
- Webhook-driven cache invalidation with DB-based debounce (5s)
- AES-256-GCM encryption for API keys via `CryptoService`

## License

By contributing, you agree that your contributions will be licensed under the [GPL v2](LICENSE).
