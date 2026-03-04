/**
 * App Proxy route: /apps/llms/standard
 *
 * Serves the standard llms.txt content for the shop's default language.
 *
 * Shopify App Proxy forwards `/apps/llms/standard` to
 * `{app_url}/proxy/standard`.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { handleProxyRequest } from "../utils/proxy-helpers.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return handleProxyRequest(request, { isFull: false });
}
