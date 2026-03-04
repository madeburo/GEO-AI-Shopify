import { BlockStack, Card, Icon, InlineStack, Text } from "@shopify/polaris";
import { CheckCircleIcon, MinusCircleIcon } from "@shopify/polaris-icons";

export interface OnboardingStatus {
  setupWizardCompleted: boolean;
  llmsGenerated: boolean;
  robotsCopied: boolean;
}

export interface OnboardingChecklistProps {
  status: OnboardingStatus;
}

/**
 * Determine whether the onboarding checklist should be visible.
 * Visible when at least one step is incomplete; hidden when all are done.
 *
 * Extracted as a pure function for property-based testing.
 */
export function isChecklistVisible(status: OnboardingStatus): boolean {
  return !(
    status.setupWizardCompleted &&
    status.llmsGenerated &&
    status.robotsCopied
  );
}

interface CheckItemProps {
  label: string;
  done: boolean;
}

function CheckItem({ label, done }: CheckItemProps) {
  return (
    <InlineStack gap="200" blockAlign="center">
      <Icon
        source={done ? CheckCircleIcon : MinusCircleIcon}
        tone={done ? "success" : "subdued"}
      />
      <Text
        as="span"
        variant="bodyMd"
        tone={done ? "success" : undefined}
      >
        {label}
      </Text>
    </InlineStack>
  );
}

/**
 * Onboarding checklist displayed on the dashboard until all steps are complete.
 * Tracks three items: settings saved, files generated, robots.txt copied.
 * Returns null when all steps are done (checklist hidden).
 */
export function OnboardingChecklist({ status }: OnboardingChecklistProps) {
  if (!isChecklistVisible(status)) {
    return null;
  }

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Getting Started
        </Text>
        <Text as="p" tone="subdued">
          Complete these steps to finish setting up GEO AI for your store.
        </Text>
        <BlockStack gap="200">
          <CheckItem label="Settings saved" done={status.setupWizardCompleted} />
          <CheckItem label="llms.txt files generated" done={status.llmsGenerated} />
          <CheckItem label="robots.txt rules copied" done={status.robotsCopied} />
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
