/**
 * Shared helper for public API routes that serve llms.txt content.
 *
 * Unlike the App Proxy routes, these do NOT require HMAC signature
 * verification — they are fully public endpoints.
 *
 * Flow:
 * 1. Extract `shop` from query params → 400 if missing
 * 1b. Validate shop format → 400 if invalid
 * 1c. Check rate limit → 429 if exceeded
 * 2. Look up AppSettings for the shop → 404 if not found
 * 3. Check cache → return cached content on hit
 * 4. Generate on the fly on cache miss
 * 5. Return text/plain with Cache-Control header
 */

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { CacheService } from "../services/cache.server";
import { LlmsGenerator } from "../services/llms-generator.server";
import type { AppSettings } from "../services/llms-generator.server";

// ---------------------------------------------------------------------------
// Shop parameter validation
// ---------------------------------------------------------------------------

const SHOP_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/**
 * Validates that a shop parameter matches the expected Shopify domain format.
 * Only `*.myshopify.com` domains are accepted.
 */
export function validateShopParam(shop: string): boolean {
  return SHOP_PATTERN.test(shop);
}

// ---------------------------------------------------------------------------
// In-memory rate limiter (per shop)
// ---------------------------------------------------------------------------

/**
 * NOTE: This is an in-memory rate limiter — state is per-process.
 * When running multiple instances (horizontal scaling), each instance
 * maintains its own independent counters. This means the effective
 * limit across N instances is N × RATE_LIMIT_MAX per window.
 * For production with multiple instances, consider Redis or DB-based
 * rate limiting for shared state.
 */

export const RATE_LIMIT_MAX = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

export const rateLimitMap = new Map<
  string,
  { count: number; resetAt: number }
>();

function checkRateLimit(shop: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(shop);

  if (!entry || now >= entry.resetAt) {
    // New window
    rateLimitMap.set(shop, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count < RATE_LIMIT_MAX) {
    entry.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // Rate limit exceeded
  const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
  return { allowed: false, retryAfterSeconds };
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Append CORS headers to an existing Response. */
function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Public API handler
// ---------------------------------------------------------------------------

interface PublicLlmsOptions {
  /** true = llms-full.txt, false = llms.txt */
  isFull: boolean;
}

export async function handlePublicLlmsRequest(
  request: Request,
  options: PublicLlmsOptions,
): Promise<Response> {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);

  // 1. Extract shop from query params
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return withCors(new Response("Missing required query parameter: shop", {
      status: 400,
    }));
  }

  // 1b. Validate shop format
  if (!validateShopParam(shop)) {
    return withCors(new Response("Invalid shop parameter format", {
      status: 400,
    }));
  }

  // 1c. Check rate limit
  const { allowed, retryAfterSeconds } = checkRateLimit(shop);
  if (!allowed) {
    return withCors(new Response("Too many requests", {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    }));
  }

  // 2. Look up settings
  const settings = await prisma.appSettings.findUnique({
    where: { shopId: shop },
  });

  if (!settings) {
    return withCors(new Response("Shop not found", { status: 404 }));
  }

  const cache = new CacheService();
  const { isFull } = options;

  // Build cache key
  const cacheKey = isFull ? "llms_full" : "llms_standard";

  try {
    // 3. Check cache
    let content = await cache.get(shop, cacheKey);

    // 4. Generate on the fly if cache miss
    if (!content) {
      const { admin } = await unauthenticated.admin(shop);
      const generator = new LlmsGenerator(admin, settings as AppSettings);
      content = await generator.generate(isFull);

      // Store in cache for next time
      await cache.set(shop, cacheKey, content, settings.cacheDurationHours);
    }

    // 5. Return response
    return withCors(new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    }));
  } catch (error) {
    console.error(`[api] Error serving ${cacheKey} for ${shop}:`, error);
    return withCors(new Response("Internal server error", { status: 500 }));
  }
}
