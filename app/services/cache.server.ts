import prisma from "../db.server";

/**
 * CacheService — stores and retrieves generated llms.txt content
 * in the ContentCache table with TTL-based expiration.
 *
 * Cache keys: llms_standard, llms_full, llms_standard_{locale}, llms_full_{locale}
 */
export class CacheService {
  /**
   * Retrieves cached content for a shop + key pair.
   * Returns null if the entry doesn't exist or has expired.
   */
  async get(shopId: string, key: string): Promise<string | null> {
    const entry = await prisma.contentCache.findUnique({
      where: { shopId_cacheKey: { shopId, cacheKey: key } },
    });

    if (!entry) return null;

    if (entry.expiresAt <= new Date()) {
      // Expired — clean up and return null
      await prisma.contentCache
        .delete({
          where: { shopId_cacheKey: { shopId, cacheKey: key } },
        })
        .catch(() => {
          // Already deleted by another request — safe to ignore
        });
      return null;
    }

    return entry.content;
  }

  /**
   * Stores content in the cache with a TTL in hours.
   * Uses upsert so repeated writes for the same key just overwrite.
   */
  async set(
    shopId: string,
    key: string,
    value: string,
    ttlHours: number,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await prisma.contentCache.upsert({
      where: { shopId_cacheKey: { shopId, cacheKey: key } },
      update: { content: value, expiresAt },
      create: { shopId, cacheKey: key, content: value, expiresAt },
    });
  }

  /**
   * Invalidates cache entries for a shop.
   * If key is provided, only that entry is removed.
   * If key is omitted, all entries for the shop are removed.
   */
  async invalidate(shopId: string, key?: string): Promise<void> {
    if (key) {
      await prisma.contentCache
        .delete({
          where: { shopId_cacheKey: { shopId, cacheKey: key } },
        })
        .catch(() => {
          // Entry doesn't exist — nothing to invalidate
        });
    } else {
      await prisma.contentCache.deleteMany({ where: { shopId } });
    }
  }
}
