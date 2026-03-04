/**
 * Protected API route: GET /api/status
 *
 * Returns file status and crawl statistics for the authenticated shop.
 * Requires a valid Shopify admin session.
 *
 * Validates: Requirements 9.3, 9.6
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { CacheService } from "../services/cache.server";
import { CrawlTracker } from "../services/crawl-tracker.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopId = session.shop;

    const settings = await prisma.appSettings.findUnique({
      where: { shopId },
    });

    const cache = new CacheService();
    const tracker = new CrawlTracker();

    // Check cache status for standard and full files
    const llmsStandard = await cache.get(shopId, "llms_standard");
    const llmsFull = await cache.get(shopId, "llms_full");

    // Crawl stats (last 30 days)
    const totalVisits = await tracker.getTotalVisits(shopId, 30);
    const recentActivity = await tracker.getRecentActivity(shopId, 30);

    return json({
      shop: shopId,
      files: {
        llmsStandard: { cached: llmsStandard !== null },
        llmsFull: { cached: llmsFull !== null },
      },
      crawl: {
        totalVisits30d: totalVisits,
        botActivity: recentActivity,
      },
      lastRegeneration: settings?.pendingRegeneration ?? null,
      llmsGenerated: settings?.llmsGenerated ?? false,
      cacheDurationHours: settings?.cacheDurationHours ?? 24,
    });
  } catch (error) {
    // authenticate.admin throws a Response on auth failure
    if (error instanceof Response) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[api/status] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
