import { pgTable, text, serial, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Define table for storing LLM interactions
export const llmRequests = pgTable("llm_requests", {
  id: serial("id").primaryKey(),
  model: text("model").notNull(),
  prompt: text("prompt").notNull(),
  systemPrompt: text("system_prompt"),
  response: text("response").notNull(),
  parameters: jsonb("parameters"),
  timestamp: text("timestamp").notNull(),
  tokensUsed: integer("tokens_used"),
  processingTimeMs: integer("processing_time_ms"),
});

// Insert schema
export const insertLlmRequestSchema = createInsertSchema(llmRequests).omit({
  id: true
});

// Types
export type InsertLlmRequest = z.infer<typeof insertLlmRequestSchema>;
export type LlmRequest = typeof llmRequests.$inferSelect;

// User table for authentication if needed later
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Prompts table for storing and retrieving prompts
export const prompts = pgTable("prompts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").notNull(),
  tags: text("tags").array().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const insertPromptSchema = createInsertSchema(prompts).omit({
  id: true
}).extend({
  isActive: z.boolean().default(true)
});

export type InsertPrompt = z.infer<typeof insertPromptSchema>;
export type Prompt = typeof prompts.$inferSelect;

// Settings table for application configuration
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const insertSettingSchema = createInsertSchema(settings);

export type InsertSetting = z.infer<typeof insertSettingSchema>;
export type Setting = typeof settings.$inferSelect;
