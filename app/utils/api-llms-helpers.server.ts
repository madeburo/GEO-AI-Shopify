/**
 * Shared helper for public API routes that serve llms.txt content.
 *
 * Unlike the App Proxy routes, these do NOT require HMAC signature
 * verification — they are fully public endpoints.
 *
 * Flow:
 * 1. Extract `shop` from query params → 400 if missing
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

interface PublicLlmsOptions {
  /** true = llms-full.txt, false = llms.txt */
  isFull: boolean;
}

export async function handlePublicLlmsRequest(
  request: Request,
  options: PublicLlmsOptions,
): Promise<Response> {
  const url = new URL(request.url);

  // 1. Extract shop from query params
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return new Response("Missing required query parameter: shop", {
      status: 400,
    });
  }

  // 2. Look up settings
  const settings = await prisma.appSettings.findUnique({
    where: { shopId: shop },
  });

  if (!settings) {
    return new Response("Shop not found", { status: 404 });
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
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error(`[api] Error serving ${cacheKey} for ${shop}:`, error);
    return new Response("Internal server error", { status: 500 });
  }
}
