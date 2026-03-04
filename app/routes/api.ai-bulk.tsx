/**
 * Protected API route: POST /api/ai-bulk
 *
 * Two modes:
 *   { action: "start", resourceIds: string[] } — start bulk AI generation
 *   { action: "progress" }                     — get current bulk progress
 *
 * Requires a valid Shopify admin session.
 *
 * Validates: Requirements 6.3, 6.8, 9.6
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { AiGenerator } from "../services/ai-generator.server";
import { MetafieldsService } from "../services/metafields.server";
import { BULK_MAX_ITEMS } from "../utils/constants";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { session, admin } = await authenticate.admin(request);
    const shopId = session.shop;

    // Parse request body
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { action: bulkAction } = body ?? {};

    if (!bulkAction || !["start", "progress"].includes(bulkAction)) {
      return json(
        { error: "Missing or invalid action. Must be 'start' or 'progress'." },
        { status: 400 },
      );
    }

    const generator = new AiGenerator();

    // ── Progress mode ──────────────────────────────────────────────────
    if (bulkAction === "progress") {
      const progress = await generator.getBulkProgress(shopId);

      if (!progress) {
        return json({
          total: 0,
          processed: 0,
          succeeded: 0,
          failed: 0,
          status: "complete",
        });
      }

      return json(progress);
    }

    // ── Start mode ─────────────────────────────────────────────────────
    const { resourceIds } = body;

    if (!Array.isArray(resourceIds) || resourceIds.length === 0) {
      return json(
        { error: "resourceIds must be a non-empty array of Shopify GIDs." },
        { status: 400 },
      );
    }

    if (resourceIds.length > BULK_MAX_ITEMS) {
      return json(
        { error: `Maximum ${BULK_MAX_ITEMS} resources per bulk generation.` },
        { status: 400 },
      );
    }

    // Validate all IDs are strings
    if (!resourceIds.every((id: any) => typeof id === "string")) {
      return json(
        { error: "All resourceIds must be strings." },
        { status: 400 },
      );
    }

    // Build a context provider that fetches resource data and saves results
    const metafields = new MetafieldsService();

    const contextProvider = async (resourceId: string) => {
      const resourceType = resourceId.includes("Product")
        ? "product"
        : "page";

      if (resourceType === "product") {
        const response = await admin.graphql(
          `query GetProduct($id: ID!) {
            product(id: $id) {
              title
              descriptionHtml
              productType
              variants(first: 1) {
                edges { node { price } }
              }
            }
          }`,
          { variables: { id: resourceId } },
        );
        const data = await response.json();
        const product = data.data?.product;

        return {
          title: product?.title ?? "",
          content: product?.descriptionHtml ?? "",
          type: resourceType,
          price: product?.variants?.edges?.[0]?.node?.price ?? "",
          category: product?.productType ?? "",
        };
      }

      // Page
      const response = await admin.graphql(
        `query GetPage($id: ID!) {
          page(id: $id) { title body }
        }`,
        { variables: { id: resourceId } },
      );
      const data = await response.json();
      const page = data.data?.page;

      return {
        title: page?.title ?? "",
        content: page?.body ?? "",
        type: resourceType,
        price: "",
        category: "",
      };
    };

    const jobId = await generator.bulkGenerate(
      shopId,
      resourceIds,
      contextProvider,
    );

    // Return initial progress
    return json({
      jobId,
      total: Math.min(resourceIds.length, BULK_MAX_ITEMS),
      processed: 0,
      succeeded: 0,
      failed: 0,
      status: "running",
    });
  } catch (error) {
    if (error instanceof Response) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (error instanceof Error && error.name === "AiProviderError") {
      const aiErr = error as any;
      return json(
        { error: error.message, type: aiErr.type },
        { status: aiErr.statusCode ?? 502 },
      );
    }

    console.error("[api/ai-bulk] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
