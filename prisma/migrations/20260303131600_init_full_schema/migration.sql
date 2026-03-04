-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "siteDescription" TEXT NOT NULL DEFAULT '',
    "includeProducts" BOOLEAN NOT NULL DEFAULT true,
    "includePages" BOOLEAN NOT NULL DEFAULT true,
    "includeCollections" BOOLEAN NOT NULL DEFAULT true,
    "includeBlogPosts" BOOLEAN NOT NULL DEFAULT false,
    "botRules" TEXT NOT NULL DEFAULT '{}',
    "seoMetaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "seoJsonldEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cacheDurationHours" INTEGER NOT NULL DEFAULT 24,
    "aiProvider" TEXT NOT NULL DEFAULT 'none',
    "aiApiKeyEncrypted" TEXT NOT NULL DEFAULT '',
    "aiModel" TEXT NOT NULL DEFAULT '',
    "aiMaxTokens" INTEGER NOT NULL DEFAULT 150,
    "aiPromptTemplate" TEXT NOT NULL DEFAULT '',
    "crawlTrackingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pendingRegeneration" DATETIME,
    "multilingualEnabled" BOOLEAN NOT NULL DEFAULT false,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "setupWizardCompleted" BOOLEAN NOT NULL DEFAULT false,
    "llmsGenerated" BOOLEAN NOT NULL DEFAULT false,
    "robotsCopied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ContentCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CrawlLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "botName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL DEFAULT 'standard',
    "ipHash" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "accessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BulkGenerationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "resourceIds" TEXT NOT NULL,
    "lastProcessedIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_shopId_key" ON "AppSettings"("shopId");

-- CreateIndex
CREATE INDEX "ContentCache_shopId_idx" ON "ContentCache"("shopId");

-- CreateIndex
CREATE INDEX "ContentCache_expiresAt_idx" ON "ContentCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentCache_shopId_cacheKey_key" ON "ContentCache"("shopId", "cacheKey");

-- CreateIndex
CREATE INDEX "CrawlLog_shopId_accessedAt_idx" ON "CrawlLog"("shopId", "accessedAt");

-- CreateIndex
CREATE INDEX "CrawlLog_shopId_botName_idx" ON "CrawlLog"("shopId", "botName");

-- CreateIndex
CREATE INDEX "BulkGenerationJob_shopId_status_idx" ON "BulkGenerationJob"("shopId", "status");
