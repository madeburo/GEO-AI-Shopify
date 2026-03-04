/**
 * App Proxy route: /apps/llms/standard/:locale
 *
 * Serves the standard llms.txt content for a specific locale.
 *
 * Shopify App Proxy forwards `/apps/llms/standard/ru` to
 * `{app_url}/proxy/standard/ru`. Remix splat route captures
 * the locale from the `*` param.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { handleProxyRequest } from "../utils/proxy-helpers.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const locale = params["*"] || undefined;
  return handleProxyRequest(request, { isFull: false, locale });
}
