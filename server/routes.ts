import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPromptSchema } from "@shared/schema";
import axios from "axios";
import OpenAI from "openai";
import multer from "multer";
import * as mupdf from "mupdf";
import {
  LONG_NOTE_CHARACTER_THRESHOLD,
  MAX_RUN_MINUTES,
  auditAndRepairNote,
  chunkText,
  cleanupStaleRuns,
  extractSectionFacts,
  selectModels,
  synthesizeNote,
  warmLargeModel,
  type PipelineSection,
  type SectionFacts,
} from "./pipeline";
import { randomUUID } from "crypto";

// Multer in-memory upload for document OCR (supports large files)
const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

// Default prompt sent to the DeepSeek OCR vision model for each page image.
// DeepSeek-OCR responds best to its canonical short prompts; verbose instructions
// can cause it to return empty output. "Free OCR." yields clean plain text.
const DEFAULT_OCR_PROMPT = "Free OCR.";

// Ollama API base URL - can be configured via environment variable or API call.
// Defaults to the standard local Ollama address; the real server is provided via
// the OLLAMA_API_URL env var (or the settings table) so it is not hardcoded here.
let OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://localhost:11434";

// Initialize Ollama URL from storage
async function initializeOllamaUrl() {
  const storedUrl = await storage.getSetting("ollama_server_url");
  if (storedUrl) {
    OLLAMA_API_URL = storedUrl;
    console.log(`Loaded Ollama URL from storage: ${OLLAMA_API_URL}`);
  } else {
    console.log(`Using default Ollama URL: ${OLLAMA_API_URL}`);
    // Save the default URL to storage
    await storage.setSetting("ollama_server_url", OLLAMA_API_URL);
  }
}

// Initialize OpenAI client
// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize Ollama URL from storage
  await initializeOllamaUrl();

  // Purge abandoned long-note pipeline run folders (older than 2 hours)
  cleanupStaleRuns().catch(() => {});
  
  // Check the Ollama API connection
  app.get("/api/ollama/ping", async (req, res) => {
    try {
      await axios.get(`${OLLAMA_API_URL}`);
      res.json({ status: "connected" });
    } catch (error) {
      let errorMessage = "Could not connect to Ollama server";
      if (error instanceof Error) {
        errorMessage += `: ${error.message}`;
      }

      res.status(500).json({ 
        status: "error", 
        message: errorMessage
      });
    }
  });

  // Get available models
  app.get("/api/ollama/models", async (req, res) => {
    try {
      const response = await axios.get(`${OLLAMA_API_URL}/api/tags`);
      console.log("Ollama models response:", JSON.stringify(response.data));

      // Ollama returns {models: [...]} but we need to ensure the format matches our frontend type
      if (response.data && Array.isArray(response.data.models)) {
        console.log("Sending models array from response");
        res.json(response.data);
      } else {
        // Transform the response if needed to match our frontend expectations
        console.log("Transforming models response");
        res.json({ models: response.data.models || [] });
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        res.status(error.response?.status || 500).json({
          status: "error",
          message: error.message
        });
      } else {
        res.status(500).json({
          status: "error",
          message: "Failed to fetch models"
        });
      }
    }
  });

  // Configure Ollama API URL
  app.post("/api/ollama/config", async (req, res) => {
    try {
      const { serverUrl } = req.body;

      if (!serverUrl) {
        return res.status(400).json({ 
          status: "error", 
          message: "Server URL is required" 
        });
      }

      // Update the global URL
      OLLAMA_API_URL = serverUrl;
      
      // Save to storage for persistence
      await storage.setSetting("ollama_server_url", serverUrl);
      
      console.log(`Ollama API URL updated and saved to storage: ${OLLAMA_API_URL}`);

      res.json({ 
        status: "success", 
        message: "Ollama server URL configured successfully" 
      });
    } catch (error) {
      console.error("Failed to configure Ollama server URL:", error);
      res.status(500).json({ 
        status: "error", 
        message: "Failed to configure Ollama server URL" 
      });
    }
  });

  // Generate completion (GET for streaming)
  app.get("/api/ollama/generate", async (req, res) => {
    try {
      const { model, prompt, system, temperature, top_p, stream } = req.query;

      if (!model) {
        return res.status(400).json({ status: "error", message: "Model is required" });
      }

      if (!prompt) {
        return res.status(400).json({ status: "error", message: "Prompt is required" });
      }

      console.log(`Sending GET streaming request to Ollama with model: ${model}`);

      const requestData = {
        model: model as string,
        prompt: prompt as string,
        system: system as string || undefined,
        stream: true,
        options: {
          temperature: temperature ? parseFloat(temperature as string) : 0.7,
          top_p: top_p ? parseFloat(top_p as string) : 0.9,
        }
      };

      // Set up Server-Sent Events headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      const response = await axios.post(`${OLLAMA_API_URL}/api/generate`, requestData, {
        responseType: 'stream'
      });

      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          } catch (e) {
            console.warn('Failed to parse streaming chunk:', line);
          }
        }
      });

      response.data.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });

      response.data.on('error', (error: any) => {
        console.error('Ollama streaming error:', error);
        res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
        res.end();
      });

    } catch (error) {
      console.error("Ollama generate error:", error);
      res.status(500).json({ 
        status: "error", 
        message: "Failed to generate completion" 
      });
    }
  });

  // Generate completion (POST)
  app.post("/api/ollama/generate", async (req, res) => {
    try {
      const { model, prompt, system, options } = req.body;

      if (!model) {
        return res.status(400).json({ status: "error", message: "Model is required" });
      }

      if (!prompt) {
        return res.status(400).json({ status: "error", message: "Prompt is required" });
      }

      console.log(`Sending POST streaming request to Ollama with model: ${model}`);

      const requestData = {
        model,
        prompt,
        system,
        stream: true,
        options
      };

      // Set up Server-Sent Events headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      const response = await axios.post(`${OLLAMA_API_URL}/api/generate`, requestData, {
        responseType: 'stream'
      });

      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          } catch (e) {
            console.warn('Failed to parse streaming chunk:', line);
          }
        }
      });

      response.data.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });

      response.data.on('error', (error: any) => {
        console.error('Ollama streaming error:', error);
        res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
        res.end();
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        res.status(error.response?.status || 500).json({
          status: "error",
          message: error.response?.data?.error || error.message
        });
      } else {
        res.status(500).json({
          status: "error",
          message: "Failed to generate completion"
        });
      }
    }
  });

  // Ollama streaming endpoint (GET for EventSource)
  app.get("/api/ollama/generate-stream", async (req, res) => {
    try {
      // Check for large headers early to prevent HTTP 431 errors
      const headerSize = JSON.stringify(req.headers).length;
      if (headerSize > 8192) { // 8KB header limit
        console.warn(`Large headers detected on Ollama request: ${headerSize} bytes`);
        return res.status(431).json({ error: "Request headers too large" });
      }

      const { model, prompt, system, temperature, top_p } = req.query;
      
      console.log("=== OLLAMA STREAMING DEBUG ===");
      console.log("Model:", model);
      console.log("Prompt length:", (prompt as string)?.length || 0);
      console.log("System prompt length:", (system as string)?.length || 0);
      console.log("Temperature:", temperature);
      console.log("Top_p:", top_p);
      console.log("Ollama URL:", OLLAMA_API_URL);
      
      const requestData = {
        model,
        prompt,
        system,
        stream: true,
        options: {
          temperature: parseFloat(temperature as string) || 0.7,
          top_p: parseFloat(top_p as string) || 0.9
        }
      };
      
      console.log("Request data:", JSON.stringify(requestData, null, 2));
      console.log("Starting EventSource streaming request to Ollama");
      
      const response = await axios.post(`${OLLAMA_API_URL}/api/generate`, requestData, {
        responseType: 'stream',
        timeout: 900000, // 15 minutes for large models
        maxRedirects: 0, // Prevent redirect loops
        validateStatus: (status) => status < 500 // Don't throw on 4xx errors
      });

      console.log("Ollama response status:", response.status);
      console.log("Ollama response headers:", response.headers);

      // Minimal headers to prevent HTTP 431 errors
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');

      console.log("Set response headers, starting stream processing...");

      let chunkCount = 0;
      response.data.on('data', (chunk: Buffer) => {
        chunkCount++;
        const chunkStr = chunk.toString();
        console.log(`Chunk ${chunkCount} received (${chunkStr.length} bytes):`, chunkStr.substring(0, 200));
        
        const lines = chunkStr.split('\n').filter(line => line.trim());
        console.log(`Processing ${lines.length} lines from chunk ${chunkCount}`);
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            console.log(`Parsed JSON from line:`, data);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
            console.log(`Sent data to client:`, JSON.stringify(data));
          } catch (e) {
            console.log(`Skipped invalid JSON line:`, line);
          }
        }
      });

      response.data.on('end', () => {
        console.log("Ollama stream ended, sending [DONE]");
        res.write('data: [DONE]\n\n');
        res.end();
      });

      response.data.on('error', (error: any) => {
        console.error('Ollama stream error:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      });

    } catch (error) {
      console.error("Error in streaming generate:", error);
      if (axios.isAxiosError(error)) {
        console.error("Axios error details:", {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message,
          code: error.code,
          url: error.config?.url,
          timeout: error.config?.timeout
        });
        
        // Specific handling for 524 timeout errors
        if (error.response?.status === 524) {
          return res.status(524).json({
            status: "error",
            message: "Ollama server timeout - the model may be overloaded or the request too complex. Try a smaller model or simpler prompt."
          });
        }
      }
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to stream response"
      });
    }
  });

  // Ollama streaming endpoint (POST for large inputs)
  app.post("/api/ollama/generate-stream", async (req, res) => {
    try {
      const { model, prompt, system, temperature, top_p } = req.body;
      
      console.log("Starting POST streaming request to Ollama for large input");
      
      const response = await axios.post(`${OLLAMA_API_URL}/api/generate`, {
        model,
        prompt,
        system,
        stream: true,
        options: {
          temperature: parseFloat(temperature) || 0.7,
          top_p: parseFloat(top_p) || 0.9
        }
      }, {
        responseType: 'stream',
        timeout: 900000, // 15 minutes for large models
        maxRedirects: 0, // Prevent redirect loops
        validateStatus: (status) => status < 500 // Don't throw on 4xx errors
      });

      // Minimal headers to prevent HTTP 431 errors
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');

      response.data.on('data', (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        const lines = chunkStr.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              res.write(`data: ${JSON.stringify({ response: parsed.response, done: parsed.done })}\n\n`);
            }
            if (parsed.done) {
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      });

      response.data.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });

      response.data.on('error', (error: any) => {
        console.error('Stream error:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      });

    } catch (error) {
      console.error("Error in POST streaming generate:", error);
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to stream response"
      });
    }
  });

  // Document OCR endpoint: upload a PDF/XPS/OXPS, render each page with MuPDF,
  // run a DeepSeek OCR vision model on every page, and stream the results back
  // as Server-Sent Events (progress updates + extracted text per page).
  // Wrap multer so upload errors (e.g. exceeding the file-size limit) are
  // returned as a structured SSE error instead of a generic middleware crash.
  const ocrUploadMiddleware = (req: any, res: any, next: any) => {
    ocrUpload.single("file")(req, res, (err: any) => {
      if (err) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Access-Control-Allow-Origin", "*");
        const isSize = err?.code === "LIMIT_FILE_SIZE";
        res.write(
          `data: ${JSON.stringify({
            error: isSize
              ? "File is too large. The maximum supported size is 200MB."
              : `Upload failed: ${err?.message || err}`,
          })}\n\n`
        );
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      next();
    });
  };

  app.post("/api/ollama/ocr", ocrUploadMiddleware, async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const sendEvent = (obj: any) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    // Detect a genuine client disconnect: res "close" fires when the connection
    // is torn down. If it fires before we've finished writing (writableEnded),
    // the client went away and we should stop processing. Using res (not req)
    // avoids a Node quirk where req "close" can fire once the request body has
    // been fully read, which would falsely abort multi-page documents.
    let cancelled = false;
    res.on("close", () => {
      if (!res.writableEnded) cancelled = true;
    });

    try {
      if (!req.file) {
        sendEvent({ error: "No file uploaded." });
        res.write("data: [DONE]\n\n");
        return res.end();
      }

      const model = (req.body.model || "").toString().trim();
      if (!model) {
        sendEvent({ error: "No OCR model specified. Please select a DeepSeek OCR model." });
        res.write("data: [DONE]\n\n");
        return res.end();
      }

      const ocrPrompt =
        (req.body.prompt && req.body.prompt.toString().trim()) || DEFAULT_OCR_PROMPT;

      console.log(
        `=== OCR REQUEST === file="${req.file.originalname}" (${req.file.size} bytes), model="${model}"`
      );

      sendEvent({ status: "loading", message: "Loading document..." });

      // Open the document with MuPDF. Pass the filename as the "magic" hint so
      // MuPDF can auto-detect PDF / XPS / OXPS. Fall back to the mimetype.
      let doc: any;
      try {
        doc = mupdf.Document.openDocument(req.file.buffer, req.file.originalname);
      } catch (openErr) {
        try {
          doc = mupdf.Document.openDocument(req.file.buffer, req.file.mimetype);
        } catch (openErr2) {
          sendEvent({
            error:
              "Could not open the document. Supported formats are PDF, XPS, and OXPS.",
          });
          res.write("data: [DONE]\n\n");
          return res.end();
        }
      }

      const totalPages = doc.countPages();
      sendEvent({
        status: "info",
        totalPages,
        message: `Document loaded — ${totalPages} page(s) found. Starting OCR...`,
      });

      let combined = "";
      let processedPages = 0;
      let hadError = false;

      for (let i = 0; i < totalPages; i++) {
        if (cancelled) break;
        const pageNum = i + 1;

        sendEvent({
          status: "progress",
          page: pageNum,
          totalPages,
          message: `Processing page ${pageNum} of ${totalPages}...`,
        });

        // Render the page to a PNG image (~144 DPI for legible OCR).
        let base64Image: string;
        try {
          const page = doc.loadPage(i);
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(2, 2),
            mupdf.ColorSpace.DeviceRGB,
            false
          );
          const png = pixmap.asPNG();
          base64Image = Buffer.from(png).toString("base64");
          (pixmap as any).destroy?.();
          (page as any).destroy?.();
        } catch (renderErr: any) {
          hadError = true;
          sendEvent({
            error: `Failed to render page ${pageNum}: ${renderErr?.message || renderErr}`,
          });
          break;
        }

        if (cancelled) break;

        // Send the page image to the OCR vision model via Ollama.
        try {
          const ollamaRes = await axios.post(
            `${OLLAMA_API_URL}/api/generate`,
            {
              model,
              prompt: ocrPrompt,
              images: [base64Image],
              stream: false,
            },
            {
              timeout: 900000, // 15 minutes per page for large models
              maxRedirects: 0,
              validateStatus: (status) => status < 500,
            }
          );

          if (ollamaRes.status >= 400) {
            const detail =
              ollamaRes.data?.error || JSON.stringify(ollamaRes.data);
            hadError = true;
            sendEvent({
              error: `Ollama returned an error on page ${pageNum} (${ollamaRes.status}): ${detail}. Make sure the OCR model is installed (e.g. "ollama pull ${model}").`,
            });
            break;
          }

          const pageText = (ollamaRes.data?.response || "").trim();
          const block = `\n\n## Page ${pageNum}\n\n${pageText}`;
          combined += block;
          processedPages += 1;
          sendEvent({ response: block, page: pageNum, totalPages });
        } catch (ollamaErr: any) {
          hadError = true;
          sendEvent({
            error: `Failed to OCR page ${pageNum}: ${ollamaErr?.message || ollamaErr}`,
          });
          break;
        }
      }

      if (cancelled) {
        sendEvent({
          status: "cancelled",
          message: `OCR cancelled — processed ${processedPages} of ${totalPages} page(s).`,
        });
      } else if (hadError) {
        sendEvent({
          status: "error",
          message: `OCR stopped after an error — processed ${processedPages} of ${totalPages} page(s).`,
        });
      } else {
        sendEvent({
          status: "done",
          message: `OCR complete — processed ${processedPages} page(s).`,
        });
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Error in OCR endpoint:", error);
      sendEvent({ error: error?.message || "OCR processing failed." });
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  // Single-page OCR endpoint. The browser renders each PDF page to a small PNG
  // and posts it here one page at a time. This keeps every request tiny so it
  // never hits the deployment platform's request-size limit (large whole-file
  // uploads return HTTP 413 at the edge proxy before reaching the server).
  const ocrPageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB is plenty for one page image
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/")) cb(null, true);
      else cb(new Error("Only image uploads are accepted for OCR pages."));
    },
  });

  const ocrPageMiddleware = (req: any, res: any, next: any) => {
    ocrPageUpload.single("image")(req, res, (err: any) => {
      if (err) {
        const isSize = err?.code === "LIMIT_FILE_SIZE";
        return res.status(413).json({
          error: isSize
            ? "Rendered page image is too large."
            : `Upload failed: ${err?.message || err}`,
        });
      }
      next();
    });
  };

  app.post("/api/ollama/ocr-page", ocrPageMiddleware, async (req, res) => {
    // Validate the request before we start streaming. These return normal JSON
    // error responses (non-200) that the client reads up front.
    if (!req.file) {
      return res.status(400).json({ error: "No page image uploaded." });
    }
    const model = (req.body.model || "").toString().trim();
    if (!model) {
      return res.status(400).json({ error: "No OCR model specified." });
    }
    const ocrPrompt =
      (req.body.prompt && req.body.prompt.toString().trim()) ||
      DEFAULT_OCR_PROMPT;
    const base64Image = req.file.buffer.toString("base64");

    // We stream the OCR result back as newline-delimited JSON (one Ollama chunk
    // per line). Streaming is essential: a single page can take a while, and if
    // the server stayed silent that long the deployment's edge proxy would kill
    // the request with an HTTP 524 gateway timeout. Sending bytes continuously
    // (real tokens plus periodic heartbeats) keeps the connection alive.
    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    (res as any).flushHeaders?.();
    res.write("\n"); // first byte right away so the proxy sees a live origin

    const canWrite = () => !res.writableEnded && !res.destroyed;

    // Heartbeat: a bare newline (which the client ignores) every 15s. This
    // matters while the model is processing the image before its first token.
    const heartbeat = setInterval(() => {
      if (canWrite()) res.write("\n");
    }, 15000);

    const finish = () => {
      clearInterval(heartbeat);
      if (canWrite()) res.end();
    };
    const sendError = (message: string) => {
      clearInterval(heartbeat);
      if (canWrite()) {
        res.write(JSON.stringify({ error: message }) + "\n");
        res.end();
      }
    };

    try {
      const ollamaRes = await axios.post(
        `${OLLAMA_API_URL}/api/generate`,
        {
          model,
          prompt: ocrPrompt,
          images: [base64Image],
          stream: true,
          // Vision OCR models can fall into repetition loops on dense pages.
          // These options discourage loops (repeat_penalty) and guarantee the
          // generation always terminates (num_predict hard cap) so a page can
          // never run away forever.
          options: {
            temperature: 0,
            num_predict: 8192,
            repeat_penalty: 1.2,
            repeat_last_n: 320,
          },
        },
        {
          timeout: 900000,
          maxRedirects: 0,
          responseType: "stream",
          validateStatus: () => true,
        }
      );

      if (ollamaRes.status >= 400) {
        // Error body arrives as a stream; collect it so we can report it.
        let body = "";
        for await (const chunk of ollamaRes.data) body += chunk.toString();
        let detail = body;
        try {
          detail = JSON.parse(body)?.error || body;
        } catch {
          // keep raw body
        }
        return sendError(
          `Ollama returned an error (${ollamaRes.status}): ${detail}. Make sure the OCR model is installed (e.g. "ollama pull ${model}").`
        );
      }

      // Forward only complete NDJSON lines so heartbeats never split a line.
      // We also watch for runaway repetition: an OCR model can loop, emitting the
      // same phrase (or an incrementing variant like "copy 217 / copy 218 ...")
      // thousands of times. When that happens we stop the page early instead of
      // streaming pages of garbage.
      let buf = "";
      let textTail = ""; // partial line of decoded OCR text awaiting a newline
      let lastNorm = "";
      let repeatCount = 0;
      let stoppedForRepeat = false;
      const REPEAT_LIMIT = 60;

      const sawRepetition = (responseText: string): boolean => {
        textTail += responseText;
        let nl: number;
        while ((nl = textTail.indexOf("\n")) !== -1) {
          const line = textTail.slice(0, nl);
          textTail = textTail.slice(nl + 1);
          // Normalize away digits/whitespace so incrementing variants collapse
          // to the same line. Ignore very short lines to avoid false positives.
          const norm = line.replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
          if (norm.length < 8) continue;
          if (norm === lastNorm) {
            if (++repeatCount >= REPEAT_LIMIT) return true;
          } else {
            lastNorm = norm;
            repeatCount = 1;
          }
        }
        return false;
      };

      const stopForRepeat = () => {
        stoppedForRepeat = true;
        if (canWrite()) {
          res.write(
            JSON.stringify({
              response:
                "\n\n[OCR stopped early: the model began repeating itself on this page.]",
            }) + "\n"
          );
        }
        ollamaRes.data.destroy?.();
        finish();
      };

      ollamaRes.data.on("data", (chunk: Buffer) => {
        if (stoppedForRepeat) return;
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          if (canWrite()) res.write(line + "\n");
          try {
            const obj = JSON.parse(line);
            if (typeof obj.response === "string" && sawRepetition(obj.response)) {
              stopForRepeat();
              return;
            }
          } catch {
            // not a JSON line we can inspect; it was already forwarded
          }
        }
      });
      ollamaRes.data.on("end", () => {
        if (stoppedForRepeat) return;
        if (buf.trim() && canWrite()) res.write(buf.trim() + "\n");
        finish();
      });
      ollamaRes.data.on("error", (err: any) => {
        console.error("OCR upstream stream error:", err);
        sendError(err?.message || "OCR stream failed.");
      });

      // If the client disconnects (e.g. user cancels), stop pulling from Ollama.
      res.on("close", () => {
        clearInterval(heartbeat);
        if (!res.writableEnded) ollamaRes.data.destroy?.();
      });
    } catch (error: any) {
      console.error("Error in single-page OCR endpoint:", error);
      sendError(error?.message || "OCR processing failed.");
    }
  });

  // ---- Long-note pipeline ---------------------------------------------------

  // Config for the client: routing threshold and which models the pipeline
  // will use (env override or auto-selected from the Ollama server).
  app.get("/api/ollama/pipeline-config", async (_req, res) => {
    try {
      const selection = await selectModels(OLLAMA_API_URL);
      res.json({
        threshold: LONG_NOTE_CHARACTER_THRESHOLD,
        maxRunMinutes: MAX_RUN_MINUTES,
        smallModel: selection.smallModel,
        largeModel: selection.largeModel,
        smallSource: selection.smallSource,
        largeSource: selection.largeSource,
      });
    } catch {
      // Model discovery may fail if the Ollama server is unreachable; the
      // threshold is still useful for client-side routing.
      res.json({
        threshold: LONG_NOTE_CHARACTER_THRESHOLD,
        maxRunMinutes: MAX_RUN_MINUTES,
      });
    }
  });

  // Run ONE pipeline step per request. The client orchestrates the steps and
  // carries the state between them, so no single request runs longer than one
  // model call — this stays under the deployment edge proxy's ~5-minute hard
  // cap on request duration (heartbeats alone do not prevent that cut-off).
  //
  // Steps:
  //   {step:"split", text}                  -> {result:{sections}}   (instant, no model)
  //   {step:"extract", section}             -> {result:{facts}}
  //   {step:"synthesize", sectionFacts}     -> {result:{note}}
  //   {step:"audit", note, sectionFacts}    -> {result:{note, repaired}}
  //
  // Model steps stream NDJSON (immediate first byte + 15s heartbeats, then
  // {result, done:true} or {error}). Never logs clinical text.
  app.post("/api/ollama/pipeline-step", async (req, res) => {
    const body = req.body ?? {};
    const step = body.step;

    // Deterministic split — no model call, answer immediately as plain JSON.
    if (step === "split") {
      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim()) {
        return res.status(400).json({ error: "No note text provided." });
      }
      return res.json({ result: { sections: chunkText(text) } });
    }

    // Validate model-step inputs before committing to a streaming response.
    let section: PipelineSection | null = null;
    let sectionFacts: SectionFacts[] | null = null;
    let note = "";
    const styleInstructions =
      typeof body.systemPrompt === "string" ? body.systemPrompt.slice(0, 20000) : "";
    if (step === "extract") {
      const s = body.section;
      if (typeof s?.source_text !== "string" || !s.source_text.trim()) {
        return res.status(400).json({ error: "No section text provided." });
      }
      section = {
        section_id: typeof s.section_id === "string" ? s.section_id : "section_001",
        title: typeof s.title === "string" ? s.title : "Section",
        source_text: s.source_text,
      };
    } else if (step === "synthesize" || step === "audit") {
      sectionFacts = Array.isArray(body.sectionFacts) ? body.sectionFacts : null;
      if (!sectionFacts || sectionFacts.length === 0) {
        return res.status(400).json({ error: "No extracted facts provided." });
      }
      if (step === "audit") {
        note = typeof body.note === "string" ? body.note.trim() : "";
        if (!note) {
          return res.status(400).json({ error: "No note provided to audit." });
        }
      }
    } else if (step !== "warm") {
      return res.status(400).json({ error: "Unknown pipeline step." });
    }

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    (res as any).flushHeaders?.();
    res.write("\n"); // first byte right away so the proxy sees a live origin

    const canWrite = () => !res.writableEnded && !res.destroyed;
    const heartbeat = setInterval(() => {
      if (canWrite()) res.write("\n");
    }, 15000);

    // Cancel the in-flight Ollama call if the client disconnects.
    const abort = new AbortController();
    res.on("close", () => {
      clearInterval(heartbeat);
      if (!res.writableEnded) abort.abort();
    });

    const runId = randomUUID().slice(0, 8);
    try {
      let result: any;
      if (step === "warm") {
        // Pre-load the large model so synthesize doesn't pay the model-load
        // time inside its own (proxy-capped) silent window. Never fatal.
        const warmed = await warmLargeModel({
          baseUrl: OLLAMA_API_URL, runId, signal: abort.signal,
        });
        result = { warmed };
      } else if (step === "extract" && section) {
        const facts = await extractSectionFacts({
          baseUrl: OLLAMA_API_URL, section, runId, signal: abort.signal,
        });
        result = { facts };
      } else if (step === "synthesize" && sectionFacts) {
        const synthesized = await synthesizeNote({
          baseUrl: OLLAMA_API_URL, sectionFacts, runId,
          styleInstructions, signal: abort.signal,
          // Forward the note being written to the client as it streams from
          // the model, so the user sees live text instead of a silent wait.
          // Thinking-model reasoning chunks are forwarded separately.
          onToken: (t, kind) => {
            if (!canWrite()) return;
            res.write(
              JSON.stringify(kind === "thinking" ? { thinking: t } : { token: t }) + "\n"
            );
          },
          onAttemptStart: () => {
            if (canWrite()) res.write(JSON.stringify({ reset: true }) + "\n");
          },
        });
        result = { note: synthesized };
      } else if (sectionFacts) {
        result = await auditAndRepairNote({
          baseUrl: OLLAMA_API_URL, note, sectionFacts, runId,
          styleInstructions, signal: abort.signal,
        });
      }
      if (canWrite()) res.write(JSON.stringify({ result, done: true }) + "\n");
    } catch (error: any) {
      // The pipeline logs metadata itself; do not log clinical text here.
      if (canWrite()) {
        const message =
          error?.errorClass === "cancelled"
            ? "Run cancelled."
            : error instanceof Error
              ? error.message
              : "The long-note pipeline step failed.";
        res.write(JSON.stringify({ error: message }) + "\n");
      }
    } finally {
      clearInterval(heartbeat);
      if (canWrite()) res.end();
    }
  });

  // OpenAI ChatGPT streaming endpoint
  app.get("/api/openai/generate-stream", async (req, res) => {
    try {
      // Check for large headers early
      const headerSize = JSON.stringify(req.headers).length;
      if (headerSize > 8192) { // 8KB header limit
        console.warn(`Large headers detected: ${headerSize} bytes`);
        return res.status(431).json({ error: "Request headers too large" });
      }

      const { prompt, system = "", model = "gpt-4o", temperature = 0.7, max_tokens = 2000 } = req.query;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log("Starting OpenAI streaming request with model:", model);

      // Minimal headers to prevent HTTP 431 errors
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');

      // o3 models use the responses endpoint, others use chat completions
      const o3Models = ['o3-pro', 'o3', 'o3-mini'];
      const o1Models = ['o1-pro', 'o1', 'o1-mini'];
      const isO3Model = o3Models.includes(model as string);
      const isO1Model = o1Models.includes(model as string);

      if (isO3Model) {
        // o3 models take much longer to respond, so we'll send a status message first
        res.write(`data: ${JSON.stringify({ response: "🧠 o3-pro is thinking deeply... This may take 30-60 seconds.", done: false })}\n\n`);
        
        const responseParams: any = {
          model: model as string,
          input: [{
            type: "message",
            role: "user",
            content: [{
              type: "input_text",
              text: `${system ? system + '\n\n' : ''}${prompt}`
            }]
          }],
          max_output_tokens: parseInt(max_tokens as string),
        };

        console.log("Sending o3-pro request");

        try {
          // Set a much longer timeout for o3 models
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes timeout

          const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(responseParams),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
          }

          const data = await response.json();
          
          // Extract content from o3 response
          const message = data.output?.find((item: any) => item.type === 'message');
          const content = message?.content?.[0]?.text || '';

          if (content) {
            // Clear the thinking message and send actual response
            res.write(`data: ${JSON.stringify({ response: "\n\n" + content, done: false })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ response: "\n\nError: No response content received from o3-pro", done: false })}\n\n`);
          }

          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } catch (error: any) {
          if (error.name === 'AbortError') {
            res.write(`data: ${JSON.stringify({ response: "\n\nTimeout: o3-pro response took too long (>2 minutes)", done: false })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ response: "\n\nError: " + (error.message || 'Unknown error'), done: false })}\n\n`);
          }
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      // Standard chat completions for other models
      const messages = [];
      if (system) {
        messages.push({ role: "system", content: system as string });
      }
      messages.push({ role: "user", content: prompt as string });

      const requestParams: any = {
        model: model as string,
        messages: messages,
        stream: true,
      };

      // o1 models use max_completion_tokens instead of max_tokens
      if (isO1Model) {
        requestParams.max_completion_tokens = parseInt(max_tokens as string);
      } else {
        requestParams.max_tokens = parseInt(max_tokens as string);
        requestParams.temperature = parseFloat(temperature as string);
      }

      const stream = await openai.chat.completions.create(requestParams);

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ response: content, done: false })}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();

    } catch (error) {
      console.error("Error in OpenAI streaming:", error);
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to stream OpenAI response"
      });
    }
  });

  // Prompt management API routes
  
  // Get all prompts
  app.get("/api/prompts", async (req, res) => {
    try {
      const prompts = await storage.getAllPrompts();
      res.json(prompts);
    } catch (error) {
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to fetch prompts"
      });
    }
  });

  // Get prompts by category
  app.get("/api/prompts/category/:category", async (req, res) => {
    try {
      const { category } = req.params;
      const prompts = await storage.getPromptsByCategory(category);
      res.json(prompts);
    } catch (error) {
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to fetch prompts by category"
      });
    }
  });

  // Get single prompt by ID
  app.get("/api/prompts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid prompt ID"
        });
      }

      const prompt = await storage.getPrompt(id);
      if (!prompt) {
        return res.status(404).json({
          status: "error",
          message: "Prompt not found"
        });
      }

      res.json(prompt);
    } catch (error) {
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to fetch prompt"
      });
    }
  });

  // Create new prompt
  app.post("/api/prompts", async (req, res) => {
    try {
      const validatedData = insertPromptSchema.parse(req.body);
      const prompt = await storage.createPrompt(validatedData);
      res.status(201).json(prompt);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        res.status(400).json({
          status: "error",
          message: "Invalid prompt data",
          details: error.message
        });
      } else {
        res.status(500).json({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to create prompt"
        });
      }
    }
  });

  // Update prompt
  app.put("/api/prompts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid prompt ID"
        });
      }

      const partialData = insertPromptSchema.partial().parse(req.body);
      const updatedPrompt = await storage.updatePrompt(id, partialData);
      
      if (!updatedPrompt) {
        return res.status(404).json({
          status: "error",
          message: "Prompt not found"
        });
      }

      res.json(updatedPrompt);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        res.status(400).json({
          status: "error",
          message: "Invalid prompt data",
          details: error.message
        });
      } else {
        res.status(500).json({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to update prompt"
        });
      }
    }
  });

  // Delete prompt
  app.delete("/api/prompts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid prompt ID"
        });
      }

      const deleted = await storage.deletePrompt(id);
      if (!deleted) {
        return res.status(404).json({
          status: "error",
          message: "Prompt not found"
        });
      }

      res.json({ message: "Prompt deleted successfully" });
    } catch (error) {
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to delete prompt"
      });
    }
  });

  // Test endpoint to fetch external prompt server documentation
  app.get("/api/external-prompt-server/docs", async (req, res) => {
    try {
      console.log("Fetching from https://promptserver.replit.app/api/help");
      const response = await axios.get("https://promptserver.replit.app/api/help", {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'curl/7.68.0'
        },
        timeout: 15000
      });
      
      console.log("=== EXTERNAL PROMPT SERVER RESPONSE ===");
      console.log("Status:", response.status);
      console.log("Headers:", response.headers);
      console.log("Data type:", typeof response.data);
      console.log("Data:", JSON.stringify(response.data, null, 2));
      console.log("=== END RESPONSE ===");
      
      res.json({
        success: true,
        status: response.status,
        headers: response.headers,
        data: response.data
      });
    } catch (error) {
      console.error("Error fetching external prompt server docs:", error);
      if (axios.isAxiosError(error)) {
        console.log("Response status:", error.response?.status);
        console.log("Response data:", error.response?.data);
        res.status(error.response?.status || 500).json({
          status: "error",
          message: error.response?.data || error.message,
          url: "https://promptserver.replit.app/api/help",
          statusCode: error.response?.status
        });
      } else {
        res.status(500).json({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to fetch external prompt server documentation"
        });
      }
    }
  });

  // Test different endpoints on the external prompt server
  app.get("/api/external-prompt-server/test", async (req, res) => {
    const endpoints = [
      "/api/help",
      "/api/docs", 
      "/api/prompts",
      "/api/",
      "/help",
      "/docs"
    ];

    const results = [];
    
    for (const endpoint of endpoints) {
      try {
        const url = `https://promptserver.replit.app${endpoint}`;
        const response = await axios.get(url, {
          headers: { 'Accept': 'application/json' },
          timeout: 5000
        });
        results.push({
          endpoint,
          status: response.status,
          contentType: response.headers['content-type'],
          data: typeof response.data === 'string' ? response.data.substring(0, 200) + '...' : response.data
        });
      } catch (error) {
        results.push({
          endpoint,
          error: axios.isAxiosError(error) ? error.response?.status || 'Network Error' : 'Unknown Error'
        });
      }
    }
    
    res.json({ results });
  });

  // External prompt server integration endpoints
  
  // Get all services from external prompt server
  app.get("/api/external-prompts/services", async (req, res) => {
    try {
      const response = await axios.get("https://promptserver.replit.app/api/services");
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching services from external prompt server:", error);
      res.status(500).json({
        status: "error",
        message: "Failed to fetch services from external prompt server"
      });
    }
  });

  // Get all prompts from external prompt server
  app.get("/api/external-prompts", async (req, res) => {
    try {
      const { service, status } = req.query;
      const params = new URLSearchParams();
      if (service) params.append('service', service as string);
      if (status) params.append('status', status as string);
      
      const url = `https://promptserver.replit.app/api/prompts${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await axios.get(url);
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching prompts from external prompt server:", error);
      res.status(500).json({
        status: "error",
        message: "Failed to fetch prompts from external prompt server"
      });
    }
  });

  // Get prompts by service from external prompt server
  app.get("/api/external-prompts/service/:service", async (req, res) => {
    try {
      const { service } = req.params;
      const encodedService = encodeURIComponent(service);
      const response = await axios.get(`https://promptserver.replit.app/api/services/${encodedService}/prompts`);
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching prompts by service from external prompt server:", error);
      res.status(500).json({
        status: "error",
        message: "Failed to fetch prompts by service from external prompt server"
      });
    }
  });

  // Get specific prompt by ID from external prompt server
  app.get("/api/external-prompts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const response = await axios.get(`https://promptserver.replit.app/api/prompts/${id}`);
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching prompt by ID from external prompt server:", error);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        res.status(404).json({
          status: "error",
          message: "Prompt not found"
        });
      } else {
        res.status(500).json({
          status: "error",
          message: "Failed to fetch prompt from external prompt server"
        });
      }
    }
  });

  // Get specific prompt by name from external prompt server
  app.get("/api/external-prompts/by-name/:name", async (req, res) => {
    try {
      const { name } = req.params;
      const encodedName = encodeURIComponent(name);
      const response = await axios.get(`https://promptserver.replit.app/api/prompts/by-name/${encodedName}`);
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching prompt by name from external prompt server:", error);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        res.status(404).json({
          status: "error",
          message: "Prompt not found"
        });
      } else {
        res.status(500).json({
          status: "error",
          message: "Failed to fetch prompt by name from external prompt server"
        });
      }
    }
  });

  // Prepare prompt with user input from external prompt server
  app.post("/api/external-prompts/:id/prepare", async (req, res) => {
    try {
      const { id } = req.params;
      const { userInput } = req.body;
      
      const response = await axios.post(`https://promptserver.replit.app/api/prompts/${id}/prepare`, {
        userInput
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      res.json(response.data);
    } catch (error) {
      console.error("Error preparing prompt from external prompt server:", error);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        res.status(404).json({
          status: "error",
          message: "Prompt not found"
        });
      } else {
        res.status(500).json({
          status: "error",
          message: "Failed to prepare prompt from external prompt server"
        });
      }
    }
  });

  // Prepare prompt by name with user input from external prompt server
  app.post("/api/external-prompts/by-name/:name/prepare", async (req, res) => {
    try {
      const { name } = req.params;
      const { userInput } = req.body;
      const encodedName = encodeURIComponent(name);
      
      const response = await axios.post(`https://promptserver.replit.app/api/prompts/by-name/${encodedName}/prepare`, {
        userInput
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      res.json(response.data);
    } catch (error) {
      console.error("Error preparing prompt by name from external prompt server:", error);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        res.status(404).json({
          status: "error",
          message: "Prompt not found"
        });
      } else {
        res.status(500).json({
          status: "error",
          message: "Failed to prepare prompt by name from external prompt server"
        });
      }
    }
  });

  // Get external prompt server statistics
  app.get("/api/external-prompts/stats", async (req, res) => {
    try {
      const response = await axios.get("https://promptserver.replit.app/api/stats");
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching stats from external prompt server:", error);
      res.status(500).json({
        status: "error",
        message: "Failed to fetch stats from external prompt server"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}