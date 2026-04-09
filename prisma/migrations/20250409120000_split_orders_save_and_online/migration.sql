-- Разделение заказов: архив `orders_save` (бывш. `order`) и онлайн `orders_online`.

DO $migrate$
BEGIN
  IF to_regclass('public."order"') IS NOT NULL THEN
    ALTER TABLE "order" RENAME TO "orders_save";
  END IF;
END
$migrate$;

-- Пустая установка: создаём архивную таблицу (если не осталась после RENAME).
CREATE TABLE IF NOT EXISTS "orders_save" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "branch" TEXT NOT NULL,
    "order_type" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "kis_number" TEXT NOT NULL,
    "export_date" TIMESTAMP(3) NOT NULL,
    "shipment_date" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "packages_planned" DOUBLE PRECISION NOT NULL,
    "packages_actual" DOUBLE PRECISION NOT NULL,
    "lines_planned" INTEGER NOT NULL,
    "lines_actual" INTEGER NOT NULL,
    "counterparty" TEXT NOT NULL,
    "client_tin" TEXT NOT NULL,
    "acceptance_date" TIMESTAMP(3),
    CONSTRAINT "orders_save_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "orders_online" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "branch" TEXT NOT NULL,
    "order_type" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "kis_number" TEXT NOT NULL,
    "export_date" TIMESTAMP(3) NOT NULL,
    "shipment_date" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "packages_planned" DOUBLE PRECISION NOT NULL,
    "packages_actual" DOUBLE PRECISION NOT NULL,
    "lines_planned" INTEGER NOT NULL,
    "lines_actual" INTEGER NOT NULL,
    "counterparty" TEXT NOT NULL,
    "client_tin" TEXT NOT NULL,
    "acceptance_date" TIMESTAMP(3),
    CONSTRAINT "orders_online_pkey" PRIMARY KEY ("id")
);

-- FK на orders_save: только если ещё нет ни одного FK (после RENAME constraint уже есть).
DO $fksave$
DECLARE
  fk_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO fk_count
  FROM pg_constraint c
  JOIN pg_class r ON c.conrelid = r.oid
  WHERE r.relname = 'orders_save' AND c.contype = 'f';

  IF fk_count = 0 THEN
    ALTER TABLE "orders_save" ADD CONSTRAINT "orders_save_client_tin_fkey"
      FOREIGN KEY ("client_tin") REFERENCES "client"("TIN") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$fksave$;

DO $fkonline$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_online_client_tin_fkey'
  ) THEN
    ALTER TABLE "orders_online" ADD CONSTRAINT "orders_online_client_tin_fkey"
      FOREIGN KEY ("client_tin") REFERENCES "client"("TIN") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$fkonline$;

-- Индексы только для orders_online (у переименованной orders_save остаются старые имена индексов).
CREATE INDEX IF NOT EXISTS "orders_online_client_tin_idx" ON "orders_online"("client_tin");
CREATE INDEX IF NOT EXISTS "orders_online_created_at_idx" ON "orders_online"("created_at");
CREATE INDEX IF NOT EXISTS "orders_online_acceptance_date_idx" ON "orders_online"("acceptance_date");
CREATE INDEX IF NOT EXISTS "orders_online_export_date_idx" ON "orders_online"("export_date");
CREATE INDEX IF NOT EXISTS "orders_online_shipment_date_idx" ON "orders_online"("shipment_date");

-- Индексы для orders_save — только если таблица новая (нет индекса по client_tin).
DO $idxsave$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'orders_save' AND indexdef LIKE '%client_tin%'
  ) THEN
    CREATE INDEX "orders_save_client_tin_idx" ON "orders_save"("client_tin");
    CREATE INDEX "orders_save_created_at_idx" ON "orders_save"("created_at");
    CREATE INDEX "orders_save_acceptance_date_idx" ON "orders_save"("acceptance_date");
    CREATE INDEX "orders_save_export_date_idx" ON "orders_save"("export_date");
    CREATE INDEX "orders_save_shipment_date_idx" ON "orders_save"("shipment_date");
  END IF;
END
$idxsave$;
