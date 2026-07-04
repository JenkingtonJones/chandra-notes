import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { createApiLoggingMiddleware, safeErrorMeta } from "./logging";

const app = express();
// Raised from the 100kb default so long note dumps (pipeline input) and other
// large text payloads are accepted. The deployment edge proxy caps bodies at
// ~32MB anyway, so 10mb keeps us safely under it.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

// Metadata-only API logging (method/path/status/duration). It never captures
// request or response bodies, so clinical/PHI content can't leak into the logs.
app.use(createApiLoggingMiddleware(log));

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    // Log the error instead of throwing it to prevent server crashes
    console.error('Server error:', safeErrorMeta(err));
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Serve on port 5000
  const port = 5000;
  
  const startServer = (portToTry: number) => {
    server.listen(portToTry, "0.0.0.0", () => {
      log(`serving on port ${portToTry}`);
    }).on('error', (err: any) => {
      if (err.code === 'EADDRINUSE' && portToTry === 5000) {
        log(`Port ${portToTry} is in use, trying port 5001`);
        // Try port 5001 if 5000 is in use
        startServer(5001);
      } else {
        console.error(`Failed to start server on port ${portToTry}: ${err.message}`);
        process.exit(1);
      }
    });
  };
  
  startServer(port);
})();
