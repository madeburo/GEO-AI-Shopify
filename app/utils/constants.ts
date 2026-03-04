/**
 * Default prompt template for AI description generation.
 * Placeholders: {title}, {content}, {type}, {price}, {category}
 */
export const DEFAULT_PROMPT = `Write a concise AI-optimized description (max 200 characters) for the following {type}.

Title: {title}
Content: {content}
Price: {price}
Category: {category}

The description should be informative, keyword-rich, and suitable for AI search engines. Focus on the key features and value proposition.`;

/** Maximum length for AI-generated descriptions (characters) */
export const MAX_DESCRIPTION_LENGTH = 200;

/** Supported cache duration options (hours) */
export const SUPPORTED_CACHE_DURATIONS = [1, 6, 12, 24, 48] as const;

/** Maximum AI API requests per minute */
export const AI_RATE_LIMIT = 10;

/** Number of items processed per batch in bulk generation */
export const BULK_BATCH_SIZE = 5;

/** Maximum number of items for bulk AI generation */
export const BULK_MAX_ITEMS = 50;

/** Number of days after which crawl log records are cleaned up */
export const CLEANUP_DAYS = 90;

/** Minimum seconds between regeneration requests per shop */
export const REGENERATE_COOLDOWN_SECONDS = 60;
