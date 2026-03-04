/**
 * Settings page: /app/settings
 *
 * Sections: General, AI Crawlers, SEO Signals, Caching, AI Generation,
 *           Tracking, Multilingual.
 *
 * - Validates fields on save
 * - Encrypts AI API key via CryptoService
 * - Syncs shop-level metafields via MetafieldsService on SEO changes
 * - Hides AI generation buttons when no API key is set
 *
 * Validates: Requirements 7.1–7.9, 6.5, 11.5
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useCallback, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  TextField,
  Select,
  Checkbox,
  Button,
  Banner,
  InlineStack,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { CryptoService } from "../services/crypto.server";
import { MetafieldsService } from "../services/metafields.server";
import { AI_BOTS } from "../utils/bots";
import {
  SUPPORTED_CACHE_DURATIONS,
  DEFAULT_PROMPT,
} from "../utils/constants";
import { ErrorBanner } from "../components/ErrorBanner";

interface LoaderData {
  settings: {
    siteDescription: string;
    includeProducts: boolean;
    includePages: boolean;
    includeCollections: boolean;
    includeBlogPosts: boolean;
    botRules: Record<string, "allow" | "disallow">;
    seoMetaEnabled: boolean;
    seoJsonldEnabled: boolean;
    cacheDurationHours: number;
    aiProvider: string;
    hasApiKey: boolean;
    aiModel: string;
    aiMaxTokens: number;
    aiPromptTemplate: string;
    crawlTrackingEnabled: boolean;
    multilingualEnabled: boolean;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  let settings = await prisma.appSettings.findUnique({ where: { shopId } });
  if (!settings) {
    settings = await prisma.appSettings.create({ data: { shopId } });
  }

  let botRules: Record<string, "allow" | "disallow"> = {};
  try {
    botRules = JSON.parse(settings.botRules || "{}");
  } catch {
    // default empty
  }

  return json<LoaderData>({
    settings: {
      siteDescription: settings.siteDescription,
      includeProducts: settings.includeProducts,
      includePages: settings.includePages,
      includeCollections: settings.includeCollections,
      includeBlogPosts: settings.includeBlogPosts,
      botRules,
      seoMetaEnabled: settings.seoMetaEnabled,
      seoJsonldEnabled: settings.seoJsonldEnabled,
      cacheDurationHours: settings.cacheDurationHours,
      aiProvider: settings.aiProvider,
      hasApiKey: Boolean(settings.aiApiKeyEncrypted),
      aiModel: settings.aiModel,
      aiMaxTokens: settings.aiMaxTokens,
      aiPromptTemplate: settings.aiPromptTemplate || DEFAULT_PROMPT,
      crawlTrackingEnabled: settings.crawlTrackingEnabled,
      multilingualEnabled: settings.multilingualEnabled,
    },
  });
};

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const data = JSON.parse(formData.get("settings") as string);

  // Validate cache duration
  if (!SUPPORTED_CACHE_DURATIONS.includes(data.cacheDurationHours)) {
    return json({ error: "Invalid cache duration" }, { status: 400 });
  }

  // Validate AI provider
  if (!["none", "claude", "openai"].includes(data.aiProvider)) {
    return json({ error: "Invalid AI provider" }, { status: 400 });
  }

  // Encrypt API key if a new one was provided
  let aiApiKeyEncrypted: string | undefined;
  if (data.aiApiKey && data.aiApiKey.length > 0) {
    aiApiKeyEncrypted = CryptoService.encrypt(data.aiApiKey);
  }

  // Build update payload
  const updateData: Record<string, unknown> = {
    siteDescription: String(data.siteDescription ?? ""),
    includeProducts: Boolean(data.includeProducts),
    includePages: Boolean(data.includePages),
    includeCollections: Boolean(data.includeCollections),
    includeBlogPosts: Boolean(data.includeBlogPosts),
    botRules: JSON.stringify(data.botRules ?? {}),
    seoMetaEnabled: Boolean(data.seoMetaEnabled),
    seoJsonldEnabled: Boolean(data.seoJsonldEnabled),
    cacheDurationHours: Number(data.cacheDurationHours),
    aiProvider: data.aiProvider,
    aiModel: String(data.aiModel ?? ""),
    aiMaxTokens: Number(data.aiMaxTokens) || 150,
    aiPromptTemplate: String(data.aiPromptTemplate ?? ""),
    crawlTrackingEnabled: Boolean(data.crawlTrackingEnabled),
    multilingualEnabled: Boolean(data.multilingualEnabled),
  };

  if (aiApiKeyEncrypted !== undefined) {
    updateData.aiApiKeyEncrypted = aiApiKeyEncrypted;
  }

  await prisma.appSettings.upsert({
    where: { shopId },
    update: updateData,
    create: { shopId, ...updateData } as any,
  });

  // Sync shop-level metafields for Theme Extension
  try {
    const metafields = new MetafieldsService();
    await metafields.syncShopMetafields(admin, {
      seoMetaEnabled: Boolean(data.seoMetaEnabled),
      seoJsonldEnabled: Boolean(data.seoJsonldEnabled),
    });
  } catch (error) {
    console.error("[settings] Failed to sync shop metafields:", error);
  }

  return json({ success: true });
}

export default function SettingsPage() {
  const { settings } = useLoaderData<LoaderData>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  // Local state mirrors loader data
  const [siteDescription, setSiteDescription] = useState(settings.siteDescription);
  const [includeProducts, setIncludeProducts] = useState(settings.includeProducts);
  const [includePages, setIncludePages] = useState(settings.includePages);
  const [includeCollections, setIncludeCollections] = useState(settings.includeCollections);
  const [includeBlogPosts, setIncludeBlogPosts] = useState(settings.includeBlogPosts);
  const [botRules, setBotRules] = useState(settings.botRules);
  const [seoMetaEnabled, setSeoMetaEnabled] = useState(settings.seoMetaEnabled);
  const [seoJsonldEnabled, setSeoJsonldEnabled] = useState(settings.seoJsonldEnabled);
  const [cacheDurationHours, setCacheDurationHours] = useState(String(settings.cacheDurationHours));
  const [aiProvider, setAiProvider] = useState(settings.aiProvider);
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState(settings.aiModel);
  const [aiMaxTokens, setAiMaxTokens] = useState(String(settings.aiMaxTokens));
  const [aiPromptTemplate, setAiPromptTemplate] = useState(settings.aiPromptTemplate);
  const [crawlTrackingEnabled, setCrawlTrackingEnabled] = useState(settings.crawlTrackingEnabled);
  const [multilingualEnabled, setMultilingualEnabled] = useState(settings.multilingualEnabled);

  const handleBotToggle = useCallback((bot: string) => {
    setBotRules((prev) => ({
      ...prev,
      [bot]: prev[bot] === "allow" ? "disallow" : "allow",
    }));
  }, []);

  const handleSave = useCallback(() => {
    const payload = {
      siteDescription,
      includeProducts,
      includePages,
      includeCollections,
      includeBlogPosts,
      botRules,
      seoMetaEnabled,
      seoJsonldEnabled,
      cacheDurationHours: Number(cacheDurationHours),
      aiProvider,
      aiApiKey,
      aiModel,
      aiMaxTokens: Number(aiMaxTokens),
      aiPromptTemplate,
      crawlTrackingEnabled,
      multilingualEnabled,
    };
    const formData = new FormData();
    formData.set("settings", JSON.stringify(payload));
    submit(formData, { method: "post" });
  }, [
    siteDescription, includeProducts, includePages, includeCollections,
    includeBlogPosts, botRules, seoMetaEnabled, seoJsonldEnabled,
    cacheDurationHours, aiProvider, aiApiKey, aiModel, aiMaxTokens,
    aiPromptTemplate, crawlTrackingEnabled, multilingualEnabled, submit,
  ]);

  const cacheOptions = SUPPORTED_CACHE_DURATIONS.map((h) => ({
    label: `${h} hour${h > 1 ? "s" : ""}`,
    value: String(h),
  }));

  return (
    <Page title="Settings" primaryAction={{ content: "Save", onAction: handleSave, loading: saving }}>
      <BlockStack gap="500">
        {actionData && "success" in actionData && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>Settings saved.</p>
          </Banner>
        )}
        {actionData && "error" in actionData && (
          <ErrorBanner
            title="Settings error"
            message={String(actionData.error)}
            onRetry={handleSave}
            retrying={saving}
          />
        )}

        <Layout>
          {/* General */}
          <Layout.AnnotatedSection
            title="General"
            description="Store description and resource types for llms.txt"
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Store description"
                  value={siteDescription}
                  onChange={setSiteDescription}
                  multiline={3}
                  helpText="Appears in the header of llms.txt"
                  autoComplete="off"
                />
                <Checkbox label="Include products" checked={includeProducts} onChange={setIncludeProducts} />
                <Checkbox label="Include pages" checked={includePages} onChange={setIncludePages} />
                <Checkbox label="Include collections" checked={includeCollections} onChange={setIncludeCollections} />
                <Checkbox label="Include blog posts" checked={includeBlogPosts} onChange={setIncludeBlogPosts} />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          {/* AI Crawlers */}
          <Layout.AnnotatedSection
            title="AI Crawlers"
            description="Allow or disallow individual AI bots from accessing your store"
          >
            <Card>
              <BlockStack gap="200">
                {Object.entries(AI_BOTS).map(([bot, label]) => (
                  <Checkbox
                    key={bot}
                    label={`${bot} — ${label}`}
                    checked={(botRules[bot] ?? "allow") === "allow"}
                    onChange={() => handleBotToggle(bot)}
                  />
                ))}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          {/* SEO Signals */}
          <Layout.AnnotatedSection
            title="SEO Signals"
            description="Control meta tags and JSON-LD injected by the Theme Extension"
          >
            <Card>
              <BlockStack gap="300">
                <Checkbox
                  label="Enable llms meta tags"
                  helpText="Adds <meta name='llms'> and <meta name='llms-full'> to all pages"
                  checked={seoMetaEnabled}
                  onChange={setSeoMetaEnabled}
                />
                <Checkbox
                  label="Enable JSON-LD structured data"
                  helpText="Adds Schema.org WebSite and Product JSON-LD markup"
                  checked={seoJsonldEnabled}
                  onChange={setSeoJsonldEnabled}
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          {/* Caching */}
          <Layout.AnnotatedSection
            title="Caching"
            description="How long generated llms.txt content is cached"
          >
            <Card>
              <Select
                label="Cache duration"
                options={cacheOptions}
                value={cacheDurationHours}
                onChange={setCacheDurationHours}
              />
            </Card>
          </Layout.AnnotatedSection>

          {/* AI Generation */}
          <Layout.AnnotatedSection
            title="AI Generation"
            description="Configure the AI provider for automatic description generation"
          >
            <Card>
              <BlockStack gap="400">
                <Select
                  label="AI Provider"
                  options={[
                    { label: "None", value: "none" },
                    { label: "Anthropic Claude", value: "claude" },
                    { label: "OpenAI", value: "openai" },
                  ]}
                  value={aiProvider}
                  onChange={setAiProvider}
                />
                {aiProvider !== "none" && (
                  <>
                    <TextField
                      label="API Key"
                      value={aiApiKey}
                      onChange={setAiApiKey}
                      type="password"
                      helpText={
                        settings.hasApiKey
                          ? "A key is already saved. Enter a new one to replace it."
                          : "Enter your API key"
                      }
                      autoComplete="off"
                    />
                    <TextField
                      label="Model"
                      value={aiModel}
                      onChange={setAiModel}
                      placeholder={aiProvider === "claude" ? "claude-sonnet-4-20250514" : "gpt-4o-mini"}
                      helpText="Leave blank for default model"
                      autoComplete="off"
                    />
                    <TextField
                      label="Max tokens"
                      value={aiMaxTokens}
                      onChange={setAiMaxTokens}
                      type="number"
                      helpText="Maximum tokens for AI response (default: 150)"
                      autoComplete="off"
                    />
                    <TextField
                      label="Prompt template"
                      value={aiPromptTemplate}
                      onChange={setAiPromptTemplate}
                      multiline={5}
                      helpText="Use placeholders: {title}, {content}, {type}, {price}, {category}"
                      autoComplete="off"
                    />
                  </>
                )}
                {aiProvider !== "none" && !settings.hasApiKey && !aiApiKey && (
                  <Banner tone="warning">
                    <p>Set an API key to enable AI description generation on the Products and Pages tabs.</p>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          {/* Tracking */}
          <Layout.AnnotatedSection
            title="Tracking"
            description="AI crawler visit logging"
          >
            <Card>
              <Checkbox
                label="Enable crawl tracking"
                helpText="Log visits from AI bots to your llms.txt files"
                checked={crawlTrackingEnabled}
                onChange={setCrawlTrackingEnabled}
              />
            </Card>
          </Layout.AnnotatedSection>

          {/* Multilingual */}
          <Layout.AnnotatedSection
            title="Multilingual"
            description="Generate separate llms.txt files for each active language (Shopify Markets)"
          >
            <Card>
              <Checkbox
                label="Enable multilingual generation"
                helpText="Creates per-language llms.txt files using Shopify Translations API"
                checked={multilingualEnabled}
                onChange={setMultilingualEnabled}
              />
            </Card>
          </Layout.AnnotatedSection>
        </Layout>

        <InlineStack align="end">
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
