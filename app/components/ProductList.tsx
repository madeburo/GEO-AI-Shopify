import { ResourceList, type ResourceItem, type ResourceListProps } from "./ResourceList";

export type { ResourceItem as ProductItem };

export type ProductListProps = Omit<ResourceListProps, "resourceType">;

/**
 * Product list with AI metadata columns, filtering, pagination, and bulk selection.
 * Columns: title, AI description (truncated), keywords, exclude status.
 */
export function ProductList(props: ProductListProps) {
  return <ResourceList resourceType="products" {...props} />;
}
