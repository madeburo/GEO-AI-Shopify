import { useCallback, useState } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Text,
} from "@shopify/polaris";
import { ClipboardIcon } from "@shopify/polaris-icons";

export interface RobotsBlockProps {
  content: string;
  onCopied?: () => void;
}

/**
 * Displays the generated robots.txt block with a "Copy to clipboard" button.
 * Includes instructions for the merchant on where to paste it.
 */
export function RobotsBlock({ content, onCopied }: RobotsBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content, onCopied]);

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          Recommended robots.txt Rules
        </Text>

        <Banner tone="info">
          <p>
            Copy the block below and paste it into your Shopify robots.txt
            settings: <strong>Settings → Custom data → robots.txt</strong>
          </p>
        </Banner>

        <Box
          background="bg-surface-secondary"
          padding="400"
          borderRadius="200"
        >
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
              fontFamily: "monospace",
              fontSize: "13px",
              lineHeight: "1.5",
            }}
          >
            {content}
          </pre>
        </Box>

        <Button icon={ClipboardIcon} onClick={handleCopy}>
          {copied ? "Copied!" : "Copy to clipboard"}
        </Button>
      </BlockStack>
    </Card>
  );
}
