/**
 * Protected API route: GET /api/settings
 *
 * Returns current app settings for the authenticated shop.
 * API keys are excluded — only a boolean `hasApiKey` is returned.
 *
 * Validates: Requirements 9.5, 9.6
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shopId = session.shop;

    const settings = await prisma.appSettings.findUnique({
      where: { shopId },
    });

    if (!settings) {
      return json({ error: "Shop settings not found" }, { status: 404 });
    }

    // Return settings WITHOUT the encrypted API key.
    // Instead, provide a boolean indicating whether a key is configured.
    const {
      aiApiKeyEncrypted: _excluded,
      ...safeSettings
    } = settings;

    return json({
      ...safeSettings,
      hasApiKey: Boolean(settings.aiApiKeyEncrypted),
    });
  } catch (error) {
    if (error instanceof Response) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[api/settings] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
