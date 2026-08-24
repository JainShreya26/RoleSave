import { sql } from "drizzle-orm";
import { bigint, index, integer, numeric, pgEnum, pgSchema, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const auth = pgSchema("auth");
const authUsers = auth.table("users", { id: uuid("id").primaryKey() });

export const applicationStatus = pgEnum("application_status", ["SAVED", "APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", "NEEDS_REVIEW"]);
export const applicationSource = pgEnum("application_source", ["EXTENSION", "EMAIL", "MANUAL"]);
export const eventSource = pgEnum("event_source", ["EXTENSION", "EMAIL", "MANUAL", "SYSTEM"]);
export const captureStatus = pgEnum("capture_status", ["PENDING", "PROCESSING", "COMPLETE", "FAILED"]);
export const emailProvider = pgEnum("email_provider", ["FORWARDING", "GMAIL", "OUTLOOK"]);
export const emailJobStatus = pgEnum("email_job_status", ["PENDING", "PROCESSING", "COMPLETE", "FAILED"]);

export const applications = pgTable("applications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  company: text("company").notNull(),
  companyNormalized: text("company_normalized").notNull(),
  position: text("position").notNull(),
  positionNormalized: text("position_normalized").notNull(),
  status: applicationStatus("status").notNull(),
  source: applicationSource("source").notNull(),
  originalUrl: text("original_url"),
  originalDomain: text("original_domain"),
  jobId: text("job_id"),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("applications_user_status_idx").on(table.userId, table.status)]);

export const applicationEvents = pgTable("application_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  eventTime: timestamp("event_time", { withTimezone: true, mode: "string" }).notNull(),
  source: eventSource("source").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  evidence: text("evidence"),
  previousStatus: applicationStatus("previous_status"),
  newStatus: applicationStatus("new_status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("application_events_application_time_idx").on(table.applicationId, table.eventTime)]);

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull().default("JOB_DESCRIPTION"),
  storagePath: text("storage_path").notNull().unique(),
  temporaryStoragePath: text("temporary_storage_path"),
  originalUrl: text("original_url"),
  mimeType: text("mime_type").notNull().default("application/pdf"),
  fileSizeBytes: numeric("file_size_bytes", { mode: "number" }),
  checksumSha256: text("checksum_sha256"),
  captureStatus: captureStatus("capture_status").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("documents_application_idx").on(table.applicationId)]);

export const emailAccounts = pgTable("email_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  provider: emailProvider("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  emailAddress: text("email_address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("email_accounts_provider_address_idx").on(table.provider, table.emailAddress),
  uniqueIndex("email_accounts_user_provider_account_idx").on(table.userId, table.provider, table.providerAccountId),
  uniqueIndex("email_accounts_forwarding_user_idx").on(table.userId).where(sql`${table.provider} = 'FORWARDING'`),
]);

export const inboundEmailJobs = pgTable("inbound_email_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  emailAccountId: uuid("email_account_id").notNull().references(() => emailAccounts.id, { onDelete: "cascade" }),
  providerMessageId: text("provider_message_id").notNull(),
  storagePath: text("storage_path").notNull().unique(),
  status: emailJobStatus("status").notNull().default("PENDING"),
  attemptCount: integer("attempt_count").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true, mode: "string" }),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  lastError: text("last_error"),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("inbound_email_jobs_account_message_idx").on(table.emailAccountId, table.providerMessageId),
  index("inbound_email_jobs_ready_idx").on(table.status, table.availableAt, table.createdAt)
    .where(sql`${table.status} = 'PENDING' and ${table.availableAt} is not null`),
]);

export const emailEvents = pgTable("email_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  emailJobId: uuid("email_job_id").notNull().unique().references(() => inboundEmailJobs.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  emailAccountId: uuid("email_account_id").notNull().references(() => emailAccounts.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "set null" }),
  providerMessageId: text("provider_message_id").notNull(),
  messageId: text("message_id"),
  threadId: text("thread_id"),
  sender: text("sender"),
  senderName: text("sender_name"),
  senderDomain: text("sender_domain"),
  subject: text("subject").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull(),
  classification: text("classification").notNull(),
  extractedCompany: text("extracted_company"),
  extractedPosition: text("extracted_position"),
  extractedJobId: text("extracted_job_id"),
  meetingUrl: text("meeting_url"),
  classificationConfidence: numeric("classification_confidence", { precision: 4, scale: 3 }).notNull(),
  matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
  metadataScore: integer("metadata_score").notNull(),
  evidence: text("evidence").notNull(),
  reviewStatus: text("review_status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("email_events_account_message_idx").on(table.emailAccountId, table.providerMessageId),
  index("email_events_user_received_idx").on(table.userId, table.receivedAt),
  index("email_events_unmatched_idx").on(table.userId, table.classification, table.receivedAt)
    .where(sql`${table.applicationId} is null and ${table.classification} <> 'NOT_JOB_RELATED'`),
]);

export const reviewTasks = pgTable("review_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  emailEventId: uuid("email_event_id").notNull().unique().references(() => emailEvents.id, { onDelete: "cascade" }),
  suggestedApplicationIds: uuid("suggested_application_ids").array().notNull().default(sql`'{}'::uuid[]`),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("OPEN"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("review_tasks_user_open_idx").on(table.userId, table.createdAt)
    .where(sql`${table.status} = 'OPEN'`),
]);
