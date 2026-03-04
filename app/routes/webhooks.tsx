import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { WebhookHandler } from "../services/webhook-handler.server";

const webhookHandler = new WebhookHandler();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin, payload } =
    await authenticate.webhook(request);

  // APP_UNINSTALLED fires after the shop removed the app — admin context
  // is not available, but we still need to clean up local data.
  if (!admin && topic !== "APP_UNINSTALLED") {
    throw new Response();
  }

  switch (topic) {
    case "APP_UNINSTALLED":
      await webhookHandler.handleAppUninstalled(shop);
      break;

    case "PRODUCTS_CREATE":
    case "PRODUCTS_UPDATE":
    case "PRODUCTS_DELETE":
      await webhookHandler.handleProductChange(shop, topic, payload);
      break;

    case "PAGES_CREATE":
    case "PAGES_UPDATE":
    case "PAGES_DELETE":
      await webhookHandler.handlePageChange(shop, topic, payload);
      break;

    case "COLLECTIONS_CREATE":
    case "COLLECTIONS_UPDATE":
    case "COLLECTIONS_DELETE":
      await webhookHandler.handleCollectionChange(shop, topic, payload);
      break;

    case "CUSTOMERS_DATA_REQUEST":
      // App does not store customer personal data
      return new Response("No customer data stored", { status: 200 });

    case "CUSTOMERS_REDACT":
      // App does not store customer personal data
      return new Response("No customer data to redact", { status: 200 });

    case "SHOP_REDACT":
      // GDPR: delete all shop data (same as app/uninstalled)
      await webhookHandler.handleAppUninstalled(shop);
      break;

    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  throw new Response();
};
