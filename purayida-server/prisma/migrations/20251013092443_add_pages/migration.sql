-- CreateTable
CREATE TABLE "AboutPage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1
);

-- CreateTable
CREATE TABLE "AboutPageTranslation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "locale" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "points" TEXT,
    "aboutId" INTEGER NOT NULL,
    CONSTRAINT "AboutPageTranslation_aboutId_fkey" FOREIGN KEY ("aboutId") REFERENCES "AboutPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContactPage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "email" TEXT
);

-- CreateTable
CREATE TABLE "ContactPageTranslation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "locale" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "sub" TEXT,
    "contactId" INTEGER NOT NULL,
    CONSTRAINT "ContactPageTranslation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ContactPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AboutPageTranslation_aboutId_locale_key" ON "AboutPageTranslation"("aboutId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ContactPageTranslation_contactId_locale_key" ON "ContactPageTranslation"("contactId", "locale");
