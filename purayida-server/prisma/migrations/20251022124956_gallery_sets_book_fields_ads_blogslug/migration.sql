-- AlterTable
ALTER TABLE "GalleryGroup" ADD COLUMN "date" DATETIME;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "adBlogSlug" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Book" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "price" TEXT,
    "coverUrl" TEXT,
    "page1Url" TEXT,
    "page2Url" TEXT,
    "link" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isPreorder" BOOLEAN NOT NULL DEFAULT false,
    "quality" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INSTOCK',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Book" ("coverUrl", "createdAt", "id", "isPreorder", "link", "order", "price", "updatedAt") SELECT "coverUrl", "createdAt", "id", "isPreorder", "link", "order", "price", "updatedAt" FROM "Book";
DROP TABLE "Book";
ALTER TABLE "new_Book" RENAME TO "Book";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
