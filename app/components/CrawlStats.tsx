import {
  BlockStack,
  Card,
  DataTable,
  Text,
} from "@shopify/polaris";

export interface BotActivityRow {
  botName: string;
  displayName: string;
  totalVisits: number;
  lastVisit: string; // ISO date string for serialization from loader
}

export interface CrawlStatsProps {
  totalVisits: number;
  bots: BotActivityRow[];
}

/**
 * Crawl statistics widget showing AI bot visit data for the last 30 days.
 * Displays total visits and a per-bot breakdown table.
 */
export function CrawlStats({ totalVisits, bots }: CrawlStatsProps) {
  if (bots.length === 0) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            AI Crawler Activity
          </Text>
          <Text as="p" tone="subdued">
            No AI bots have visited your store yet. It may take some time for
            crawlers to discover your llms.txt files.
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const rows = bots.map((b) => [
    b.displayName,
    String(b.totalVisits),
    new Date(b.lastVisit).toLocaleDateString(),
  ]);

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          AI Crawler Activity (30 days)
        </Text>
        <Text as="p" variant="bodyMd">
          Total visits: {totalVisits}
        </Text>
        <DataTable
          columnContentTypes={["text", "numeric", "text"]}
          headings={["Bot", "Visits", "Last Visit"]}
          rows={rows}
        />
      </BlockStack>
    </Card>
  );
}
