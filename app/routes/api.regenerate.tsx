/**
 * Protected API route: POST /api/regenerate
 *
 * Forces regeneration of llms.txt and llms-full.txt files.
 * Requires a valid Shopify admin session.
 * Rate limited to 1 request per 60 seconds per shop.
 *
 * Validates: Requirements 9.4, 9.6, 9.7
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { LlmsGenerator } from "../services/llms-generator.server";
import type { AppSettings } from "../services/llms-generator.server";
import { REGENERATE_COOLDOWN_SECONDS } from "../utils/constants";

/**
 * In-memory map tracking last regeneration time per shop.
 * Key: shopId, Value: timestamp (ms) of last successful regeneration.
 */
const lastRegenerationMap = new Map<string, number>();

/** Exported for testing — allows clearing the rate limit map. */
export function _resetRateLimitMap(): void {
  lastRegenerationMap.clear();
}

/** Exported for testing — allows inspecting the rate limit map. */
export function _getLastRegeneration(shopId: string): number | undefined {
  return lastRegenerationMap.get(shopId);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { session, admin } = await authenticate.admin(request);
    const shopId = session.shop;

    // Rate limit check: 1 request per REGENERATE_COOLDOWN_SECONDS per shop
    const now = Date.now();
    const lastRegen = lastRegenerationMap.get(shopId);
    if (lastRegen && now - lastRegen < REGENERATE_COOLDOWN_SECONDS * 1000) {
      const retryAfter = Math.ceil(
        (REGENERATE_COOLDOWN_SECONDS * 1000 - (now - lastRegen)) / 1000,
      );
      return json(
        { error: "Rate limit exceeded. Try again later.", retryAfter },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        },
      );
    }

    // Load settings
    const settings = await prisma.appSettings.findUnique({
      where: { shopId },
    });

    if (!settings) {
      return json({ error: "Shop settings not found" }, { status: 404 });
    }

    // Regenerate and cache (Req 17.6: cache resilience)
    const generator = new LlmsGenerator(admin, settings as AppSettings);
    const result = await generator.regenerateAndCache();

    if (!result.success) {
      return json(
        { error: result.error ?? "Regeneration failed. Previous files are preserved." },
        { status: 500 },
      );
    }

    // Record successful regeneration time
    lastRegenerationMap.set(shopId, Date.now());

    return json({ success: true, regeneratedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof Response) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[api/regenerate] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
