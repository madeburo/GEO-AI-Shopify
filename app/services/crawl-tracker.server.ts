import { createHash } from "crypto";

import prisma from "../db.server";
import { AI_BOTS } from "../utils/bots";
import { CLEANUP_DAYS } from "../utils/constants";

/**
 * Bot activity summary returned by getRecentActivity.
 */
export interface BotActivity {
  botName: string;
  displayName: string;
  totalVisits: number;
  lastVisit: Date;
}

/**
 * CrawlTracker — logs AI bot visits to llms.txt / llms-full.txt,
 * provides activity stats, and auto-cleans old records.
 *
 * IP addresses are anonymised via SHA-256(ip + APP_SECRET) for GDPR compliance.
 * Bot detection is substring-based against the 13 supported crawler identifiers.
 */
export class CrawlTracker {
  /**
   * Detects a known AI bot from a User-Agent string.
   * Returns the bot identifier (e.g. "GPTBot") or null if no match.
   */
  static detectBot(userAgent: string): string | null {
    if (!userAgent) return null;

    for (const botName of Object.keys(AI_BOTS)) {
      if (userAgent.includes(botName)) {
        return botName;
      }
    }

    return null;
  }

  /**
   * Produces an irreversible SHA-256 hash of the IP address
   * salted with the SHOPIFY_API_SECRET env variable.
   */
  static anonymizeIp(ip: string): string {
    const secret = process.env.SHOPIFY_API_SECRET ?? "";
    return createHash("sha256").update(ip + secret).digest("hex");
  }

  /**
   * Logs a bot visit extracted from an incoming Request.
   * Only records the visit when the User-Agent matches a known bot.
   */
  async logVisit(
    request: Request,
    fileType: string,
    shopId: string,
  ): Promise<void> {
    const userAgent = request.headers.get("user-agent") ?? "";
    const botName = CrawlTracker.detectBot(userAgent);

    if (!botName) return; // not a known bot — skip

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("cf-connecting-ip") ??
      "unknown";

    const ipHash = CrawlTracker.anonymizeIp(ip);

    await prisma.crawlLog.create({
      data: {
        shopId,
        botName,
        fileType,
        ipHash,
        userAgent,
      },
    });
  }

  /**
   * Returns per-bot activity summaries for a shop within the given window.
   * Defaults to 30 days.
   */
  async getRecentActivity(
    shopId: string,
    days: number = 30,
  ): Promise<BotActivity[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const groups = await prisma.crawlLog.groupBy({
      by: ["botName"],
      where: {
        shopId,
        accessedAt: { gte: since },
      },
      _count: { id: true },
      _max: { accessedAt: true },
    });

    return groups.map((g) => ({
      botName: g.botName,
      displayName: AI_BOTS[g.botName] ?? g.botName,
      totalVisits: g._count.id,
      lastVisit: g._max.accessedAt!,
    }));
  }

  /**
   * Returns the total number of bot visits for a shop within the given window.
   * Defaults to 30 days.
   */
  async getTotalVisits(shopId: string, days: number = 30): Promise<number> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return prisma.crawlLog.count({
      where: {
        shopId,
        accessedAt: { gte: since },
      },
    });
  }

  /**
   * Deletes crawl log records older than CLEANUP_DAYS (90) for a shop.
   */
  async cleanupOldRecords(shopId: string): Promise<void> {
    const cutoff = new Date(
      Date.now() - CLEANUP_DAYS * 24 * 60 * 60 * 1000,
    );

    await prisma.crawlLog.deleteMany({
      where: {
        shopId,
        accessedAt: { lt: cutoff },
      },
    });
  }
}
