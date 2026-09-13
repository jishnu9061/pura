-- CreateTable
CREATE TABLE "GalleryGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Book" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "price" TEXT,
    "coverUrl" TEXT,
    "link" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isPreorder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Book" ("coverUrl", "createdAt", "id", "link", "order", "price", "updatedAt") SELECT "coverUrl", "createdAt", "id", "link", "order", "price", "updatedAt" FROM "Book";
DROP TABLE "Book";
ALTER TABLE "new_Book" RENAME TO "Book";
CREATE TABLE "new_GalleryImage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "youtubeUrl" TEXT,
    "type" TEXT NOT NULL DEFAULT 'image',
    "order" INTEGER NOT NULL DEFAULT 0,
    "groupId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GalleryImage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GalleryGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GalleryImage" ("createdAt", "id", "imageUrl", "order", "type", "updatedAt", "videoUrl", "youtubeUrl") SELECT "createdAt", "id", "imageUrl", "order", "type", "updatedAt", "videoUrl", "youtubeUrl" FROM "GalleryImage";
DROP TABLE "GalleryImage";
ALTER TABLE "new_GalleryImage" RENAME TO "GalleryImage";
CREATE TABLE "new_Post" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME,
    "imageUrl" TEXT,
    "isAd" BOOLEAN NOT NULL DEFAULT false,
    "adPlacement" TEXT NOT NULL DEFAULT 'all',
    "ctaUrl" TEXT,
    "categoryId" INTEGER,
    "reviewStatus" TEXT NOT NULL DEFAULT 'submitted',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Post" ("categoryId", "createdAt", "ctaUrl", "date", "id", "imageUrl", "isAd", "published", "reviewStatus", "updatedAt") SELECT "categoryId", "createdAt", "ctaUrl", "date", "id", "imageUrl", "isAd", "published", "reviewStatus", "updatedAt" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
