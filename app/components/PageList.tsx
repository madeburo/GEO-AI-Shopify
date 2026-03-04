import { ResourceList, type ResourceItem, type ResourceListProps } from "./ResourceList";

export type { ResourceItem as PageItem };

export type PageListProps = Omit<ResourceListProps, "resourceType">;

/**
 * Page list with AI metadata columns, filtering, pagination, and bulk selection.
 * Columns: title, AI description (truncated), keywords, exclude status.
 */
export function PageList(props: PageListProps) {
  return <ResourceList resourceType="pages" {...props} />;
}
