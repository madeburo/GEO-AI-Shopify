/**
 * AiGenerator — AI description generation via Anthropic Claude or OpenAI.
 *
 * Supports single and bulk generation with rate limiting,
 * prompt template placeholders, error classification,
 * and encrypted API key decryption.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.9, 6.10
 */

import prisma from "../db.server";
import { CryptoService } from "./crypto.server";
import {
  AI_RATE_LIMIT,
  BULK_BATCH_SIZE,
  BULK_MAX_ITEMS,
  DEFAULT_PROMPT,
  MAX_DESCRIPTION_LENGTH,
} from "../utils/constants";

// ── Types ────────────────────────────────────────────────────────────────

export type AiProvider = "claude" | "openai";

export interface AiGeneratorConfig {
  provider: AiProvider;
  apiKey: string; // decrypted
  model: string;
  maxTokens: number;
  promptTemplate: string;
}

export interface ProductContext {
  title: string;
  content: string;
  type: string;
  price: string;
  category: string;
}

export interface BulkProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  status: "running" | "complete" | "error";
}

export interface AiError {
  type: "auth" | "rate_limit" | "service" | "unknown";
  message: string;
  statusCode?: number;
}

export class AiProviderError extends Error {
  type: AiError["type"];
  statusCode?: number;

  constructor(info: AiError) {
    super(info.message);
    this.name = "AiProviderError";
    this.type = info.type;
    this.statusCode = info.statusCode;
  }
}

// ── Rate limiter (in-memory, per-process) ────────────────────────────────

interface RateLimiterState {
  count: number;
  windowStart: number;
}

const RATE_WINDOW_MS = 60_000; // 1 minute

export class RateLimiter {
  private state: RateLimiterState;
  private limit: number;
  private _now: () => number;

  constructor(limit = AI_RATE_LIMIT, nowFn?: () => number) {
    this.limit = limit;
    this._now = nowFn ?? (() => Date.now());
    this.state = { count: 0, windowStart: this._now() };
  }

  /** Returns true if a request is allowed, false if rate-limited. */
  tryAcquire(): boolean {
    const now = this._now();
    if (now - this.state.windowStart >= RATE_WINDOW_MS) {
      this.state = { count: 0, windowStart: now };
    }
    if (this.state.count >= this.limit) {
      return false;
    }
    this.state.count++;
    return true;
  }

  /** Reset the limiter (useful for testing). */
  reset(): void {
    this.state = { count: 0, windowStart: this._now() };
  }
}

// ── Prompt template ──────────────────────────────────────────────────────

/**
 * Replaces placeholders {title}, {content}, {type}, {price}, {category}
 * in the prompt template with actual values from the product context.
 *
 * Uses function replacer to avoid issues with special replacement patterns
 * (e.g. `$` characters in values).
 */
export function buildPrompt(
  template: string,
  context: ProductContext,
): string {
  return template
    .replace(/\{title\}/g, () => context.title)
    .replace(/\{content\}/g, () => context.content)
    .replace(/\{type\}/g, () => context.type)
    .replace(/\{price\}/g, () => context.price)
    .replace(/\{category\}/g, () => context.category);
}

// ── Error classification ─────────────────────────────────────────────────

/**
 * Classifies an AI provider HTTP error into a user-friendly category.
 */
export function classifyAiError(
  statusCode: number,
  body?: any,
): AiError {
  if (statusCode === 401 || statusCode === 403) {
    return {
      type: "auth",
      message: "Invalid API key. Please check your key in settings.",
      statusCode,
    };
  }
  if (statusCode === 429) {
    return {
      type: "rate_limit",
      message: "AI provider rate limit exceeded. Please wait and try again.",
      statusCode,
    };
  }
  if (statusCode >= 500) {
    return {
      type: "service",
      message: "AI service is temporarily unavailable. Please try later.",
      statusCode,
    };
  }
  return {
    type: "unknown",
    message: body?.error?.message ?? "Unknown AI provider error.",
    statusCode,
  };
}

// ── Fetch wrapper (injectable for testing) ───────────────────────────────

export type FetchFn = typeof globalThis.fetch;

// ── AiGenerator ──────────────────────────────────────────────────────────

export class AiGenerator {
  private rateLimiter: RateLimiter;
  private _fetch: FetchFn;

  constructor(rateLimiter?: RateLimiter, fetchFn?: FetchFn) {
    this.rateLimiter = rateLimiter ?? new RateLimiter();
    this._fetch = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Resolves the AiGeneratorConfig from AppSettings for a given shop.
   * Decrypts the API key via CryptoService.
   */
  async getConfig(shopId: string): Promise<AiGeneratorConfig | null> {
    const settings = await prisma.appSettings.findUnique({
      where: { shopId },
    });
    if (!settings || settings.aiProvider === "none" || !settings.aiApiKeyEncrypted) {
      return null;
    }

    let apiKey: string;
    try {
      apiKey = CryptoService.decrypt(settings.aiApiKeyEncrypted);
    } catch {
      return null;
    }

    return {
      provider: settings.aiProvider as AiProvider,
      apiKey,
      model: settings.aiModel || this.defaultModel(settings.aiProvider as AiProvider),
      maxTokens: settings.aiMaxTokens || 150,
      promptTemplate: settings.aiPromptTemplate || DEFAULT_PROMPT,
    };
  }

  private defaultModel(provider: AiProvider): string {
    return provider === "claude" ? "claude-sonnet-4-5-20250514" : "gpt-4o-mini";
  }


  /**
   * Generate a single AI description for a product/page context.
   * Calls the configured AI provider and returns the trimmed result.
   */
  async generateDescription(
    config: AiGeneratorConfig,
    context: ProductContext,
  ): Promise<string> {
    if (!this.rateLimiter.tryAcquire()) {
      throw new AiProviderError({
        type: "rate_limit",
        message: "Internal rate limit exceeded. Please wait before generating more descriptions.",
      });
    }

    const prompt = buildPrompt(config.promptTemplate, context);

    const result =
      config.provider === "claude"
        ? await this.callClaude(config, prompt)
        : await this.callOpenAI(config, prompt);

    // Truncate to max description length
    return result.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  // ── Provider calls ───────────────────────────────────────────────────

  private async callClaude(
    config: AiGeneratorConfig,
    prompt: string,
  ): Promise<string> {
    const response = await this._fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new AiProviderError(classifyAiError(response.status, body));
    }

    const body = await response.json();
    const text = body?.content?.[0]?.text;
    if (typeof text !== "string") {
      throw new AiProviderError({
        type: "unknown",
        message: "Unexpected Claude API response format.",
      });
    }
    return text.trim();
  }

  private async callOpenAI(
    config: AiGeneratorConfig,
    prompt: string,
  ): Promise<string> {
    const response = await this._fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: config.maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      },
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new AiProviderError(classifyAiError(response.status, body));
    }

    const body = await response.json();
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new AiProviderError({
        type: "unknown",
        message: "Unexpected OpenAI API response format.",
      });
    }
    return text.trim();
  }

  // ── Bulk generation ────────────────────────────────────────────────────

  /**
   * Start a bulk generation job. Processes resourceIds in batches of
   * BULK_BATCH_SIZE, persisting progress to BulkGenerationJob so the
   * work survives page reloads.
   *
   * For >BULK_MAX_ITEMS resources the caller should pre-load data via
   * Shopify Bulk Operations API before invoking this method.
   */
  async bulkGenerate(
    shopId: string,
    resourceIds: string[],
    contextProvider: (resourceId: string) => Promise<ProductContext>,
  ): Promise<string> {
    const ids = resourceIds.slice(0, BULK_MAX_ITEMS);

    const config = await this.getConfig(shopId);
    if (!config) {
      throw new AiProviderError({
        type: "auth",
        message: "AI provider is not configured. Set an API key in settings.",
      });
    }

    // Create the job record
    const job = await prisma.bulkGenerationJob.create({
      data: {
        shopId,
        total: ids.length,
        resourceIds: JSON.stringify(ids),
        status: "running",
      },
    });

    // Fire-and-forget: process in background
    this.processBulkJob(job.id, config, contextProvider).catch(async (err) => {
      console.error(`Bulk generation job ${job.id} failed:`, err);
      await prisma.bulkGenerationJob
        .update({ where: { id: job.id }, data: { status: "error" } })
        .catch(() => {});
    });

    return job.id;
  }

  private async processBulkJob(
    jobId: string,
    config: AiGeneratorConfig,
    contextProvider: (resourceId: string) => Promise<ProductContext>,
  ): Promise<void> {
    const job = await prisma.bulkGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job) return;

    const ids: string[] = JSON.parse(job.resourceIds);
    let { processed, succeeded, failed, lastProcessedIndex } = job;

    for (let i = lastProcessedIndex; i < ids.length; i += BULK_BATCH_SIZE) {
      const batch = ids.slice(i, i + BULK_BATCH_SIZE);
      const results = await this.processBatch(config, batch, contextProvider);

      processed += results.processed;
      succeeded += results.succeeded;
      failed += results.failed;
      const nextIndex = Math.min(i + BULK_BATCH_SIZE, ids.length);

      await prisma.bulkGenerationJob.update({
        where: { id: jobId },
        data: {
          processed,
          succeeded,
          failed,
          lastProcessedIndex: nextIndex,
          status: nextIndex >= ids.length ? "complete" : "running",
        },
      });
    }
  }

  /**
   * Process a single batch of resource IDs sequentially.
   * Returns counts of processed / succeeded / failed items.
   */
  async processBatch(
    config: AiGeneratorConfig,
    resourceIds: string[],
    contextProvider: (resourceId: string) => Promise<ProductContext>,
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
    let succeeded = 0;
    let failed = 0;

    for (const id of resourceIds) {
      try {
        const context = await contextProvider(id);
        await this.generateDescription(config, context);
        succeeded++;
      } catch (err) {
        console.error(`AI generation failed for ${id}:`, err);
        failed++;
      }
    }

    return { processed: resourceIds.length, succeeded, failed };
  }

  /**
   * Get the current progress of a bulk generation job for a shop.
   * Returns the most recent running or completed job.
   */
  async getBulkProgress(shopId: string): Promise<BulkProgress | null> {
    const job = await prisma.bulkGenerationJob.findFirst({
      where: { shopId },
      orderBy: { createdAt: "desc" },
    });

    if (!job) return null;

    return {
      total: job.total,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      status: job.status as BulkProgress["status"],
    };
  }
}
