/**
 * Pure utility functions for ResourceList filtering and pagination.
 * Extracted for testability in node environment (no DOM required).
 */

import type { AiFilterStatus, ResourceItem } from "./ResourceList";

/**
 * Filter resource items by AI status.
 *
 * - "all": no filtering
 * - "with_description": items with non-empty description AND not excluded
 * - "without_description": items with empty description AND not excluded
 * - "excluded": items with exclude === true
 */
export function filterByAiStatus(
  items: ResourceItem[],
  filter: AiFilterStatus,
): ResourceItem[] {
  switch (filter) {
    case "with_description":
      return items.filter((i) => i.description.length > 0 && !i.exclude);
    case "without_description":
      return items.filter((i) => i.description.length === 0 && !i.exclude);
    case "excluded":
      return items.filter((i) => i.exclude);
    default:
      return items;
  }
}

/**
 * Paginate a list of items.
 *
 * Returns the slice of items for the given page, clamping the page number
 * to valid bounds. Also returns computed pagination metadata.
 */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): { pageItems: T[]; totalPages: number; safePage: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pageItems = items.slice(startIdx, startIdx + pageSize);
  return { pageItems, totalPages, safePage };
}
