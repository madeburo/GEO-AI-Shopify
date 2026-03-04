/**
 * Shared helpers for App Proxy routes that serve llms.txt content.
 *
 * Each proxy route verifies the Shopify App Proxy HMAC signature,
 * checks the content cache, generates on the fly when needed,
 * handles deferred regeneration, and logs bot visits.
 */

import { createHmac } from "crypto";

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { CacheService } from "../services/cache.server";
import { CrawlTracker } from "../services/crawl-tracker.server";
import { LlmsGenerator } from "../services/llms-generator.server";
import type { AppSettings } from "../services/llms-generator.server";

// ── Signature verification ───────────────────────────────────────────────

/**
 * Verify the Shopify App Proxy HMAC-SHA256 signature.
 *
 * Shopify sends query params including `signature`. Verification:
 * 1. Remove `signature` from the params
 * 2. Sort remaining params alphabetically by key
 * 3. Concatenate as key=value pairs (no separator between pairs)
 * 4. HMAC-SHA256 with SHOPIFY_API_SECRET
 * 5. Compare hex digest to the provided signature
 */
export function verifyProxySignature(url: URL): boolean {
  const params = new URLSearchParams(url.search);
  const signature = params.get("signature");

  if (!signature) return false;

  params.delete("signature");

  const sorted = Array.from(params.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const message = sorted.map(([k, v]) => `${k}=${v}`).join("");

  const secret = process.env.SHOPIFY_API_SECRET || "";
  const hmac = createHmac("sha256", secret).update(message).digest("hex");

  return hmac === signature;
}

// ── Shared proxy handler ─────────────────────────────────────────────────

interface ProxyOptions {
  /** true = llms-full.txt, false = llms.txt */
  isFull: boolean;
  /** Optional locale code (e.g. "ru", "en") */
  locale?: string;
}

/**
 * Core handler shared by all 4 proxy routes.
 *
 * Flow:
 * 1. Verify App Proxy signature → 401 on failure
 * 2. Look up AppSettings for the shop → 404 if missing
 * 3. Check cache → return cached content on hit
 * 4. Generate on the fly on cache miss
 * 5. Check pendingRegeneration → trigger background regen if overdue
 * 6. Log bot visit via CrawlTracker
 * 7. Return text/plain with Cache-Control
 */
export async function handleProxyRequest(
  request: Request,
  options: ProxyOptions,
): Promise<Response> {
  const url = new URL(request.url);

  // 1. Verify signature
  if (!verifyProxySignature(url)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Extract shop from query params (Shopify App Proxy always sends this)
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return new Response("Missing shop parameter", { status: 401 });
  }

  // 2. Look up settings
  const settings = await prisma.appSettings.findUnique({
    where: { shopId: shop },
  });

  if (!settings) {
    return new Response("Shop not found", { status: 404 });
  }

  const cache = new CacheService();
  const { isFull, locale } = options;

  // Build cache key
  const baseKey = isFull ? "llms_full" : "llms_standard";
  const cacheKey = locale ? `${baseKey}_${locale}` : baseKey;

  try {
    // 3. Check cache
    let content = await cache.get(shop, cacheKey);

    // 4. Generate on the fly if cache miss
    if (!content) {
      const { admin } = await unauthenticated.admin(shop);
      const generator = new LlmsGenerator(admin, settings as AppSettings);
      content = await generator.generate(isFull, locale);

      // Store in cache for next time
      await cache.set(shop, cacheKey, content, settings.cacheDurationHours);
    }

    // 5. Check pendingRegeneration — trigger background regen if overdue
    if (
      settings.pendingRegeneration &&
      settings.pendingRegeneration <= new Date()
    ) {
      // Fire-and-forget: don't block the response
      triggerDeferredRegeneration(shop, settings as AppSettings).catch(
        (err) => {
          console.error(
            `[proxy] Deferred regeneration failed for ${shop}:`,
            err,
          );
        },
      );
    }

    // 6. Log bot visit (fire-and-forget)
    const fileType = isFull ? "full" : "standard";
    const tracker = new CrawlTracker();
    tracker.logVisit(request, fileType, shop).catch((err) => {
      console.error(`[proxy] CrawlTracker.logVisit failed for ${shop}:`, err);
    });

    // 7. Return response
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error(`[proxy] Error serving ${cacheKey} for ${shop}:`, error);
    return new Response("Internal server error", { status: 500 });
  }
}

// ── Deferred regeneration ────────────────────────────────────────────────

/**
 * Performs deferred regeneration and resets pendingRegeneration to null.
 * Called in the background (not awaited by the proxy response).
 * Cache resilience (Req 17.6): on failure, previous cache is preserved.
 */
async function triggerDeferredRegeneration(
  shop: string,
  settings: AppSettings,
): Promise<void> {
  const { admin } = await unauthenticated.admin(shop);
  const generator = new LlmsGenerator(admin, settings);
  const result = await generator.regenerateAndCache();
  if (!result.success) {
    console.error(`[proxy] Deferred regeneration failed for ${shop}:`, result.error);
  }
}
