import { pgTable, serial, timestamp, varchar, text, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-zod";

// System table - do not delete
export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// Feishu API configuration
export const feishuConfig = pgTable(
  "feishu_config",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    app_id: varchar("app_id", { length: 255 }).notNull(),
    app_secret: varchar("app_secret", { length: 255 }).notNull(),
    app_token: varchar("app_token", { length: 255 }).notNull(),
    table_id: varchar("table_id", { length: 255 }).notNull(),
    field_name: varchar("field_name", { length: 255 }).notNull().default("订单编号"),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("feishu_config_updated_at_idx").on(table.updated_at),
  ]
);

// Scan records tracking
export const scanRecords = pgTable(
  "scan_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    barcode: varchar("barcode", { length: 500 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    error_message: text("error_message"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("scan_records_status_idx").on(table.status),
    index("scan_records_created_at_idx").on(table.created_at),
  ]
);

const { createInsertSchema } = createSchemaFactory({ coerce: { date: true } });
export const insertFeishuConfigSchema = createInsertSchema(feishuConfig).pick({
  app_id: true,
  app_secret: true,
  app_token: true,
  table_id: true,
  field_name: true,
});

export const insertScanRecordSchema = createInsertSchema(scanRecords).pick({
  barcode: true,
  status: true,
  error_message: true,
});

export type FeishuConfig = typeof feishuConfig.$inferSelect;
export type InsertFeishuConfig = typeof feishuConfig.$inferInsert;
export type ScanRecord = typeof scanRecords.$inferSelect;
export type InsertScanRecord = typeof scanRecords.$inferInsert;
