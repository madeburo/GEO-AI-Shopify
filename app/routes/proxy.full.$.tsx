/**
 * App Proxy route: /apps/llms/full/:locale
 *
 * Serves the full llms-full.txt content for a specific locale.
 *
 * Shopify App Proxy forwards `/apps/llms/full/ru` to
 * `{app_url}/proxy/full/ru`. Remix splat route captures
 * the locale from the `*` param.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { handleProxyRequest } from "../utils/proxy-helpers.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const locale = params["*"] || undefined;
  return handleProxyRequest(request, { isFull: true, locale });
}
