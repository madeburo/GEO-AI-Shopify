/**
 * ShopifyApiService — wrapper around Shopify Admin GraphQL API
 * with exponential backoff, cursor-based pagination, cost tracking,
 * and Bulk Operations support.
 */

/** Minimal shape of the Shopify Admin API context used by this service. */
export interface AdminApiContext {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface BulkOperationResult {
  id: string;
  status: string;
  url: string | null;
  errorCode: string | null;
}

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: { cost?: { throttleStatus?: { currentlyAvailable?: number } } };
}

/** Default delays: 1s, 2s, 4s */
const BASE_DELAY_MS = 1000;
const DEFAULT_MAX_RETRIES = 3;
const PROACTIVE_THROTTLE_THRESHOLD = 50;

/** Promise-based sleep helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SleepFn = (ms: number) => Promise<void>;

export class ShopifyApiService {
  private _sleep: SleepFn;

  constructor(sleepFn?: SleepFn) {
    this._sleep = sleepFn ?? sleep;
  }

  /**
   * Execute a single GraphQL query. Throws on GraphQL-level errors.
   */
  async query<T>(
    admin: AdminApiContext,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const response = await admin.graphql(query, { variables });
    const json: GraphQLResponse<T> = await response.json();

    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join("; ");
      const firstCode = json.errors[0]?.extensions?.code;
      const err = new Error(msg);
      (err as any).code = firstCode;
      throw err;
    }

    return json.data as T;
  }

  /**
   * Execute a GraphQL query with exponential backoff on THROTTLED errors.
   *
   * Delay schedule: BASE_DELAY_MS * 2^attempt  →  1 s, 2 s, 4 s, …
   * Also applies proactive throttling when available cost points drop
   * below PROACTIVE_THROTTLE_THRESHOLD.
   */
  async queryWithRetry<T>(
    admin: AdminApiContext,
    query: string,
    variables?: Record<string, unknown>,
    maxRetries = DEFAULT_MAX_RETRIES,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await admin.graphql(query, { variables });
        const json: GraphQLResponse<T> = await response.json();

        // Check for THROTTLED errors
        const throttled = json.errors?.some(
          (e) => e.extensions?.code === "THROTTLED",
        );

        if (throttled && attempt < maxRetries) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await this._sleep(delay);
          continue;
        }

        if (json.errors?.length) {
          const msg = json.errors.map((e) => e.message).join("; ");
          const err = new Error(msg);
          (err as any).code = json.errors[0]?.extensions?.code;
          throw err;
        }

        // Proactive throttling: if available points are low, pause briefly
        const available =
          json.extensions?.cost?.throttleStatus?.currentlyAvailable;
        if (
          available !== undefined &&
          available < PROACTIVE_THROTTLE_THRESHOLD
        ) {
          await this._sleep(BASE_DELAY_MS);
        }

        return json.data as T;
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await this._sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Automatically paginate through all pages of a GraphQL connection,
   * collecting every node into a single array.
   *
   * `extractNodes` pulls the node array from the response data.
   * `extractPageInfo` pulls the PageInfo object from the response data.
   *
   * The query MUST accept a `$cursor: String` variable and use
   * `first: 250, after: $cursor` in the connection field.
   */
  async paginateAll<T>(
    admin: AdminApiContext,
    query: string,
    extractNodes: (data: any) => T[],
    extractPageInfo: (data: any) => PageInfo,
    variables?: Record<string, unknown>,
  ): Promise<T[]> {
    const allNodes: T[] = [];
    let cursor: string | null = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const vars = { ...variables, cursor };
      const data = await this.queryWithRetry<any>(admin, query, vars);

      const nodes = extractNodes(data);
      allNodes.push(...nodes);

      const pageInfo = extractPageInfo(data);
      if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
      cursor = pageInfo.endCursor;
    }

    return allNodes;
  }

  /**
   * Start a Shopify Bulk Operation and return the operation GID.
   */
  async startBulkOperation(
    admin: AdminApiContext,
    query: string,
  ): Promise<string> {
    const mutation = `
      mutation BulkOperation($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation { id status }
          userErrors { field message }
        }
      }
    `;

    const data = await this.queryWithRetry<any>(admin, mutation, { query });
    const result = data.bulkOperationRunQuery;

    if (result.userErrors?.length) {
      throw new Error(
        result.userErrors.map((e: any) => e.message).join("; "),
      );
    }

    return result.bulkOperation.id;
  }

  /**
   * Poll a running Bulk Operation until it completes or fails.
   * Returns the final status and the JSONL download URL.
   */
  async pollBulkOperation(
    admin: AdminApiContext,
    operationId: string,
    pollIntervalMs = 2000,
  ): Promise<BulkOperationResult> {
    const pollQuery = `
      query BulkOperationPoll($id: ID!) {
        node(id: $id) {
          ... on BulkOperation {
            id
            status
            url
            errorCode
          }
        }
      }
    `;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const data = await this.queryWithRetry<any>(admin, pollQuery, {
        id: operationId,
      });
      const op = data.node as BulkOperationResult;

      if (op.status === "COMPLETED" || op.status === "FAILED") {
        return op;
      }

      await this._sleep(pollIntervalMs);
    }
  }
}
