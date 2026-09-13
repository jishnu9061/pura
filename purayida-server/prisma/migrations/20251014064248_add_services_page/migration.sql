-- CreateTable
CREATE TABLE "ServicesPage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1
);

-- CreateTable
CREATE TABLE "ServicesPageTranslation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "locale" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "sub" TEXT,
    "servicesPageId" INTEGER NOT NULL,
    CONSTRAINT "ServicesPageTranslation_servicesPageId_fkey" FOREIGN KEY ("servicesPageId") REFERENCES "ServicesPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ServicesPageTranslation_servicesPageId_locale_key" ON "ServicesPageTranslation"("servicesPageId", "locale");
