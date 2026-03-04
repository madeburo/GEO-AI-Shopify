/**
 * MetafieldsService — CRUD operations for Shopify Metafields
 * used to store AI metadata (description, keywords, exclude flag)
 * on products and pages, plus shop-level metafields for Theme Extension sync.
 *
 * Namespace: geo_ai
 * Keys: description (single_line_text_field, ≤200 chars),
 *        keywords (single_line_text_field),
 *        exclude (boolean)
 * Shop-level: seo_meta_enabled, seo_jsonld_enabled (boolean)
 */

import type { AdminApiContext } from "./shopify-api.server";
import { MAX_DESCRIPTION_LENGTH } from "../utils/constants";

export const METAFIELD_NAMESPACE = "geo_ai";

export interface AiMetadata {
  description: string | null;
  keywords: string | null;
  exclude: boolean;
}

/** Owner types for metafield definitions. */
type MetafieldOwnerType = "PRODUCT" | "PAGE";

interface MetafieldDefinitionSpec {
  name: string;
  namespace: string;
  key: string;
  type: string;
  ownerType: MetafieldOwnerType;
  description: string;
}

const RESOURCE_DEFINITIONS: MetafieldDefinitionSpec[] = [
  {
    name: "AI Description",
    namespace: METAFIELD_NAMESPACE,
    key: "description",
    type: "single_line_text_field",
    ownerType: "PRODUCT",
    description: "AI-optimized description for the product (max 200 chars)",
  },
  {
    name: "AI Keywords",
    namespace: METAFIELD_NAMESPACE,
    key: "keywords",
    type: "single_line_text_field",
    ownerType: "PRODUCT",
    description: "AI keywords for the product",
  },
  {
    name: "AI Exclude",
    namespace: METAFIELD_NAMESPACE,
    key: "exclude",
    type: "boolean",
    ownerType: "PRODUCT",
    description: "Exclude this product from llms.txt index",
  },
  {
    name: "AI Description",
    namespace: METAFIELD_NAMESPACE,
    key: "description",
    type: "single_line_text_field",
    ownerType: "PAGE",
    description: "AI-optimized description for the page (max 200 chars)",
  },
  {
    name: "AI Keywords",
    namespace: METAFIELD_NAMESPACE,
    key: "keywords",
    type: "single_line_text_field",
    ownerType: "PAGE",
    description: "AI keywords for the page",
  },
  {
    name: "AI Exclude",
    namespace: METAFIELD_NAMESPACE,
    key: "exclude",
    type: "boolean",
    ownerType: "PAGE",
    description: "Exclude this page from llms.txt index",
  },
];

// ── GraphQL fragments ────────────────────────────────────────────────────

const METAFIELD_DEFINITION_CREATE = `
  mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        name
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_RESOURCE_METAFIELDS = `
  query GetResourceMetafields($id: ID!) {
    node(id: $id) {
      ... on Product {
        descriptionMeta: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "description") { value }
        keywordsMeta: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "keywords") { value }
        excludeMeta: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "exclude") { value }
      }
      ... on Page {
        descriptionMeta: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "description") { value }
        keywordsMeta: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "keywords") { value }
        excludeMeta: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "exclude") { value }
      }
    }
  }
`;

const SET_METAFIELDS = `
  mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DELETE_METAFIELDS_BY_OWNER = `
  mutation DeleteMetafield($input: MetafieldDeleteInput!) {
    metafieldDelete(input: $input) {
      deletedId
      userErrors {
        field
        message
      }
    }
  }
`;

/** Query for reading shop-level SEO metafields (used by other services). */
export const GET_SHOP_METAFIELDS = `
  query GetShopMetafields {
    shop {
      seoMetaEnabled: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "seo_meta_enabled") { id value }
      seoJsonldEnabled: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "seo_jsonld_enabled") { id value }
    }
  }
`;

// ── Validation ───────────────────────────────────────────────────────────

/**
 * Validates AI description length.
 * Returns true if valid (≤ MAX_DESCRIPTION_LENGTH), false otherwise.
 */
export function validateDescriptionLength(description: string): boolean {
  return description.length <= MAX_DESCRIPTION_LENGTH;
}

// ── Service ──────────────────────────────────────────────────────────────

export class MetafieldsService {
  /**
   * Register metafield definitions for PRODUCT and PAGE owner types.
   * Safe to call multiple times — Shopify ignores duplicates
   * (returns userError "already exists" which we silently skip).
   */
  async registerDefinitions(admin: AdminApiContext): Promise<void> {
    for (const def of RESOURCE_DEFINITIONS) {
      const response = await admin.graphql(METAFIELD_DEFINITION_CREATE, {
        variables: {
          definition: {
            name: def.name,
            namespace: def.namespace,
            key: def.key,
            type: def.type,
            ownerType: def.ownerType,
            description: def.description,
          },
        },
      });

      const json = await response.json();
      const userErrors = json.data?.metafieldDefinitionCreate?.userErrors;

      // Ignore "already exists" errors — idempotent registration
      if (userErrors?.length) {
        const realErrors = userErrors.filter(
          (e: any) => !e.message?.includes("already exists"),
        );
        if (realErrors.length) {
          throw new Error(
            `Failed to register metafield definition ${def.ownerType}.${def.key}: ` +
              realErrors.map((e: any) => e.message).join("; "),
          );
        }
      }
    }
  }

  /**
   * Read AI metadata from a product or page by its Shopify GID.
   */
  async getMetadata(
    admin: AdminApiContext,
    resourceId: string,
  ): Promise<AiMetadata> {
    const response = await admin.graphql(GET_RESOURCE_METAFIELDS, {
      variables: { id: resourceId },
    });
    const json = await response.json();
    const node = json.data?.node;

    if (!node) {
      return { description: null, keywords: null, exclude: false };
    }

    return {
      description: node.descriptionMeta?.value ?? null,
      keywords: node.keywordsMeta?.value ?? null,
      exclude: node.excludeMeta?.value === "true",
    };
  }

  /**
   * Write AI metadata to a product or page.
   * Only provided fields are updated; omitted fields are left unchanged.
   * Validates description length before writing.
   */
  async setMetadata(
    admin: AdminApiContext,
    resourceId: string,
    data: Partial<AiMetadata>,
  ): Promise<void> {
    if (
      data.description !== undefined &&
      data.description !== null &&
      !validateDescriptionLength(data.description)
    ) {
      throw new Error(
        `AI description exceeds maximum length of ${MAX_DESCRIPTION_LENGTH} characters`,
      );
    }

    const metafields: Array<{
      ownerId: string;
      namespace: string;
      key: string;
      value: string;
      type: string;
    }> = [];

    if (data.description !== undefined) {
      metafields.push({
        ownerId: resourceId,
        namespace: METAFIELD_NAMESPACE,
        key: "description",
        value: data.description ?? "",
        type: "single_line_text_field",
      });
    }

    if (data.keywords !== undefined) {
      metafields.push({
        ownerId: resourceId,
        namespace: METAFIELD_NAMESPACE,
        key: "keywords",
        value: data.keywords ?? "",
        type: "single_line_text_field",
      });
    }

    if (data.exclude !== undefined) {
      metafields.push({
        ownerId: resourceId,
        namespace: METAFIELD_NAMESPACE,
        key: "exclude",
        value: String(data.exclude),
        type: "boolean",
      });
    }

    if (metafields.length === 0) return;

    const response = await admin.graphql(SET_METAFIELDS, {
      variables: { metafields },
    });
    const json = await response.json();
    const userErrors = json.data?.metafieldsSet?.userErrors;

    if (userErrors?.length) {
      throw new Error(
        "Failed to set metafields: " +
          userErrors.map((e: any) => e.message).join("; "),
      );
    }
  }

  /**
   * Delete all geo_ai metafields for the shop.
   * Used during app uninstallation cleanup.
   *
   * Fetches all products and pages with geo_ai metafields,
   * then deletes each metafield by ID.
   */
  async deleteAllMetafields(admin: AdminApiContext): Promise<void> {
    const resourceTypes = ["products", "pages"] as const;

    for (const resourceType of resourceTypes) {
      const query = `
        query ListMetafields($cursor: String) {
          ${resourceType}(first: 250, after: $cursor) {
            edges {
              node {
                metafields(namespace: "${METAFIELD_NAMESPACE}", first: 10) {
                  edges {
                    node { id }
                  }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;

      let cursor: string | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const response = await admin.graphql(query, {
          variables: { cursor },
        });
        const json = await response.json();
        const connection = json.data?.[resourceType];

        if (!connection) break;

        for (const edge of connection.edges) {
          for (const mfEdge of edge.node.metafields.edges) {
            await admin.graphql(DELETE_METAFIELDS_BY_OWNER, {
              variables: { input: { id: mfEdge.node.id } },
            });
          }
        }

        if (!connection.pageInfo.hasNextPage) break;
        cursor = connection.pageInfo.endCursor;
      }
    }
  }

  /**
   * Sync shop-level metafields used by Theme Extension.
   * These metafields control whether SEO meta tags and JSON-LD
   * are rendered in the storefront.
   */
  async syncShopMetafields(
    admin: AdminApiContext,
    settings: { seoMetaEnabled: boolean; seoJsonldEnabled: boolean },
  ): Promise<void> {
    // Get the shop GID first
    const shopResponse = await admin.graphql(`{ shop { id } }`);
    const shopJson = await shopResponse.json();
    const shopId = shopJson.data?.shop?.id;

    if (!shopId) {
      throw new Error("Failed to retrieve shop ID for metafield sync");
    }

    const metafields = [
      {
        ownerId: shopId,
        namespace: METAFIELD_NAMESPACE,
        key: "seo_meta_enabled",
        value: String(settings.seoMetaEnabled),
        type: "boolean",
      },
      {
        ownerId: shopId,
        namespace: METAFIELD_NAMESPACE,
        key: "seo_jsonld_enabled",
        value: String(settings.seoJsonldEnabled),
        type: "boolean",
      },
    ];

    const response = await admin.graphql(SET_METAFIELDS, {
      variables: { metafields },
    });
    const json = await response.json();
    const userErrors = json.data?.metafieldsSet?.userErrors;

    if (userErrors?.length) {
      throw new Error(
        "Failed to sync shop metafields: " +
          userErrors.map((e: any) => e.message).join("; "),
      );
    }
  }
}
