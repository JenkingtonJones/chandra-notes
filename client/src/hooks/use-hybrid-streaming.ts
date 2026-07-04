import { useState } from 'react';

interface HybridStreamingOptions {
  url: string;
  method?: 'GET' | 'POST';
  body?: any;
  onMessage: (data: any) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
}

export function useHybridStreaming() {
  const [isStreaming, setIsStreaming] = useState(false);

  const startStream = async ({ url, method = 'GET', body, onMessage, onError, onComplete }: HybridStreamingOptions) => {
    setIsStreaming(true);
    let isActive = true;
    const controller = new AbortController();

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      };

      if (method === 'POST' && body) {
        fetchOptions.headers = {
          ...fetchOptions.headers,
          'Content-Type': 'application/json',
        };
        fetchOptions.body = JSON.stringify(body);
        console.log(`Using POST for large input`);
      } else {
        // Add timestamp to prevent caching for GET requests
        const separator = url.includes('?') ? '&' : '?';
        url = `${url}${separator}_t=${Date.now()}`;
        console.log(`Using GET for normal input`);
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body reader not available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (isActive && !controller.signal.aborted) {
        const { done, value } = await reader.read();
        
        if (done) {
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
              onComplete();
              isActive = false;
              break;
            }
            
            if (data === '') continue; // Skip empty data
            
            try {
              const parsed = JSON.parse(data);
              onMessage(parsed);
            } catch (e) {
              console.warn('Failed to parse streaming data:', data);
            }
          }
        }
      }
    } catch (error) {
      console.error('Streaming error:', error);
      onError(error as Error);
    } finally {
      setIsStreaming(false);
    }

    // Return cleanup function
    return () => {
      isActive = false;
      controller.abort();
    };
  };

  return {
    startStream,
    isStreaming
  };
}