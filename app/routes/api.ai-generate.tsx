/**
 * Protected API route: POST /api/ai-generate
 *
 * Generates an AI description for a single resource (product or page).
 * Requires a valid Shopify admin session.
 *
 * Request body:
 *   { resourceId: string (Shopify GID), resourceType: "product" | "page" }
 *
 * Validates: Requirements 6.2, 9.6
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { AiGenerator } from "../services/ai-generator.server";
import { MetafieldsService } from "../services/metafields.server";

const VALID_RESOURCE_TYPES = ["product", "page"] as const;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { session, admin } = await authenticate.admin(request);
    const shopId = session.shop;

    // Parse and validate request body
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { resourceId, resourceType } = body ?? {};

    if (!resourceId || typeof resourceId !== "string") {
      return json({ error: "Missing or invalid resourceId" }, { status: 400 });
    }

    if (
      !resourceType ||
      !VALID_RESOURCE_TYPES.includes(resourceType as any)
    ) {
      return json(
        { error: "Missing or invalid resourceType. Must be 'product' or 'page'." },
        { status: 400 },
      );
    }

    // Resolve AI config for this shop
    const generator = new AiGenerator();
    const config = await generator.getConfig(shopId);

    if (!config) {
      return json(
        { error: "AI provider is not configured. Set an API key in settings." },
        { status: 422 },
      );
    }

    // Fetch current metadata to build context
    const metafields = new MetafieldsService();
    const metadata = await metafields.getMetadata(admin, resourceId);

    // Build product context from the resource via GraphQL
    const resourceData = await fetchResourceContext(admin, resourceId, resourceType);

    // Generate description
    const description = await generator.generateDescription(config, {
      title: resourceData.title,
      content: resourceData.content,
      type: resourceType,
      price: resourceData.price,
      category: resourceData.category,
    });

    // Save to metafields
    await metafields.setMetadata(admin, resourceId, { description });

    return json({ success: true, description });
  } catch (error) {
    if (error instanceof Response) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Re-throw AiProviderError details
    if (error instanceof Error && error.name === "AiProviderError") {
      const aiErr = error as any;
      return json(
        { error: error.message, type: aiErr.type },
        { status: aiErr.statusCode ?? 502 },
      );
    }

    console.error("[api/ai-generate] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Fetch resource context (title, content, price, category) from Shopify
 * Admin API for prompt building.
 */
async function fetchResourceContext(
  admin: any,
  resourceId: string,
  resourceType: string,
): Promise<{ title: string; content: string; price: string; category: string }> {
  if (resourceType === "product") {
    const response = await admin.graphql(
      `query GetProduct($id: ID!) {
        product(id: $id) {
          title
          descriptionHtml
          productType
          variants(first: 1) {
            edges {
              node {
                price
              }
            }
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
      price: product?.variants?.edges?.[0]?.node?.price ?? "",
      category: product?.productType ?? "",
    };
  }

  // Page
  const response = await admin.graphql(
    `query GetPage($id: ID!) {
      page(id: $id) {
        title
        body
      }
    }`,
    { variables: { id: resourceId } },
  );
  const data = await response.json();
  const page = data.data?.page;

  return {
    title: page?.title ?? "",
    content: page?.body ?? "",
    price: "",
    category: "",
  };
}
