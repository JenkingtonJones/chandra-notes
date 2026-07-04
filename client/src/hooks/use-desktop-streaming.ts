// Enhanced streaming solution specifically for desktop browsers
// Addresses HTTP 431 header accumulation issues in Chrome/Edge

interface DesktopStreamingOptions {
  url: string;
  onMessage: (data: any) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
}

export function useDesktopStreaming() {
  const startDesktopStream = ({ url, onMessage, onError, onComplete }: DesktopStreamingOptions) => {
    let isActive = true;
    let fetchController: AbortController | null = null;
    let streamingInterval: NodeJS.Timeout | null = null;
    let lastResponseLength = 0;
    let accumulatedData = '';

    const createCleanRequest = async () => {
      try {
        // Create fresh request with minimal headers to avoid HTTP 431
        fetchController = new AbortController();
        
        // Add timestamp and browser type to URL to force fresh connection
        const userAgent = navigator.userAgent;
        const browserInfo = userAgent.includes('Chrome') ? 'chrome' : userAgent.includes('Edge') ? 'edge' : 'other';
        const separator = url.includes('?') ? '&' : '?';
        const cleanUrl = `${url}${separator}_ts=${Date.now()}&_browser=${browserInfo}&_stream=true`;
        
        console.log('Desktop streaming: Starting clean request for', browserInfo);
        
        const response = await fetch(cleanUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
          signal: fetchController.signal,
        });

        if (!response.ok) {
          if (response.status === 431) {
            console.warn('Desktop streaming: HTTP 431 detected, retrying with fresh connection');
            // Wait a moment and retry with completely fresh connection
            setTimeout(() => {
              if (isActive) {
                createCleanRequest();
              }
            }, 100);
            return;
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        // Process stream with reader
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const processStream = async () => {
          try {
            while (isActive) {
              const { done, value } = await reader.read();
              
              if (done) {
                console.log('Desktop streaming: Stream completed');
                onComplete();
                break;
              }

              const chunk = decoder.decode(value, { stream: true });
              accumulatedData += chunk;

              // Process any new complete messages
              const newDataLength = accumulatedData.length;
              if (newDataLength > lastResponseLength) {
                const newContent = accumulatedData.slice(lastResponseLength);
                lastResponseLength = newDataLength;
                
                // Parse SSE format
                const lines = newContent.split('\n');
                for (const line of lines) {
                  if (line.trim() === '') continue;
                  
                  if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6);
                    if (dataStr === '[DONE]') {
                      console.log('Desktop streaming: Received completion signal');
                      onComplete();
                      return;
                    }
                    
                    try {
                      const data = JSON.parse(dataStr);
                      onMessage(data);
                    } catch (e) {
                      console.warn('Desktop streaming: Failed to parse data:', dataStr.substring(0, 100));
                    }
                  }
                }
              }
              
              // Yield control briefly to prevent UI blocking
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          } catch (streamError) {
            if (!isActive) return;
            
            if (streamError instanceof Error && streamError.name === 'AbortError') {
              console.log('Desktop streaming: Stream aborted');
              return;
            }
            
            console.error('Desktop streaming error:', streamError);
            onError(streamError instanceof Error ? streamError : new Error('Stream processing failed'));
          }
        };

        // Start processing the stream
        processStream();

      } catch (requestError) {
        if (!isActive) return;
        
        if (requestError instanceof Error && requestError.name === 'AbortError') {
          console.log('Desktop streaming: Request aborted');
          return;
        }
        
        console.error('Desktop streaming request error:', requestError);
        onError(requestError instanceof Error ? requestError : new Error('Request failed'));
      }
    };

    // Start the streaming request
    createCleanRequest();

    // Return cleanup function
    return () => {
      isActive = false;
      
      if (fetchController) {
        fetchController.abort();
      }
      
      if (streamingInterval) {
        clearInterval(streamingInterval);
      }
      
      // Clear accumulated data to free memory
      accumulatedData = '';
      lastResponseLength = 0;
    };
  };

  return { startDesktopStream };
}