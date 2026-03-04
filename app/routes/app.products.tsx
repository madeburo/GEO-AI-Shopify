/**
 * Products page: /app/products
 *
 * - ProductList with AI metadata columns, filtering, pagination, bulk selection
 * - Loader: fetches products with metafields via Shopify Admin API
 * - Action: save AI metadata, trigger single/bulk AI generation
 * - BulkProgressBar during bulk generation
 * - Empty state when no products exist
 *
 * Validates: Requirements 5.4, 5.6, 6.2, 6.3, 6.5, 6.8, 15.1, 15.2, 17.1, 17.5
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import { Page, Layout, BlockStack, Banner } from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { MetafieldsService, METAFIELD_NAMESPACE } from "../services/metafields.server";
import { AiGenerator, AiProviderError } from "../services/ai-generator.server";
import { ProductList } from "../components/ProductList";
import type { ProductItem } from "../components/ProductList";
import { MetadataEditor } from "../components/MetadataEditor";
import type { AiMetadata } from "../components/MetadataEditor";
import { BulkProgressBar } from "../components/BulkProgressBar";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner, getAiErrorRecommendation } from "../components/ErrorBanner";

const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          metafields(first: 10, namespace: "${METAFIELD_NAMESPACE}") {
            edges {
              node { namespace key value }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function extractMetafield(
  edges: Array<{ node: { namespace: string; key: string; value: string } }>,
  key: string,
): string {
  const mf = edges.find(
    (e) => e.node.namespace === METAFIELD_NAMESPACE && e.node.key === key,
  );
  return mf?.node.value ?? "";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopId = session.shop;

  // Fetch all products with metafields (paginated)
  const items: ProductItem[] = [];
  let loaderError: string | null = null;

  try {
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const resp: Response = await admin.graphql(PRODUCTS_QUERY, {
        variables: { first: 50, after: cursor },
      });
      const json: any = await resp.json();
      const products: any = json.data?.products;

      for (const edge of products?.edges ?? []) {
        const node = edge.node;
        const mfEdges = node.metafields?.edges ?? [];
        items.push({
          id: node.id,
          title: node.title,
          description: extractMetafield(mfEdges, "description"),
          keywords: extractMetafield(mfEdges, "keywords"),
          exclude: extractMetafield(mfEdges, "exclude") === "true",
        });
      }

      hasNext = products?.pageInfo?.hasNextPage ?? false;
      cursor = products?.pageInfo?.endCursor ?? null;
    }
  } catch (error) {
    console.error("[products] Shopify API error:", error);
    loaderError = error instanceof Error ? error.message : "Failed to load products from Shopify API.";
  }

  // Check if AI is configured
  const settings = await prisma.appSettings.findUnique({ where: { shopId } });
  const aiAvailable =
    !!settings &&
    settings.aiProvider !== "none" &&
    Boolean(settings.aiApiKeyEncrypted);

  // Check bulk progress (Req 17.4: show progress on page reopen)
  const generator = new AiGenerator();
  const bulkProgress = await generator.getBulkProgress(shopId);

  return json({ items, aiAvailable, bulkProgress, loaderError });
};

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save_metadata") {
    const resourceId = formData.get("resourceId") as string;
    const metadata: Partial<AiMetadata> = JSON.parse(
      formData.get("metadata") as string,
    );

    const metafields = new MetafieldsService();
    await metafields.setMetadata(admin, resourceId, {
      description: metadata.description ?? null,
      keywords: metadata.keywords ?? null,
      exclude: metadata.exclude ?? false,
    });

    return json({ success: true, intent: "save_metadata" });
  }

  if (intent === "ai_generate") {
    const resourceId = formData.get("resourceId") as string;

    // Fetch product context
    let product: any;
    try {
      const response = await admin.graphql(
        `query GetProduct($id: ID!) {
          product(id: $id) {
            title
            descriptionHtml
            productType
            variants(first: 1) { edges { node { price } } }
          }
        }`,
        { variables: { id: resourceId } },
      );
      const data = await response.json();
      product = data.data?.product;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Shopify API error";
      return json({ error: msg, errorType: "shopify_api" }, { status: 502 });
    }

    const generator = new AiGenerator();
    const config = await generator.getConfig(shopId);
    if (!config) {
      return json({ error: "AI provider not configured", errorType: "auth" }, { status: 422 });
    }

    try {
      const description = await generator.generateDescription(config, {
        title: product?.title ?? "",
        content: product?.descriptionHtml ?? "",
        type: "product",
        price: product?.variants?.edges?.[0]?.node?.price ?? "",
        category: product?.productType ?? "",
      });

      const metafields = new MetafieldsService();
      await metafields.setMetadata(admin, resourceId, { description });

      return json({ success: true, intent: "ai_generate", description });
    } catch (error) {
      if (error instanceof AiProviderError) {
        return json(
          { error: error.message, errorType: error.type },
          { status: error.statusCode ?? 500 },
        );
      }
      const msg = error instanceof Error ? error.message : "AI generation failed";
      return json({ error: msg, errorType: "unknown" }, { status: 500 });
    }
  }

  if (intent === "bulk_generate") {
    const resourceIds: string[] = JSON.parse(
      formData.get("resourceIds") as string,
    );

    const generator = new AiGenerator();
    const config = await generator.getConfig(shopId);
    if (!config) {
      return json({ error: "AI provider not configured" }, { status: 422 });
    }

    const contextProvider = async (resourceId: string) => {
      const resp = await admin.graphql(
        `query GetProduct($id: ID!) {
          product(id: $id) {
            title descriptionHtml productType
            variants(first: 1) { edges { node { price } } }
          }
        }`,
        { variables: { id: resourceId } },
      );
      const d = await resp.json();
      const p = d.data?.product;
      return {
        title: p?.title ?? "",
        content: p?.descriptionHtml ?? "",
        type: "product",
        price: p?.variants?.edges?.[0]?.node?.price ?? "",
        category: p?.productType ?? "",
      };
    };

    await generator.bulkGenerate(shopId, resourceIds, contextProvider);
    return json({ success: true, intent: "bulk_generate" });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

export default function ProductsPage() {
  const { items, aiAvailable, bulkProgress, loaderError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const [selectedItem, setSelectedItem] = useState<ProductItem | null>(null);

  // Poll for bulk progress when a job is running
  const [polling, setPolling] = useState(
    bulkProgress?.status === "running",
  );

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(() => {
      // Revalidate loader data to get updated bulk progress
      submit(null, { method: "get" });
    }, 3000);
    return () => clearInterval(interval);
  }, [polling, submit]);

  useEffect(() => {
    if (bulkProgress?.status !== "running") {
      setPolling(false);
    } else {
      setPolling(true);
    }
  }, [bulkProgress?.status]);

  const handleSelect = useCallback((item: ProductItem) => {
    setSelectedItem(item);
  }, []);

  const handleSaveMetadata = useCallback(
    (data: AiMetadata) => {
      if (!selectedItem) return;
      const formData = new FormData();
      formData.set("intent", "save_metadata");
      formData.set("resourceId", selectedItem.id);
      formData.set("metadata", JSON.stringify(data));
      submit(formData, { method: "post" });
      setSelectedItem(null);
    },
    [selectedItem, submit],
  );

  const handleGenerateAi = useCallback(() => {
    if (!selectedItem) return;
    const formData = new FormData();
    formData.set("intent", "ai_generate");
    formData.set("resourceId", selectedItem.id);
    submit(formData, { method: "post" });
    setSelectedItem(null);
  }, [selectedItem, submit]);

  const handleBulkGenerate = useCallback(
    (ids: string[]) => {
      const formData = new FormData();
      formData.set("intent", "bulk_generate");
      formData.set("resourceIds", JSON.stringify(ids));
      submit(formData, { method: "post" });
    },
    [submit],
  );

  if (items.length === 0) {
    return (
      <Page title="Products">
        <EmptyState
          heading="No products yet"
          message="Add products to your store so GEO AI can generate AI descriptions and include them in llms.txt."
          actionLabel="Add product"
          actionUrl="shopify://admin/products/new"
        />
      </Page>
    );
  }

  return (
    <Page title="Products">
      <BlockStack gap="500">
        {/* Shopify API loader error with retry (Req 17.3) */}
        {loaderError && (
          <ErrorBanner
            title="Shopify API error"
            message={loaderError}
            onRetry={() => submit(null, { method: "get" })}
          />
        )}

        {/* Action errors with AI classification (Req 17.5) */}
        {actionData && "error" in actionData && (
          <ErrorBanner
            title={
              (actionData as any).errorType === "auth"
                ? "AI provider authentication error"
                : (actionData as any).errorType === "rate_limit"
                  ? "Rate limit exceeded"
                  : (actionData as any).errorType === "service"
                    ? "AI service unavailable"
                    : (actionData as any).errorType === "shopify_api"
                      ? "Shopify API error"
                      : "Error"
            }
            message={`${String(actionData.error)} ${(actionData as any).errorType ? getAiErrorRecommendation((actionData as any).errorType) : ""}`}
            onRetry={() => submit(null, { method: "get" })}
          />
        )}
        {actionData && "intent" in actionData && actionData.intent === "save_metadata" && "success" in actionData && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>Metadata saved.</p>
          </Banner>
        )}
        {actionData && "intent" in actionData && actionData.intent === "ai_generate" && "description" in actionData && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>AI description generated.</p>
          </Banner>
        )}

        {/* Bulk progress (Req 17.4: visible on page reopen) */}
        {bulkProgress && (
          <BulkProgressBar
            total={bulkProgress.total}
            processed={bulkProgress.processed}
            succeeded={bulkProgress.succeeded}
            failed={bulkProgress.failed}
            status={bulkProgress.status as "running" | "complete" | "error"}
          />
        )}

        <Layout>
          <Layout.Section>
            <ProductList
              items={items}
              onSelect={handleSelect}
              onBulkGenerate={handleBulkGenerate}
              bulkGenerateAvailable={aiAvailable}
            />
          </Layout.Section>

          {selectedItem && (
            <Layout.Section variant="oneThird">
              <MetadataEditor
                resourceTitle={selectedItem.title}
                initial={{
                  description: selectedItem.description,
                  keywords: selectedItem.keywords,
                  exclude: selectedItem.exclude,
                }}
                onSave={handleSaveMetadata}
                onGenerateAi={handleGenerateAi}
                saving={saving}
                aiAvailable={aiAvailable}
              />
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
