-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "agroecologyBackgroundUrl" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "heroBackgroundUrl" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GalleryImage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "youtubeUrl" TEXT,
    "type" TEXT NOT NULL DEFAULT 'image',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GalleryImage" ("createdAt", "id", "imageUrl", "order", "updatedAt") SELECT "createdAt", "id", "imageUrl", "order", "updatedAt" FROM "GalleryImage";
DROP TABLE "GalleryImage";
ALTER TABLE "new_GalleryImage" RENAME TO "GalleryImage";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
