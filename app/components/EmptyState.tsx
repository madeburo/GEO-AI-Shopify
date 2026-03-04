import { Card, EmptyState as PolarisEmptyState } from "@shopify/polaris";

export interface EmptyStateProps {
  heading: string;
  message: string;
  actionLabel?: string;
  actionUrl?: string;
  onAction?: () => void;
  image?: string;
}

/**
 * Generic empty state component wrapping Polaris EmptyState.
 * Shows a message with an optional action button/link.
 */
export function EmptyState({
  heading,
  message,
  actionLabel,
  actionUrl,
  onAction,
  image,
}: EmptyStateProps) {
  const action =
    actionLabel && (actionUrl || onAction)
      ? {
          content: actionLabel,
          ...(actionUrl ? { url: actionUrl, external: true } : {}),
          ...(onAction ? { onAction } : {}),
        }
      : undefined;

  return (
    <Card>
      <PolarisEmptyState
        heading={heading}
        action={action}
        image={image ?? ""}
      >
        <p>{message}</p>
      </PolarisEmptyState>
    </Card>
  );
}
