import { Banner, BlockStack, InlineStack, ProgressBar, Text } from "@shopify/polaris";

export interface BulkProgressBarProps {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  status: "running" | "complete" | "error";
}

/**
 * Progress bar for bulk AI description generation.
 * Shows processed/total counts with success/failure breakdown.
 */
export function BulkProgressBar({
  total,
  processed,
  succeeded,
  failed,
  status,
}: BulkProgressBarProps) {
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  const tone =
    status === "error" ? "critical" : status === "complete" ? "success" : "info";

  const statusLabel =
    status === "running"
      ? "Generating..."
      : status === "complete"
        ? "Complete"
        : "Error";

  return (
    <Banner tone={tone} title={`Bulk generation: ${statusLabel}`}>
      <BlockStack gap="200">
        <ProgressBar progress={percent} size="small" tone={tone === "critical" ? "critical" : "primary"} />
        <InlineStack gap="400">
          <Text as="span" variant="bodySm">
            {processed} / {total} processed
          </Text>
          <Text as="span" variant="bodySm" tone="success">
            {succeeded} succeeded
          </Text>
          {failed > 0 && (
            <Text as="span" variant="bodySm" tone="critical">
              {failed} failed
            </Text>
          )}
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
