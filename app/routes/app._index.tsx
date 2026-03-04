/**
 * Dashboard route: /app
 *
 * - Shows OnboardingWizard on first launch (setupWizardCompleted === false)
 * - Shows OnboardingChecklist until all steps are done
 * - Main dashboard: crawl stats, llms.txt status, quick actions
 * - Empty states when no products/pages exist
 *
 * Validates: Requirements 16.1, 16.4, 16.5, 17.1, 17.2
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Banner,
  Badge,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { CrawlTracker } from "../services/crawl-tracker.server";
import { CacheService } from "../services/cache.server";
import { LlmsGenerator } from "../services/llms-generator.server";
import type { AppSettings } from "../services/llms-generator.server";
import { CryptoService } from "../services/crypto.server";
import { MetafieldsService } from "../services/metafields.server";
import { OnboardingWizard } from "../components/OnboardingWizard";
import type { WizardSettings } from "../components/OnboardingWizard";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import { CrawlStats } from "../components/CrawlStats";
import type { BotActivityRow } from "../components/CrawlStats";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopId = session.shop;

  // Ensure settings row exists; on first load register metafield definitions
  let settings = await prisma.appSettings.findUnique({ where: { shopId } });
  if (!settings) {
    settings = await prisma.appSettings.create({ data: { shopId } });

    // First-time setup: register metafield definitions for PRODUCT and PAGE
    try {
      const metafields = new MetafieldsService();
      await metafields.registerDefinitions(admin);
    } catch (error) {
      console.error("[dashboard] Failed to register metafield definitions:", error);
    }
  }

  // Crawl stats (last 30 days)
  const tracker = new CrawlTracker();
  const [totalVisits, botActivity] = await Promise.all([
    tracker.getTotalVisits(shopId),
    tracker.getRecentActivity(shopId),
  ]);

  const bots: BotActivityRow[] = botActivity.map((b) => ({
    botName: b.botName,
    displayName: b.displayName,
    totalVisits: b.totalVisits,
    lastVisit: b.lastVisit.toISOString(),
  }));

  // Check cache status for llms.txt files
  const cache = new CacheService();
  const [standardCache, fullCache] = await Promise.all([
    cache.get(shopId, "llms_standard"),
    cache.get(shopId, "llms_full"),
  ]);

  // Count products and pages via Shopify Admin API
  let hasProducts = false;
  let hasPages = false;
  let loaderError: string | null = null;

  try {
    const countResponse = await admin.graphql(`{
      products(first: 1) { edges { node { id } } }
      pages(first: 1) { edges { node { id } } }
    }`);
    const countData = await countResponse.json();
    hasProducts = (countData.data?.products?.edges?.length ?? 0) > 0;
    hasPages = (countData.data?.pages?.edges?.length ?? 0) > 0;
  } catch (error) {
    console.error("[dashboard] Shopify API error:", error);
    loaderError = error instanceof Error ? error.message : "Failed to load store data from Shopify API.";
  }

  return json({
    setupWizardCompleted: settings.setupWizardCompleted,
    onboarding: {
      setupWizardCompleted: settings.setupWizardCompleted,
      llmsGenerated: settings.llmsGenerated,
      robotsCopied: settings.robotsCopied,
    },
    crawlStats: { totalVisits, bots },
    llmsStatus: {
      standardCached: standardCache !== null,
      fullCached: fullCache !== null,
    },
    hasProducts,
    hasPages,
    shopId,
    loaderError,
  });
};

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "complete_wizard") {
    const wizardData = JSON.parse(
      formData.get("wizardData") as string,
    ) as WizardSettings;

    // Encrypt API key if provided
    let aiApiKeyEncrypted = "";
    if (wizardData.aiApiKey) {
      aiApiKeyEncrypted = CryptoService.encrypt(wizardData.aiApiKey);
    }

    // Save settings
    const settings = await prisma.appSettings.upsert({
      where: { shopId },
      update: {
        siteDescription: wizardData.siteDescription,
        aiProvider: wizardData.aiProvider,
        aiApiKeyEncrypted,
        botRules: JSON.stringify(wizardData.botRules),
        setupWizardCompleted: true,
      },
      create: {
        shopId,
        siteDescription: wizardData.siteDescription,
        aiProvider: wizardData.aiProvider,
        aiApiKeyEncrypted,
        botRules: JSON.stringify(wizardData.botRules),
        setupWizardCompleted: true,
      },
    });

    // Sync SEO metafields to Theme Extension
    const metafields = new MetafieldsService();
    await metafields.syncShopMetafields(admin, {
      seoMetaEnabled: settings.seoMetaEnabled,
      seoJsonldEnabled: settings.seoJsonldEnabled,
    });

    // Generate llms.txt files
    try {
      const generator = new LlmsGenerator(admin, settings as unknown as AppSettings);
      const genResult = await generator.regenerateAndCache();
      if (!genResult.success) {
        console.error("[dashboard] llms generation after wizard failed:", genResult.error);
      }
    } catch (error) {
      console.error("[dashboard] llms generation after wizard failed:", error);
    }

    return json({ success: true });
  }

  if (intent === "skip_wizard") {
    await prisma.appSettings.upsert({
      where: { shopId },
      update: { setupWizardCompleted: true },
      create: { shopId, setupWizardCompleted: true },
    });
    return json({ success: true });
  }

  if (intent === "regenerate") {
    const settings = await prisma.appSettings.findUnique({ where: { shopId } });
    if (!settings) {
      return json({ error: "Settings not found" }, { status: 404 });
    }
    const generator = new LlmsGenerator(admin, settings as unknown as AppSettings);
    const result = await generator.regenerateAndCache();
    if (result.success) {
      return json({ success: true, regenerated: true });
    }
    return json(
      { error: result.error ?? "Regeneration failed. Previous files are preserved." },
      { status: 500 },
    );
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

export default function Dashboard() {
  const {
    setupWizardCompleted,
    onboarding,
    crawlStats,
    llmsStatus,
    hasProducts,
    hasPages,
    loaderError,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const handleWizardComplete = (wizardSettings: WizardSettings) => {
    const formData = new FormData();
    formData.set("intent", "complete_wizard");
    formData.set("wizardData", JSON.stringify(wizardSettings));
    submit(formData, { method: "post" });
  };

  const handleSkipWizard = () => {
    const formData = new FormData();
    formData.set("intent", "skip_wizard");
    submit(formData, { method: "post" });
  };

  const handleRegenerate = () => {
    const formData = new FormData();
    formData.set("intent", "regenerate");
    submit(formData, { method: "post" });
  };

  // Show wizard on first launch
  if (!setupWizardCompleted) {
    return (
      <Page title="GEO AI Shopify">
        <Layout>
          <Layout.Section>
            <OnboardingWizard
              onComplete={handleWizardComplete}
              onSkip={handleSkipWizard}
              saving={saving}
            />
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title="GEO AI Shopify">
      <BlockStack gap="500">
        <Layout>
          {/* Loader-level Shopify API error with retry */}
          {loaderError && (
            <Layout.Section>
              <ErrorBanner
                title="Shopify API error"
                message={loaderError}
                onRetry={() => submit(null, { method: "get" })}
              />
            </Layout.Section>
          )}

          {/* Onboarding checklist */}
          <Layout.Section>
            <OnboardingChecklist status={onboarding} />
          </Layout.Section>

          {/* llms.txt status + quick actions */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  llms.txt Status
                </Text>
                <InlineStack gap="300">
                  <Badge tone={llmsStatus.standardCached ? "success" : "attention"}>
                    {llmsStatus.standardCached ? "llms.txt cached" : "llms.txt not cached"}
                  </Badge>
                  <Badge tone={llmsStatus.fullCached ? "success" : "attention"}>
                    {llmsStatus.fullCached ? "llms-full.txt cached" : "llms-full.txt not cached"}
                  </Badge>
                </InlineStack>
                <InlineStack gap="200">
                  <Button onClick={handleRegenerate} loading={saving}>
                    Regenerate files
                  </Button>
                </InlineStack>
                {actionData && "regenerated" in actionData && (
                  <Banner tone="success">
                    <p>Files regenerated successfully.</p>
                  </Banner>
                )}
                {actionData && "error" in actionData && (
                  <ErrorBanner
                    title="Regeneration failed"
                    message={`${String(actionData.error)} Previous files are preserved.`}
                    onRetry={handleRegenerate}
                    retrying={saving}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Crawl stats */}
          <Layout.Section>
            <CrawlStats
              totalVisits={crawlStats.totalVisits}
              bots={crawlStats.bots}
            />
          </Layout.Section>

          {/* Empty states */}
          {!hasProducts && (
            <Layout.Section>
              <EmptyState
                heading="No products yet"
                message="Add products to your store so GEO AI can include them in llms.txt files."
                actionLabel="Add product"
                actionUrl="shopify://admin/products/new"
              />
            </Layout.Section>
          )}
          {!hasPages && (
            <Layout.Section>
              <EmptyState
                heading="No pages yet"
                message="Create pages in your store so GEO AI can include them in llms.txt files."
                actionLabel="Add page"
                actionUrl="shopify://admin/pages/new"
              />
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
