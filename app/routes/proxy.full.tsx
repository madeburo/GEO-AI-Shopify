/**
 * App Proxy route: /apps/llms/full
 *
 * Serves the full llms-full.txt content for the shop's default language.
 *
 * Shopify App Proxy forwards `/apps/llms/full` to
 * `{app_url}/proxy/full`.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { handleProxyRequest } from "../utils/proxy-helpers.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return handleProxyRequest(request, { isFull: true });
}
