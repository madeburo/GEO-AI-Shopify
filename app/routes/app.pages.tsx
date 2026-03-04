/**
 * Pages page: /app/pages
 *
 * - PageList with AI metadata columns, filtering, pagination
 * - Loader: fetches pages with metafields via Shopify Admin API
 * - Action: save AI metadata, trigger AI generation
 * - Empty state when no pages exist
 *
 * Validates: Requirements 5.5, 5.6, 15.1, 15.3, 17.2
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import { useCallback, useState } from "react";
import { Page, Layout, BlockStack, Banner } from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { MetafieldsService, METAFIELD_NAMESPACE } from "../services/metafields.server";
import { AiGenerator, AiProviderError } from "../services/ai-generator.server";
import { PageList } from "../components/PageList";
import type { PageItem } from "../components/PageList";
import { MetadataEditor } from "../components/MetadataEditor";
import type { AiMetadata } from "../components/MetadataEditor";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner, getAiErrorRecommendation } from "../components/ErrorBanner";

const PAGES_QUERY = `
  query GetPages($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
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

  const items: PageItem[] = [];
  let loaderError: string | null = null;

  try {
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const resp: Response = await admin.graphql(PAGES_QUERY, {
        variables: { first: 50, after: cursor },
      });
      const data: any = await resp.json();
      const pages: any = data.data?.pages;

      for (const edge of pages?.edges ?? []) {
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

      hasNext = pages?.pageInfo?.hasNextPage ?? false;
      cursor = pages?.pageInfo?.endCursor ?? null;
    }
  } catch (error) {
    console.error("[pages] Shopify API error:", error);
    loaderError = error instanceof Error ? error.message : "Failed to load pages from Shopify API.";
  }

  // Check if AI is configured
  const settings = await prisma.appSettings.findUnique({ where: { shopId } });
  const aiAvailable =
    !!settings &&
    settings.aiProvider !== "none" &&
    Boolean(settings.aiApiKeyEncrypted);

  return json({ items, aiAvailable, loaderError });
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

    let page: any;
    try {
      const response = await admin.graphql(
        `query GetPage($id: ID!) {
          page(id: $id) { title body }
        }`,
        { variables: { id: resourceId } },
      );
      const data = await response.json();
      page = data.data?.page;
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
        title: page?.title ?? "",
        content: page?.body ?? "",
        type: "page",
        price: "",
        category: "",
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

  return json({ error: "Unknown intent" }, { status: 400 });
}

export default function PagesPage() {
  const { items, aiAvailable, loaderError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const [selectedItem, setSelectedItem] = useState<PageItem | null>(null);

  const handleSelect = useCallback((item: PageItem) => {
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

  if (items.length === 0) {
    return (
      <Page title="Pages">
        <EmptyState
          heading="No pages yet"
          message="Create pages in your store so GEO AI can generate AI descriptions and include them in llms.txt."
          actionLabel="Add page"
          actionUrl="shopify://admin/pages/new"
        />
      </Page>
    );
  }

  return (
    <Page title="Pages">
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

        <Layout>
          <Layout.Section>
            <PageList
              items={items}
              onSelect={handleSelect}
              bulkGenerateAvailable={false}
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
