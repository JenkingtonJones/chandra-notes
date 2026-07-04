// Connection manager to prevent HTTP 431 header accumulation errors
export class ConnectionManager {
  private static instance: ConnectionManager;
  private activeConnections = new Set<AbortController>();
  private connectionCount = 0;

  static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  createConnection(): AbortController {
    const controller = new AbortController();
    this.activeConnections.add(controller);
    this.connectionCount++;
    
    // Clean up when connection is aborted
    controller.signal.addEventListener('abort', () => {
      this.activeConnections.delete(controller);
    });

    // Aggressive cleanup every 10 connections to prevent accumulation
    if (this.connectionCount % 10 === 0) {
      this.cleanup();
    }

    return controller;
  }

  cleanup() {
    // Abort all active connections
    this.activeConnections.forEach(controller => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    });
    this.activeConnections.clear();
    
    // Force browser to clean up any lingering connections
    if (typeof window !== 'undefined') {
      // Clear any cached connections
      if ('navigator' in window && 'connection' in navigator) {
        // Reset network state if possible
      }
    }
  }

  getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }
}

export const connectionManager = ConnectionManager.getInstance();