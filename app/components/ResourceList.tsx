import { useCallback, useMemo, useState } from "react";
import {
  BlockStack,
  Box,
  Card,
  ChoiceList,
  IndexTable,
  InlineStack,
  Pagination,
  Text,
  useIndexResourceState,
} from "@shopify/polaris";
import { filterByAiStatus, paginate } from "./resource-list-utils";

/** AI filter status options */
export type AiFilterStatus = "all" | "with_description" | "without_description" | "excluded";

/** A resource (product or page) with its AI metadata */
export interface ResourceItem {
  id: string;
  title: string;
  description: string;
  keywords: string;
  exclude: boolean;
}

export interface ResourceListProps {
  /** "products" or "pages" — used for labelling */
  resourceType: "products" | "pages";
  items: ResourceItem[];
  /** Items per page, defaults to 10 */
  pageSize?: number;
  onSelect?: (item: ResourceItem) => void;
  onBulkGenerate?: (ids: string[]) => void;
  bulkGenerateAvailable?: boolean;
}

const FILTER_OPTIONS: { label: string; value: AiFilterStatus }[] = [
  { label: "All", value: "all" },
  { label: "With AI description", value: "with_description" },
  { label: "Without AI description", value: "without_description" },
  { label: "Excluded", value: "excluded" },
];

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

/**
 * Shared resource list component with filtering, pagination, and bulk selection.
 * Used by both ProductList and PageList.
 */
export function ResourceList({
  resourceType,
  items,
  pageSize = 10,
  onSelect,
  onBulkGenerate,
  bulkGenerateAvailable = false,
}: ResourceListProps) {
  const [filter, setFilter] = useState<AiFilterStatus[]>(["all"]);
  const [currentPage, setCurrentPage] = useState(1);

  const activeFilter = filter[0] ?? "all";

  const filtered = useMemo(
    () => filterByAiStatus(items, activeFilter),
    [items, activeFilter],
  );

  const { pageItems, totalPages, safePage: safeCurrentPage } = useMemo(
    () => paginate(filtered, currentPage, pageSize),
    [filtered, currentPage, pageSize],
  );

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(pageItems as unknown as { [key: string]: unknown }[]);

  const handleFilterChange = useCallback((value: string[]) => {
    setFilter(value as AiFilterStatus[]);
    setCurrentPage(1);
  }, []);

  const handleBulkGenerate = useCallback(() => {
    if (onBulkGenerate && selectedResources.length > 0) {
      onBulkGenerate(selectedResources as string[]);
    }
  }, [onBulkGenerate, selectedResources]);

  const label = resourceType === "products" ? "Products" : "Pages";

  const promotedBulkActions =
    bulkGenerateAvailable && onBulkGenerate
      ? [{ content: "Generate AI descriptions", onAction: handleBulkGenerate }]
      : [];

  const rowMarkup = pageItems.map((item, index) => (
    <IndexTable.Row
      id={item.id}
      key={item.id}
      position={index}
      selected={selectedResources.includes(item.id)}
      onClick={() => onSelect?.(item)}
    >
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {item.title}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone={item.description ? undefined : "subdued"}>
          {item.description ? truncate(item.description, 60) : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone={item.keywords ? undefined : "subdued"}>
          {item.keywords || "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {item.exclude ? (
          <Text as="span" tone="caution">Excluded</Text>
        ) : (
          <Text as="span" tone="subdued">—</Text>
        )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">{label}</Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {filtered.length} {resourceType}
          </Text>
        </InlineStack>

        <ChoiceList
          title="Filter"
          titleHidden
          choices={FILTER_OPTIONS}
          selected={filter}
          onChange={handleFilterChange}
        />

        <IndexTable
          resourceName={{ singular: resourceType.slice(0, -1), plural: resourceType }}
          itemCount={pageItems.length}
          selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
          onSelectionChange={handleSelectionChange}
          headings={[
            { title: "Title" },
            { title: "AI Description" },
            { title: "Keywords" },
            { title: "Status" },
          ]}
          promotedBulkActions={promotedBulkActions}
          selectable={bulkGenerateAvailable}
        >
          {rowMarkup}
        </IndexTable>

        {totalPages > 1 && (
          <Box paddingBlockStart="400">
            <InlineStack align="center">
              <Pagination
                hasPrevious={safeCurrentPage > 1}
                hasNext={safeCurrentPage < totalPages}
                onPrevious={() => setCurrentPage((p) => Math.max(1, p - 1))}
                onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                label={`${safeCurrentPage} / ${totalPages}`}
              />
            </InlineStack>
          </Box>
        )}
      </BlockStack>
    </Card>
  );
}
