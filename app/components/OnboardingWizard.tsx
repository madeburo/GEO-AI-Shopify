import { useCallback, useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { AI_BOTS } from "~/utils/bots";

/** Wizard step index (0-based) */
type WizardStep = 0 | 1 | 2 | 3;

const STEP_TITLES = [
  "Store Description",
  "AI Provider",
  "Crawler Rules",
  "Generate llms.txt",
] as const;

export interface WizardSettings {
  siteDescription: string;
  aiProvider: "none" | "claude" | "openai";
  aiApiKey: string;
  botRules: Record<string, "allow" | "disallow">;
}

export interface OnboardingWizardProps {
  onComplete: (settings: WizardSettings) => void;
  onSkip: () => void;
  saving?: boolean;
}

function getDefaultBotRules(): Record<string, "allow" | "disallow"> {
  const rules: Record<string, "allow" | "disallow"> = {};
  for (const bot of Object.keys(AI_BOTS)) {
    rules[bot] = "allow";
  }
  return rules;
}

/**
 * Setup wizard shown on first launch. Four steps:
 * 1. Store description
 * 2. AI provider + API key
 * 3. Crawler rules
 * 4. First llms.txt generation (triggers on complete)
 */
export function OnboardingWizard({
  onComplete,
  onSkip,
  saving = false,
}: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>(0);
  const [siteDescription, setSiteDescription] = useState("");
  const [aiProvider, setAiProvider] = useState<"none" | "claude" | "openai">("none");
  const [aiApiKey, setAiApiKey] = useState("");
  const [botRules, setBotRules] = useState<Record<string, "allow" | "disallow">>(
    getDefaultBotRules,
  );

  const handleBotToggle = useCallback(
    (bot: string) => {
      setBotRules((prev) => ({
        ...prev,
        [bot]: prev[bot] === "allow" ? "disallow" : "allow",
      }));
    },
    [],
  );

  const handleNext = useCallback(() => {
    if (step < 3) {
      setStep((s) => (s + 1) as WizardStep);
    }
  }, [step]);

  const handleBack = useCallback(() => {
    if (step > 0) {
      setStep((s) => (s - 1) as WizardStep);
    }
  }, [step]);

  const handleFinish = useCallback(() => {
    onComplete({ siteDescription, aiProvider, aiApiKey, botRules });
  }, [siteDescription, aiProvider, aiApiKey, botRules, onComplete]);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingLg">
            Setup Wizard
          </Text>
          <Button variant="plain" onClick={onSkip}>
            Skip setup
          </Button>
        </InlineStack>

        <Text as="p" tone="subdued">
          Step {step + 1} of {STEP_TITLES.length}: {STEP_TITLES[step]}
        </Text>

        {step === 0 && (
          <BlockStack gap="300">
            <TextField
              label="Store description"
              value={siteDescription}
              onChange={setSiteDescription}
              multiline={3}
              helpText="Describe your store for AI search engines. This appears in llms.txt."
              autoComplete="off"
            />
          </BlockStack>
        )}

        {step === 1 && (
          <BlockStack gap="300">
            <Select
              label="AI Provider"
              options={[
                { label: "None", value: "none" },
                { label: "Anthropic Claude", value: "claude" },
                { label: "OpenAI", value: "openai" },
              ]}
              value={aiProvider}
              onChange={(v) => setAiProvider(v as "none" | "claude" | "openai")}
            />
            {aiProvider !== "none" && (
              <TextField
                label="API Key"
                value={aiApiKey}
                onChange={setAiApiKey}
                type="password"
                helpText={`Enter your ${aiProvider === "claude" ? "Anthropic" : "OpenAI"} API key`}
                autoComplete="off"
              />
            )}
          </BlockStack>
        )}

        {step === 2 && (
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              Choose which AI crawlers can access your store content.
            </Text>
            {Object.entries(AI_BOTS).map(([bot, label]) => (
              <Checkbox
                key={bot}
                label={`${bot} — ${label}`}
                checked={botRules[bot] === "allow"}
                onChange={() => handleBotToggle(bot)}
              />
            ))}
          </BlockStack>
        )}

        {step === 3 && (
          <BlockStack gap="300">
            <Banner tone="info">
              <p>
                Clicking "Finish" will save your settings and automatically
                generate the first llms.txt and llms-full.txt files.
              </p>
            </Banner>
          </BlockStack>
        )}

        <InlineStack gap="200" align="end">
          {step > 0 && (
            <Button onClick={handleBack} disabled={saving}>
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button variant="primary" onClick={handleNext}>
              Next
            </Button>
          ) : (
            <Button variant="primary" onClick={handleFinish} loading={saving}>
              Finish &amp; Generate
            </Button>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
