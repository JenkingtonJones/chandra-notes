import { useState, useEffect } from 'react';

interface StreamingFallbackOptions {
  url: string;
  method?: 'GET' | 'POST';
  body?: any;
  onMessage: (data: any) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
}

export function useStreamingFallback() {
  const [isSSESupported, setIsSSESupported] = useState(true);

  const detectDesktopBrowser = () => {
    const userAgent = navigator.userAgent;
    const isDesktopChrome = userAgent.includes('Chrome') && !userAgent.includes('Mobile');
    const isDesktopEdge = userAgent.includes('Edge') && !userAgent.includes('Mobile');
    const isDesktopFirefox = userAgent.includes('Firefox') && !userAgent.includes('Mobile');
    return isDesktopChrome || isDesktopEdge || isDesktopFirefox;
  };

  const startStreaming = ({ url, method = 'GET', body, onMessage, onError, onComplete }: StreamingFallbackOptions) => {
    // Use polling fallback immediately for desktop browsers to avoid SSE issues
    if (detectDesktopBrowser()) {
      console.log('Desktop browser detected, using polling fallback to avoid connection issues');
      return startPollingFallback(url, method, body, onMessage, onError, onComplete);
    }

    // Try Server-Sent Events for mobile browsers
    if (typeof EventSource !== 'undefined') {
      let eventSource: EventSource | null = null;
      let hasReceivedData = false;
      let isCleanedUp = false;
      
      try {
        eventSource = new EventSource(url);
        
        // Set a timeout to detect SSE connection issues
        const sseTimeout = setTimeout(() => {
          if (!hasReceivedData && !isCleanedUp) {
            console.warn('SSE timeout, switching to polling fallback');
            cleanup();
            startPollingFallback(url, onMessage, onError, onComplete);
          }
        }, 3000);
        
        const cleanup = () => {
          if (!isCleanedUp) {
            isCleanedUp = true;
            clearTimeout(sseTimeout);
            if (eventSource) {
              eventSource.close();
              eventSource = null;
            }
          }
        };
        
        eventSource.onmessage = (event) => {
          hasReceivedData = true;
          clearTimeout(sseTimeout);
          
          if (event.data === '[DONE]') {
            cleanup();
            onComplete();
            return;
          }
          
          try {
            const data = JSON.parse(event.data);
            onMessage(data);
          } catch (error) {
            console.warn('Failed to parse SSE data:', error);
          }
        };

        eventSource.onerror = (error) => {
          console.warn('SSE connection failed, falling back to polling');
          cleanup();
          setIsSSESupported(false);
          startPollingFallback(url, onMessage, onError, onComplete);
        };

        // Return cleanup function
        return cleanup;
      } catch (error) {
        console.warn('EventSource creation failed, using polling fallback');
        return startPollingFallback(url, onMessage, onError, onComplete);
      }
    } else {
      // Use polling fallback for browsers without EventSource
      return startPollingFallback(url, onMessage, onError, onComplete);
    }
  };

  const startPollingFallback = (url: string, method: string = 'GET', body: any = null, onMessage: (data: any) => void, onError: (error: Error) => void, onComplete: () => void) => {
    let isActive = true;
    let accumulatedResponse = '';
    let lastLength = 0;
    let pollInterval: NodeJS.Timeout | null = null;
    let controller: AbortController | null = null;
    
    const createStreamingRequest = async () => {
      try {
        console.log('Starting enhanced polling fallback for streaming:', url);
        
        // Create a fresh AbortController to prevent connection reuse
        controller = new AbortController();
        
        // Add unique timestamp to force new connection
        const separator = url.includes('?') ? '&' : '?';
        const streamUrl = `${url}${separator}_stream=${Date.now()}&_mode=poll`;
        
        const response = await fetch(streamUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 431) {
            throw new Error('Request headers too large - connection will be reset');
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('No response body reader available');
        }

        console.log('Polling fallback: Reader established');
        let buffer = '';

        while (isActive && !controller?.signal.aborted) {
          try {
            const { done, value } = await reader.read();
            
            if (done) {
              console.log('Polling fallback: Stream complete');
              onComplete();
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            
            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
              if (line.trim() === '') continue; // Skip empty lines
              
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                  console.log('Polling fallback: Received [DONE]');
                  onComplete();
                  isActive = false;
                  break;
                }
                
                if (data === '') continue; // Skip empty data
                
                try {
                  const parsed = JSON.parse(data);
                  onMessage(parsed);
                } catch (error) {
                  console.warn('Failed to parse streaming data:', data, error);
                }
              }
            }
          } catch (readError) {
            if (!controller?.signal.aborted) {
              console.error('Error reading stream chunk:', readError);
              break;
            }
          }
        }
        
        // Clean up reader
        try {
          await reader.cancel();
        } catch (e) {
          // Ignore cleanup errors
        }
        
      } catch (error) {
        if (!controller?.signal.aborted) {
          console.error('Polling fallback error:', error);
          onError(error as Error);
        }
      }
    };

    startPollingFallback(url, onMessage, onError, onComplete);

    // Cleanup function
    return () => {
      isActive = false;
      if (controller) {
        controller.abort();
        controller = null;
      }
    };
  };

  return { startStreaming, isSSESupported };
}