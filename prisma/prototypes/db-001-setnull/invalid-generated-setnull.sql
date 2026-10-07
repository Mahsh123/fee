-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "AcademicUnit" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "parentId" UUID,

    CONSTRAINT "AcademicUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcademicUnit_tenantId_id_key" ON "AcademicUnit"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "AcademicUnit" ADD CONSTRAINT "AcademicUnit_tenantId_parentId_fkey" FOREIGN KEY ("tenantId", "parentId") REFERENCES "AcademicUnit"("tenantId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
