import { users, type User, type InsertUser, prompts, type Prompt, type InsertPrompt, settings, type Setting, type InsertSetting } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Prompt methods
  getAllPrompts(): Promise<Prompt[]>;
  getPrompt(id: number): Promise<Prompt | undefined>;
  getPromptsByCategory(category: string): Promise<Prompt[]>;
  createPrompt(prompt: InsertPrompt): Promise<Prompt>;
  updatePrompt(id: number, prompt: Partial<InsertPrompt>): Promise<Prompt | undefined>;
  deletePrompt(id: number): Promise<boolean>;
  
  // Settings methods
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private prompts: Map<number, Prompt>;
  private settings: Map<string, string>;
  private currentUserId: number;
  private currentPromptId: number;

  constructor() {
    this.users = new Map();
    this.prompts = new Map();
    this.settings = new Map();
    this.currentUserId = 1;
    this.currentPromptId = 1;
    
    // Add some sample prompts
    this.seedPrompts();
  }

  private seedPrompts() {
    const samplePrompts = [
      {
        title: "Code Review Assistant",
        content: "Please review the following code for best practices, potential bugs, and improvements. Focus on readability, performance, and maintainability.",
        category: "Development",
        tags: ["code-review", "programming", "best-practices"],
        isActive: true,
        createdAt: new Date().toISOString()
      },
      {
        title: "Technical Documentation Writer",
        content: "Create clear, comprehensive technical documentation for the following feature or API. Include examples, use cases, and troubleshooting information.",
        category: "Documentation",
        tags: ["documentation", "technical-writing", "api"],
        isActive: true,
        createdAt: new Date().toISOString()
      },
      {
        title: "Data Analysis Helper",
        content: "Analyze the following dataset and provide insights, patterns, and recommendations. Include statistical analysis and visualization suggestions.",
        category: "Data Science",
        tags: ["data-analysis", "statistics", "insights"],
        isActive: true,
        createdAt: new Date().toISOString()
      },
      {
        title: "Creative Writing Assistant",
        content: "Help brainstorm and develop creative content based on the following theme or requirements. Focus on originality and engaging storytelling.",
        category: "Creative",
        tags: ["creative-writing", "storytelling", "brainstorming"],
        isActive: true,
        createdAt: new Date().toISOString()
      }
    ];

    samplePrompts.forEach(prompt => {
      const id = this.currentPromptId++;
      this.prompts.set(id, { ...prompt, id });
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Prompt methods implementation
  async getAllPrompts(): Promise<Prompt[]> {
    return Array.from(this.prompts.values()).filter(prompt => prompt.isActive);
  }

  async getPrompt(id: number): Promise<Prompt | undefined> {
    return this.prompts.get(id);
  }

  async getPromptsByCategory(category: string): Promise<Prompt[]> {
    return Array.from(this.prompts.values()).filter(
      prompt => prompt.category === category && prompt.isActive
    );
  }

  async createPrompt(insertPrompt: InsertPrompt): Promise<Prompt> {
    const id = this.currentPromptId++;
    const prompt: Prompt = { 
      id,
      title: insertPrompt.title,
      content: insertPrompt.content,
      category: insertPrompt.category,
      tags: insertPrompt.tags,
      isActive: true,
      createdAt: insertPrompt.createdAt
    };
    this.prompts.set(id, prompt);
    return prompt;
  }

  async updatePrompt(id: number, updateData: Partial<InsertPrompt>): Promise<Prompt | undefined> {
    const existingPrompt = this.prompts.get(id);
    if (!existingPrompt) return undefined;
    
    const updatedPrompt: Prompt = { ...existingPrompt, ...updateData };
    this.prompts.set(id, updatedPrompt);
    return updatedPrompt;
  }

  async deletePrompt(id: number): Promise<boolean> {
    return this.prompts.delete(id);
  }

  // Settings methods implementation
  async getSetting(key: string): Promise<string | undefined> {
    return this.settings.get(key);
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }
}

// Database storage implementation
export class DbStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  async getAllPrompts(): Promise<Prompt[]> {
    return await db.select().from(prompts).where(eq(prompts.isActive, true));
  }

  async getPrompt(id: number): Promise<Prompt | undefined> {
    const result = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    return result[0];
  }

  async getPromptsByCategory(category: string): Promise<Prompt[]> {
    return await db.select().from(prompts)
      .where(eq(prompts.category, category));
  }

  async createPrompt(insertPrompt: InsertPrompt): Promise<Prompt> {
    const result = await db.insert(prompts).values(insertPrompt).returning();
    return result[0];
  }

  async updatePrompt(id: number, updateData: Partial<InsertPrompt>): Promise<Prompt | undefined> {
    const result = await db.update(prompts)
      .set(updateData)
      .where(eq(prompts.id, id))
      .returning();
    return result[0];
  }

  async deletePrompt(id: number): Promise<boolean> {
    const result = await db.delete(prompts).where(eq(prompts.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getSetting(key: string): Promise<string | undefined> {
    const result = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return result[0]?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    
    if (existing.length > 0) {
      await db.update(settings)
        .set({ value })
        .where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value });
    }
  }
}

export const storage = new DbStorage();
