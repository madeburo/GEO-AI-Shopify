import { useCallback, useState } from "react";
import {
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  TextField,
  Text,
} from "@shopify/polaris";
import { MAX_DESCRIPTION_LENGTH } from "~/utils/constants";

export interface AiMetadata {
  description: string;
  keywords: string;
  exclude: boolean;
}

export interface MetadataEditorProps {
  resourceTitle: string;
  initial: AiMetadata;
  onSave: (data: AiMetadata) => void;
  onGenerateAi?: () => void;
  saving?: boolean;
  aiAvailable?: boolean;
}

/**
 * Form for editing AI metadata on a product or page.
 * Fields: description (≤200 chars), keywords, exclude flag.
 */
export function MetadataEditor({
  resourceTitle,
  initial,
  onSave,
  onGenerateAi,
  saving = false,
  aiAvailable = false,
}: MetadataEditorProps) {
  const [description, setDescription] = useState(initial.description);
  const [keywords, setKeywords] = useState(initial.keywords);
  const [exclude, setExclude] = useState(initial.exclude);

  const descriptionError =
    description.length > MAX_DESCRIPTION_LENGTH
      ? `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`
      : undefined;

  const dirty =
    description !== initial.description ||
    keywords !== initial.keywords ||
    exclude !== initial.exclude;

  const handleSave = useCallback(() => {
    if (descriptionError) return;
    onSave({ description, keywords, exclude });
  }, [description, keywords, exclude, descriptionError, onSave]);

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          AI Metadata — {resourceTitle}
        </Text>

        <TextField
          label="AI Description"
          value={description}
          onChange={setDescription}
          maxLength={MAX_DESCRIPTION_LENGTH}
          showCharacterCount
          error={descriptionError}
          helpText={`Concise description for AI search engines (max ${MAX_DESCRIPTION_LENGTH} characters)`}
          autoComplete="off"
        />

        <TextField
          label="AI Keywords"
          value={keywords}
          onChange={setKeywords}
          helpText="Comma-separated keywords for AI indexing"
          autoComplete="off"
        />

        <Checkbox
          label="Exclude from llms.txt"
          checked={exclude}
          onChange={setExclude}
          helpText="When checked, this resource will not appear in generated llms.txt files"
        />

        <InlineStack gap="200">
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            disabled={!dirty || !!descriptionError}
          >
            Save
          </Button>
          {aiAvailable && onGenerateAi && (
            <Button onClick={onGenerateAi} disabled={saving}>
              Generate with AI
            </Button>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
