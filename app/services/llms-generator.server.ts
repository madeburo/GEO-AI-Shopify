/**
 * LlmsGenerator — generates llms.txt and llms-full.txt content
 * from Shopify store data (products, pages, collections).
 *
 * Adapts the WordPress Geo_Ai_Woo_LLMS_Generator for Shopify,
 * using GraphQL Admin API instead of WP_Query, and Shopify Metafields
 * instead of post meta.
 */

import type { AdminApiContext, PageInfo } from "./shopify-api.server";
import { ShopifyApiService } from "./shopify-api.server";
import { CacheService } from "./cache.server";
import { AI_BOTS } from "../utils/bots";
import { METAFIELD_NAMESPACE } from "./metafields.server";
import prisma from "../db.server";

// ── Multilingual types ───────────────────────────────────────────────────

export interface ShopLocale {
  locale: string;
  primary: boolean;
  published: boolean;
}

export interface TranslationEntry {
  key: string;
  value: string | null;
  locale: string;
}

export interface TranslatedResource {
  resourceId: string;
  translations: TranslationEntry[];
}

// ── Version ──────────────────────────────────────────────────────────────

const APP_VERSION = "0.1.0";

// ── Interfaces ───────────────────────────────────────────────────────────

export interface AppSettings {
  shopId: string;
  siteDescription: string;
  includeProducts: boolean;
  includePages: boolean;
  includeCollections: boolean;
  includeBlogPosts: boolean;
  botRules: string; // JSON: {"GPTBot":"allow","ClaudeBot":"disallow",...}
  cacheDurationHours: number;
  multilingualEnabled: boolean;
}

export interface ShopData {
  name: string;
  description: string;
  url: string; // primary domain URL
}

export interface ProductNode {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  status: string;
  variants: {
    edges: Array<{
      node: VariantNode;
    }>;
  };
  metafields: MetafieldEdges;
}

export interface VariantNode {
  title: string;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  inventoryPolicy: string;
  selectedOptions: Array<{ name: string; value: string }>;
}

export interface PageNode {
  id: string;
  title: string;
  handle: string;
  body: string;
  metafields: MetafieldEdges;
}

export interface CollectionNode {
  id: string;
  title: string;
  handle: string;
  description: string;
  productsCount: { count: number };
}

interface MetafieldEdges {
  edges: Array<{
    node: { namespace: string; key: string; value: string };
  }>;
}

export interface GeneratedContent {
  standard: string;
  full: string;
  generatedAt: Date;
}

// ── GraphQL queries ──────────────────────────────────────────────────────

const SHOP_QUERY = `
  query ShopInfo {
    shop {
      name
      description
      primaryDomain { url }
    }
  }
`;

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 250, after: $cursor, query: "status:active") {
      edges {
        node {
          id
          title
          handle
          descriptionHtml
          status
          variants(first: 100) {
            edges {
              node {
                title
                price
                compareAtPrice
                inventoryQuantity
                inventoryPolicy
                selectedOptions { name value }
              }
            }
          }
          metafields(namespace: "${METAFIELD_NAMESPACE}", first: 10) {
            edges { node { namespace key value } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PAGES_QUERY = `
  query Pages($cursor: String) {
    pages(first: 250, after: $cursor) {
      edges {
        node {
          id
          title
          handle
          body
          metafields(namespace: "${METAFIELD_NAMESPACE}", first: 10) {
            edges { node { namespace key value } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COLLECTIONS_QUERY = `
  query Collections($cursor: String) {
    collections(first: 250, after: $cursor) {
      edges {
        node {
          id
          title
          handle
          description
          productsCount { count }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// ── Multilingual queries ─────────────────────────────────────────────────

const SHOP_LOCALES_QUERY = `
  query ShopLocales {
    shopLocales {
      locale
      primary
      published
    }
  }
`;

const TRANSLATABLE_RESOURCES_QUERY = `
  query TranslatableResources($resourceType: TranslatableResourceType!, $locale: String!, $cursor: String) {
    translatableResources(resourceType: $resourceType, first: 250, after: $cursor) {
      edges {
        node {
          resourceId
          translations(locale: $locale) {
            key
            value
            locale
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// ── Helpers ──────────────────────────────────────────────────────────────

/** Extract a metafield value by key from a metafields edge array. */
export function getMetafieldValue(
  metafields: MetafieldEdges,
  key: string,
): string | null {
  const edge = metafields.edges.find(
    (e) => e.node.namespace === METAFIELD_NAMESPACE && e.node.key === key,
  );
  return edge?.node.value ?? null;
}

/** Check if a resource is excluded via geo_ai.exclude metafield. */
export function isExcluded(metafields: MetafieldEdges): boolean {
  return getMetafieldValue(metafields, "exclude") === "true";
}

/** Strip HTML tags from a string. */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/** Trim text to a maximum number of words. */
export function trimWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ") + "...";
}

/**
 * Determine product availability status considering all variants.
 * A product is "In Stock" if at least one variant is available:
 * - Variant doesn't track inventory (inventoryPolicy === "CONTINUE" or inventoryQuantity is null)
 * - Variant tracks inventory and has positive quantity
 */
export function getAvailabilityStatus(
  variants: Array<{ node: VariantNode }>,
): string {
  if (variants.length === 0) return "Out of Stock";

  const hasAvailable = variants.some((v) => {
    // If inventory is not tracked (null quantity), consider available
    if (v.node.inventoryQuantity === null) return true;
    // If policy is CONTINUE, always available regardless of quantity
    if (v.node.inventoryPolicy === "CONTINUE") return true;
    // Otherwise, available only if positive quantity
    return v.node.inventoryQuantity > 0;
  });

  return hasAvailable ? "In Stock" : "Out of Stock";
}

/** Get price range string from variants. */
export function getPriceRange(
  variants: Array<{ node: VariantNode }>,
): string {
  if (variants.length === 0) return "";
  const prices = variants.map((v) => parseFloat(v.node.price)).filter((p) => !isNaN(p));
  if (prices.length === 0) return "";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return min.toFixed(2);
  return `${min.toFixed(2)} - ${max.toFixed(2)}`;
}

/** Get sale prices info from variants. */
export function getSalePrices(
  variants: Array<{ node: VariantNode }>,
): string | null {
  const salePairs = variants
    .filter((v) => v.node.compareAtPrice !== null && v.node.compareAtPrice !== "0.00")
    .map((v) => ({
      compare: parseFloat(v.node.compareAtPrice!),
      price: parseFloat(v.node.price),
    }))
    .filter((p) => !isNaN(p.compare) && !isNaN(p.price) && p.compare > p.price);

  if (salePairs.length === 0) return null;

  const minSale = Math.min(...salePairs.map((p) => p.price));
  const maxCompare = Math.max(...salePairs.map((p) => p.compare));
  return `Sale: ${minSale.toFixed(2)} (was ${maxCompare.toFixed(2)})`;
}

/** Get variant options summary. */
export function getVariantOptions(
  variants: Array<{ node: VariantNode }>,
): string | null {
  if (variants.length <= 1) return null;

  // Collect unique option names and their values
  const optionMap = new Map<string, Set<string>>();
  for (const v of variants) {
    for (const opt of v.node.selectedOptions) {
      if (!optionMap.has(opt.name)) optionMap.set(opt.name, new Set());
      optionMap.get(opt.name)!.add(opt.value);
    }
  }

  const parts: string[] = [];
  for (const [name, values] of optionMap) {
    parts.push(`${name}: ${Array.from(values).join(", ")}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

/**
 * Build a map of resourceId → { key → translatedValue } from translation entries.
 */
export function buildTranslationMap(
  resources: TranslatedResource[],
): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>();
  for (const res of resources) {
    const fields = new Map<string, string>();
    for (const t of res.translations) {
      if (t.value !== null) {
        fields.set(t.key, t.value);
      }
    }
    if (fields.size > 0) {
      map.set(res.resourceId, fields);
    }
  }
  return map;
}

/**
 * Apply translations to a product node, returning a shallow copy with translated fields.
 * Shopify Translations API uses keys like "title", "body_html" for products.
 */
export function applyProductTranslations(
  product: ProductNode,
  translations: Map<string, string> | undefined,
): ProductNode {
  if (!translations) return product;
  return {
    ...product,
    title: translations.get("title") || product.title,
    descriptionHtml: translations.get("body_html") || product.descriptionHtml,
  };
}

/**
 * Apply translations to a page node, returning a shallow copy with translated fields.
 * Shopify Translations API uses keys like "title", "body" for pages.
 */
export function applyPageTranslations(
  page: PageNode,
  translations: Map<string, string> | undefined,
): PageNode {
  if (!translations) return page;
  return {
    ...page,
    title: translations.get("title") || page.title,
    body: translations.get("body") || page.body,
  };
}

/**
 * Apply translations to a collection node, returning a shallow copy with translated fields.
 * Shopify Translations API uses keys like "title", "body_html" for collections.
 */
export function applyCollectionTranslations(
  collection: CollectionNode,
  translations: Map<string, string> | undefined,
): CollectionNode {
  if (!translations) return collection;
  return {
    ...collection,
    title: translations.get("title") || collection.title,
    description: translations.get("body_html") || collection.description,
  };
}

// ── Generator class ──────────────────────────────────────────────────────

export class LlmsGenerator {
  private shopifyApi: ShopifyApiService;
  private cache: CacheService;
  private admin: AdminApiContext;
  private settings: AppSettings;

  constructor(
    admin: AdminApiContext,
    settings: AppSettings,
    shopifyApi?: ShopifyApiService,
    cache?: CacheService,
  ) {
    this.admin = admin;
    this.settings = settings;
    this.shopifyApi = shopifyApi ?? new ShopifyApiService();
    this.cache = cache ?? new CacheService();
  }

  /** Fetch shop info (name, description, primary domain URL). */
  async getShopData(): Promise<ShopData> {
    const data = await this.shopifyApi.query<any>(this.admin, SHOP_QUERY);
    return {
      name: data.shop.name,
      description: data.shop.description || "",
      url: data.shop.primaryDomain.url.replace(/\/$/, ""),
    };
  }

  /** Fetch all active products with metafields, paginated. */
  async fetchProducts(): Promise<ProductNode[]> {
    return this.shopifyApi.paginateAll<ProductNode>(
      this.admin,
      PRODUCTS_QUERY,
      (data) => data.products.edges.map((e: any) => e.node),
      (data) => data.products.pageInfo as PageInfo,
    );
  }

  /** Fetch all pages with metafields, paginated. */
  async fetchPages(): Promise<PageNode[]> {
    return this.shopifyApi.paginateAll<PageNode>(
      this.admin,
      PAGES_QUERY,
      (data) => data.pages.edges.map((e: any) => e.node),
      (data) => data.pages.pageInfo as PageInfo,
    );
  }

  /** Fetch all collections, paginated. */
  async fetchCollections(): Promise<CollectionNode[]> {
    return this.shopifyApi.paginateAll<CollectionNode>(
      this.admin,
      COLLECTIONS_QUERY,
      (data) => data.collections.edges.map((e: any) => e.node),
      (data) => data.collections.pageInfo as PageInfo,
    );
  }

  /**
   * Fetch published shop locales from Shopify Markets.
   * Returns only published (active) locales.
   */
  async fetchShopLocales(): Promise<ShopLocale[]> {
    const data = await this.shopifyApi.query<any>(
      this.admin,
      SHOP_LOCALES_QUERY,
    );
    const locales: ShopLocale[] = data.shopLocales || [];
    return locales.filter((l) => l.published);
  }

  /**
   * Fetch translations for a given resource type and locale via Shopify Translations API.
   * Returns a map of resourceId → { key → translatedValue }.
   */
  async fetchTranslations(
    resourceType: string,
    locale: string,
  ): Promise<Map<string, Map<string, string>>> {
    const resources = await this.shopifyApi.paginateAll<TranslatedResource>(
      this.admin,
      TRANSLATABLE_RESOURCES_QUERY,
      (data) =>
        data.translatableResources.edges.map((e: any) => ({
          resourceId: e.node.resourceId,
          translations: e.node.translations || [],
        })),
      (data) => data.translatableResources.pageInfo as PageInfo,
      { resourceType, locale },
    );
    return buildTranslationMap(resources);
  }

  /**
   * Get the list of non-primary published locales that need separate files.
   * Returns empty array if multilingual is disabled or only one locale exists.
   */
  async getActiveNonPrimaryLocales(): Promise<string[]> {
    if (!this.settings.multilingualEnabled) return [];

    const locales = await this.fetchShopLocales();
    if (locales.length <= 1) return [];

    return locales.filter((l) => !l.primary).map((l) => l.locale);
  }

  /**
   * Generate llms.txt or llms-full.txt content.
   */
  async generate(isFull: boolean, locale?: string): Promise<string> {
    const shop = await this.getShopData();
    const output: string[] = [];

    // ── Header ─────────────────────────────────────────────────────────
    output.push(`# ${shop.name}`);
    output.push("");

    const description = this.settings.siteDescription || shop.description;
    if (description) {
      output.push(`> ${description}`);
      output.push("");
    }

    output.push(`- URL: ${shop.url}`);
    output.push(`- llms.txt: ${shop.url}/apps/llms/standard`);
    output.push(`- llms-full.txt: ${shop.url}/apps/llms/full`);

    if (locale) {
      output.push(`- Language: ${locale}`);
    }

    output.push("");

    // ── AI Crawler Rules ───────────────────────────────────────────────
    output.push("## AI Crawler Rules");
    output.push("");

    let botRules: Record<string, string> = {};
    try {
      botRules = JSON.parse(this.settings.botRules || "{}");
    } catch {
      // Invalid JSON — use empty rules (all default to allow)
    }

    for (const [bot, provider] of Object.entries(AI_BOTS)) {
      const rule = botRules[bot] || "allow";
      const status = rule === "allow" ? "✓ Allowed" : "✗ Disallowed";
      output.push(`- ${bot} (${provider}): ${status}`);
    }
    output.push("");

    // ── Products ───────────────────────────────────────────────────────
    if (this.settings.includeProducts) {
      const rawProducts = await this.fetchProducts();
      const filtered = rawProducts.filter((p) => !isExcluded(p.metafields));

      // Apply translations if locale is specified
      let products = filtered;
      if (locale && filtered.length > 0) {
        const translationMap = await this.fetchTranslations("PRODUCT", locale);
        products = filtered.map((p) =>
          applyProductTranslations(p, translationMap.get(p.id)),
        );
      }

      if (products.length > 0) {
        output.push("## Products");
        output.push("");

        for (const product of products) {
          const url = `${shop.url}/products/${product.handle}`;
          const aiDesc = getMetafieldValue(product.metafields, "description");
          const keywords = getMetafieldValue(product.metafields, "keywords");

          let line = `- [${product.title}](${url})`;

          if (aiDesc) {
            line += `: ${aiDesc}`;
          }

          if (keywords) {
            line += ` [${keywords}]`;
          }

          output.push(line);

          // Full version: extra details
          if (isFull) {
            const variants = product.variants.edges;

            // Content (stripped HTML, trimmed)
            const content = stripHtml(product.descriptionHtml);
            if (content) {
              output.push(`  ${trimWords(content, 200)}`);
            }

            // Price range
            const priceRange = getPriceRange(variants);
            if (priceRange) {
              output.push(`  Price: ${priceRange}`);
            }

            // Sale prices
            const sale = getSalePrices(variants);
            if (sale) {
              output.push(`  ${sale}`);
            }

            // Availability
            const availability = getAvailabilityStatus(variants);
            output.push(`  Availability: ${availability}`);

            // Variant options
            const options = getVariantOptions(variants);
            if (options) {
              output.push(`  Variants: ${options}`);
            }

            output.push("");
          }
        }
        output.push("");
      }
    }

    // ── Pages ──────────────────────────────────────────────────────────
    if (this.settings.includePages) {
      const rawPages = await this.fetchPages();
      const filtered = rawPages.filter((p) => !isExcluded(p.metafields));

      // Apply translations if locale is specified
      let pages = filtered;
      if (locale && filtered.length > 0) {
        const translationMap = await this.fetchTranslations("ONLINE_STORE_PAGE", locale);
        pages = filtered.map((p) =>
          applyPageTranslations(p, translationMap.get(p.id)),
        );
      }

      if (pages.length > 0) {
        output.push("## Pages");
        output.push("");

        for (const page of pages) {
          const url = `${shop.url}/pages/${page.handle}`;
          const aiDesc = getMetafieldValue(page.metafields, "description");

          let line = `- [${page.title}](${url})`;
          if (aiDesc) {
            line += `: ${aiDesc}`;
          }

          output.push(line);

          if (isFull) {
            const content = stripHtml(page.body);
            if (content) {
              output.push(`  ${trimWords(content, 200)}`);
            }
            output.push("");
          }
        }
        output.push("");
      }
    }

    // ── Collections ────────────────────────────────────────────────────
    if (this.settings.includeCollections) {
      const rawCollections = await this.fetchCollections();

      // Apply translations if locale is specified
      let collections = rawCollections;
      if (locale && rawCollections.length > 0) {
        const translationMap = await this.fetchTranslations("COLLECTION", locale);
        collections = rawCollections.map((c) =>
          applyCollectionTranslations(c, translationMap.get(c.id)),
        );
      }

      if (collections.length > 0) {
        output.push("## Collections");
        output.push("");

        for (const col of collections) {
          const url = `${shop.url}/collections/${col.handle}`;
          let line = `- [${col.title}](${url})`;

          if (col.description) {
            line += `: ${trimWords(col.description, 15)}`;
          }

          line += ` (${col.productsCount.count})`;
          output.push(line);
        }
        output.push("");
      }
    }

    // ── Footer ─────────────────────────────────────────────────────────
    output.push("---");
    output.push(`Generated by GEO AI Shopify v${APP_VERSION}`);
    output.push(
      `Last updated: ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC`,
    );

    return output.join("\n");
  }

  /**
   * Generate both standard and full versions.
   */
  async generateBoth(locale?: string): Promise<GeneratedContent> {
    const standard = await this.generate(false, locale);
    const full = await this.generate(true, locale);
    return { standard, full, generatedAt: new Date() };
  }

  /**
   * Regenerate both files and store in cache.
   * When multilingual is enabled and multiple locales exist,
   * also generates per-locale files (llms_standard_{locale}, llms_full_{locale}).
   */
  /**
     * Regenerate both files and store in cache.
     * When multilingual is enabled and multiple locales exist,
     * also generates per-locale files (llms_standard_{locale}, llms_full_{locale}).
     *
     * Cache resilience (Req 17.6): on generation failure, the previous
     * cache is preserved — we only write to cache after successful generation.
     * Returns { success: true } or { success: false, error } so the caller
     * can display a notification without losing cached content.
     */
    async regenerateAndCache(): Promise<{ success: boolean; error?: string }> {
      const ttl = this.settings.cacheDurationHours;
      const shopId = this.settings.shopId;

      try {
        // Always generate default (primary locale) files
        const { standard, full } = await this.generateBoth();
        await this.cache.set(shopId, "llms_standard", standard, ttl);
        await this.cache.set(shopId, "llms_full", full, ttl);

        // Generate per-locale files if multilingual is enabled
        const locales = await this.getActiveNonPrimaryLocales();
        for (const locale of locales) {
          const localeContent = await this.generateBoth(locale);
          await this.cache.set(shopId, `llms_standard_${locale}`, localeContent.standard, ttl);
          await this.cache.set(shopId, `llms_full_${locale}`, localeContent.full, ttl);
        }

        // Mark files as generated in settings
        await prisma.appSettings.update({
          where: { shopId },
          data: {
            llmsGenerated: true,
            pendingRegeneration: null,
          },
        });

        return { success: true };
      } catch (error) {
        // Cache resilience: previous cache is NOT invalidated on failure.
        // Only clear the pending flag so we don't retry endlessly.
        console.error("[LlmsGenerator] regenerateAndCache failed:", error);
        await prisma.appSettings.update({
          where: { shopId },
          data: { pendingRegeneration: null },
        }).catch(() => {});

        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown generation error",
        };
      }
    }

  /**
   * Invalidate all cached llms content for this shop.
   */
  async invalidateCache(): Promise<void> {
    await this.cache.invalidate(this.settings.shopId);
  }

  /**
   * Generate a robots.txt text block for the merchant to copy-paste.
   * Includes User-agent + Allow/Disallow directives for each configured bot,
   * a Sitemap directive, and a reference to llms.txt.
   */
  generateRobotsTxtBlock(shopUrl: string): string {
    const url = shopUrl.replace(/\/$/, "");
    const lines: string[] = [];

    lines.push("# GEO AI Shopify — AI Crawler Rules");
    lines.push("");

    let botRules: Record<string, string> = {};
    try {
      botRules = JSON.parse(this.settings.botRules || "{}");
    } catch {
      // Invalid JSON — default all to allow
    }

    for (const bot of Object.keys(AI_BOTS)) {
      const rule = botRules[bot] || "allow";
      lines.push(`User-agent: ${bot}`);
      lines.push("Allow: /apps/llms/");
      if (rule === "allow") {
        lines.push("Allow: /");
      } else {
        lines.push("Disallow: /");
      }
      lines.push("");
    }

    lines.push(`Sitemap: ${url}/sitemap.xml`);
    lines.push(`# AI Content Index: ${url}/apps/llms/standard`);

    return lines.join("\n");
  }


}
