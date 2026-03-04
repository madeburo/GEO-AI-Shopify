/**
 * Public API route: GET /api/llms
 *
 * Returns the standard llms.txt content for a shop.
 * No authentication required.
 *
 * Query params:
 *   - shop (required): the myshopify.com domain, e.g. "my-store.myshopify.com"
 *
 * Validates: Requirements 9.1
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { handlePublicLlmsRequest } from "../utils/api-llms-helpers.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return handlePublicLlmsRequest(request, { isFull: false });
}
