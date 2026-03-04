import { Banner, Button, InlineStack, Text } from "@shopify/polaris";

export interface ErrorBannerProps {
  /** Error message to display */
  message: string;
  /** Optional error title (defaults to "Error") */
  title?: string;
  /** Callback for the "Retry" button. If omitted, no retry button is shown. */
  onRetry?: () => void;
  /** Whether the retry action is currently loading */
  retrying?: boolean;
  /** Optional dismiss handler */
  onDismiss?: () => void;
}

/**
 * Reusable error banner with a "Retry" button for Shopify API
 * and AI provider errors.
 *
 * Validates: Requirement 17.3 (Shopify API error with retry),
 *            Requirement 17.5 (AI provider error with recommendation)
 */
export function ErrorBanner({
  message,
  title = "Error",
  onRetry,
  retrying = false,
  onDismiss,
}: ErrorBannerProps) {
  return (
    <Banner
      tone="critical"
      title={title}
      onDismiss={onDismiss}
    >
      <Text as="p" variant="bodyMd">
        {message}
      </Text>
      {onRetry && (
        <InlineStack gap="200">
          <Button onClick={onRetry} loading={retrying} size="slim">
            Retry
          </Button>
        </InlineStack>
      )}
    </Banner>
  );
}

/**
 * Maps an AI provider error type to a user-friendly recommendation message.
 */
export function getAiErrorRecommendation(errorType: string): string {
  switch (errorType) {
    case "auth":
      return "Check your API key in Settings → AI Generation.";
    case "rate_limit":
      return "Wait a minute and try again, or reduce the number of concurrent requests.";
    case "service":
      return "The AI service is temporarily unavailable. Try again in a few minutes.";
    default:
      return "Check your AI provider settings or try again later.";
  }
}
