import prisma from "../db.server";
import { CacheService } from "./cache.server";

/**
 * WebhookHandler — processes incoming Shopify webhooks for content changes
 * and app uninstallation.
 *
 * Content change (product/page/collection):
 *   1. Invalidate all cache keys for the shop
 *   2. Set pendingRegeneration = now + DEBOUNCE_SECONDS (DB-based debounce)
 *
 * App uninstalled:
 *   1. Delete all shop data from every table
 *   2. Note: MetafieldsService.deleteAllMetafields requires admin context
 *      which is NOT available after uninstall — Shopify cleans up metafields
 *      on its side when the app is removed.
 *
 * All handlers return successfully even on internal errors because Shopify
 * requires HTTP 200 for webhook confirmation and retries on non-2xx.
 */

const DEBOUNCE_SECONDS = 5;

const cacheService = new CacheService();

export class WebhookHandler {
  /**
   * Handle product create/update/delete webhooks.
   */
  async handleProductChange(
    shopId: string,
    topic: string,
    payload: any,
  ): Promise<void> {
    try {
      await this.handleContentChange(shopId, "product", topic, payload);
    } catch (error) {
      console.error(
        `[WebhookHandler] Error handling product change for ${shopId}:`,
        error,
      );
    }
  }

  /**
   * Handle page create/update/delete webhooks.
   */
  async handlePageChange(
    shopId: string,
    topic: string,
    payload: any,
  ): Promise<void> {
    try {
      await this.handleContentChange(shopId, "page", topic, payload);
    } catch (error) {
      console.error(
        `[WebhookHandler] Error handling page change for ${shopId}:`,
        error,
      );
    }
  }

  /**
   * Handle collection create/update/delete webhooks.
   */
  async handleCollectionChange(
    shopId: string,
    topic: string,
    payload: any,
  ): Promise<void> {
    try {
      await this.handleContentChange(shopId, "collection", topic, payload);
    } catch (error) {
      console.error(
        `[WebhookHandler] Error handling collection change for ${shopId}:`,
        error,
      );
    }
  }

  /**
   * Handle app/uninstalled webhook.
   * Deletes ALL shop data from every table in the database.
   * Metafields on Shopify side are cleaned up by Shopify automatically.
   */
  async handleAppUninstalled(shopId: string): Promise<void> {
    try {
      console.log(
        `[WebhookHandler] App uninstalled for ${shopId}, cleaning up all data`,
      );

      await Promise.all([
        prisma.appSettings.deleteMany({ where: { shopId } }),
        prisma.contentCache.deleteMany({ where: { shopId } }),
        prisma.crawlLog.deleteMany({ where: { shopId } }),
        prisma.bulkGenerationJob.deleteMany({ where: { shopId } }),
        prisma.session.deleteMany({ where: { shop: shopId } }),
      ]);

      console.log(
        `[WebhookHandler] All data deleted for ${shopId}`,
      );
    } catch (error) {
      console.error(
        `[WebhookHandler] Error cleaning up data for ${shopId}:`,
        error,
      );
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Shared logic for all content-change webhooks:
   * 1. Invalidate cache (all keys for the shop)
   * 2. Set pendingRegeneration to now + DEBOUNCE_SECONDS
   */
  private async handleContentChange(
    shopId: string,
    resourceType: string,
    topic: string,
    _payload: any,
  ): Promise<void> {
    console.log(
      `[WebhookHandler] ${topic} for ${shopId} (${resourceType})`,
    );

    // 1. Invalidate all cached content for this shop
    await cacheService.invalidate(shopId);

    // 2. DB-based debounce: set pendingRegeneration to now + 5s
    const pendingRegeneration = new Date(
      Date.now() + DEBOUNCE_SECONDS * 1000,
    );

    await prisma.appSettings.upsert({
      where: { shopId },
      update: { pendingRegeneration },
      create: { shopId, pendingRegeneration },
    });
  }
}
