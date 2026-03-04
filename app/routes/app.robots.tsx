/**
 * Robots.txt page: /app/robots
 *
 * - Displays recommended robots.txt rules via RobotsBlock component
 * - "Copy to clipboard" button
 * - Instructions for merchant: Settings → Custom data → robots.txt
 * - Updates block when crawler rules change
 * - Marks `robotsCopied` in onboarding when copied
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import { useCallback } from "react";
import { Page, Layout, BlockStack } from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { LlmsGenerator } from "../services/llms-generator.server";
import type { AppSettings } from "../services/llms-generator.server";
import { RobotsBlock } from "../components/RobotsBlock";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopId = session.shop;

  let settings = await prisma.appSettings.findUnique({ where: { shopId } });
  if (!settings) {
    settings = await prisma.appSettings.create({ data: { shopId } });
  }

  // Get the shop's primary domain for the robots.txt block
  const shopResponse = await admin.graphql(`{ shop { primaryDomain { url } } }`);
  const shopData = await shopResponse.json();
  const shopUrl: string = shopData.data?.shop?.primaryDomain?.url ?? `https://${shopId}`;

  // Generate the robots.txt block
  const generator = new LlmsGenerator(admin, settings as unknown as AppSettings);
  const robotsContent = generator.generateRobotsTxtBlock(shopUrl);

  return json({ robotsContent });
};

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "mark_copied") {
    await prisma.appSettings.upsert({
      where: { shopId },
      update: { robotsCopied: true },
      create: { shopId, robotsCopied: true },
    });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

export default function RobotsPage() {
  const { robotsContent } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const handleCopied = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "mark_copied");
    submit(formData, { method: "post" });
  }, [submit]);

  return (
    <Page title="Robots.txt">
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <RobotsBlock content={robotsContent} onCopied={handleCopied} />
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
