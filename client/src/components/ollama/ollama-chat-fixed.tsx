import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Copy, RefreshCw, Send, BrainCircuit, ChevronDown, Settings, ChevronUp, X } from "lucide-react";
import { SystemPrompt } from "./system-prompt";
import { ModelSelector } from "./model-selector";
import { useOllama } from "@/hooks/use-ollama";
import { useHybridStreaming } from "@/hooks/use-hybrid-streaming";
import { ServerConfig } from "./server-config";
import { Connector } from "./connector";
import { LLMProviderSelector } from "@/components/llm-provider-selector";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface OllamaResponse {
  response: string;
}

export function OllamaChat() {
  const { toast } = useToast();
  const ollama = useOllama();
  const { startStream } = useHybridStreaming();
  const [inputText, setInputText] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  
  // Real-time streaming state
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamedOutput, setStreamedOutput] = useState<string>("");
  const [thoughtProcess, setThoughtProcess] = useState<string>("");
  const [showThoughts, setShowThoughts] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [streamingError, setStreamingError] = useState<string>("");
  
  // Track cleanup function for proper connection management
  const [cleanupStream, setCleanupStream] = useState<(() => void) | null>(null);
  
  // LLM provider configuration
  const [llmConfig, setLlmConfig] = useState({
    provider: 'ollama' as 'ollama' | 'openai' | 'azure-openai',
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 2000,
    openaiModel: 'gpt-4o',
    azureEndpoint: '',
    azureApiKey: '',
    azureModel: 'gpt-4o',
  });

  const generateWithStream = async () => {
    // Validation based on provider
    if (llmConfig.provider === 'ollama' && !ollama.currentModel) {
      toast({
        title: "Model Required",
        description: "Please select an Ollama model first",
        variant: "destructive"
      });
      return;
    }

    if (llmConfig.provider === 'azure-openai' && (!llmConfig.azureEndpoint || !llmConfig.azureApiKey)) {
      toast({
        title: "Configuration Required",
        description: "Please configure Azure OpenAI endpoint and API key",
        variant: "destructive"
      });
      return;
    }

    // Clean up any existing stream first
    if (cleanupStream) {
      cleanupStream();
      setCleanupStream(null);
    }
    
    setIsStreaming(true);
    setStreamedOutput("");
    setOutput("");
    setThoughtProcess("");
    setShowThoughts(false);
    setStreamingError("");
    
    try {
      // Calculate input size to determine if we need POST (large inputs) or GET (normal inputs)
      const totalInputSize = (inputText + systemPrompt).length;
      const isLargeInput = totalInputSize > 4000; // 4KB threshold for switching to POST
      
      let streamUrl = '';
      let requestMethod: 'GET' | 'POST' = 'GET';
      let requestBody: any = null;
      
      // Build URL and request data based on provider and input size
      switch (llmConfig.provider) {
        case 'ollama':
          if (isLargeInput) {
            // Use POST for large inputs to avoid header size limits
            streamUrl = `/api/ollama/generate-stream`;
            requestMethod = 'POST';
            requestBody = {
              model: ollama.currentModel,
              prompt: inputText,
              system: systemPrompt,
              temperature: ollama.temperature,
              top_p: ollama.topP
            };
          } else {
            // Use GET for normal inputs (existing behavior)
            streamUrl = `/api/ollama/generate-stream?model=${encodeURIComponent(ollama.currentModel)}&prompt=${encodeURIComponent(inputText)}&system=${encodeURIComponent(systemPrompt)}&temperature=${ollama.temperature}&top_p=${ollama.topP}`;
          }
          break;
        case 'openai':
          streamUrl = `/api/openai/generate-stream?model=${encodeURIComponent(llmConfig.openaiModel || 'gpt-4o')}&prompt=${encodeURIComponent(inputText)}&system=${encodeURIComponent(systemPrompt)}&temperature=${llmConfig.temperature}&max_tokens=${llmConfig.maxTokens}`;
          break;
        case 'azure-openai':
          streamUrl = `/api/azure-openai/generate-stream?model=${encodeURIComponent(llmConfig.azureModel || 'gpt-4o')}&prompt=${encodeURIComponent(inputText)}&system=${encodeURIComponent(systemPrompt)}&temperature=${llmConfig.temperature}&max_tokens=${llmConfig.maxTokens}&endpoint=${encodeURIComponent(llmConfig.azureEndpoint)}&apiKey=${encodeURIComponent(llmConfig.azureApiKey)}`;
          break;
      }

      let fullResponse = "";
      let currentThought = "";
      let inThinkMode = false;
      const startTime = Date.now();
      
      // Use hybrid streaming that automatically handles GET/POST based on input size
      const cleanup = await startStream({
        url: streamUrl,
        method: requestMethod,
        body: requestBody,
        onMessage: (data: any) => {
          if (data.response) {
            fullResponse += data.response;
            
            // Real-time think tag processing
            if (data.response.includes('<think>')) {
              inThinkMode = true;
            }
            
            if (inThinkMode) {
              currentThought += data.response;
              if (data.response.includes('</think>')) {
                inThinkMode = false;
                const thinkMatch = currentThought.match(/<think>([\s\S]*?)<\/think>/);
                if (thinkMatch && thinkMatch[1]) {
                  setThoughtProcess(thinkMatch[1].trim());
                }
              }
            }
            
            // Update streamed output (excluding think tags for display)
            const displayText = fullResponse.replace(/<think>[\s\S]*?<\/think>/, '').trim();
            setStreamedOutput(displayText);
          }
        },
        onError: (error: Error) => {
          console.error("Streaming error:", error);
          setIsStreaming(false);
          setCleanupStream(null);
          
          toast({
            title: "Streaming Error", 
            description: `Connection to ${llmConfig.provider} streaming service failed`,
            variant: "destructive"
          });
        },
        onComplete: () => {
          // Final processing for think tags
          const thinkMatch = fullResponse.match(/<think>([\s\S]*?)<\/think>/);
          if (thinkMatch && thinkMatch[1]) {
            setThoughtProcess(thinkMatch[1].trim());
            setOutput(fullResponse.replace(/<think>[\s\S]*?<\/think>/, '').trim());
          } else {
            setOutput(fullResponse);
          }
          
          const timeTaken = (Date.now() - startTime) / 1000;
          setResponseTime(timeTaken);
          setIsStreaming(false);
          setStreamingError("");
          setCleanupStream(null);
        }
      });

      // Store cleanup function
      setCleanupStream(() => cleanup);
    } catch (error) {
      setCleanupStream(null);
      
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to start streaming",
        variant: "destructive"
      });
      setIsStreaming(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) {
      toast({
        title: "Input Required",
        description: "Please enter some text before submitting",
        variant: "destructive"
      });
      return;
    }
    generateWithStream();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) {
      toast({
        title: "Input Required",
        description: "Please enter some text before submitting",
        variant: "destructive"
      });
      return;
    }
    generateWithStream();
  };

  const handleCopyOutput = async (text: string) => {
    if (!text) return;
    
    try {
      // Strip markdown formatting to get plain text
      const plainText = text
        .replace(/^#{1,6}\s+/gm, '') // Remove headers
        .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
        .replace(/__(.*?)__/g, '$1')
        .replace(/\*(.*?)\*/g, '$1') // Remove italic
        .replace(/_(.*?)_/g, '$1')
        .replace(/~~(.*?)~~/g, '$1') // Remove strikethrough
        .replace(/`([^`]+)`/g, '$1') // Remove inline code
        .replace(/```[\s\S]*?```/g, (match) => match.replace(/```(\w+)?\n?/g, '').replace(/```/g, '')) // Remove code blocks
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // Remove images
        .replace(/^---+$/gm, '') // Remove horizontal rules
        .replace(/^>\s?/gm, '') // Remove blockquotes
        .replace(/^[\s]*[-*+]\s+/gm, '') // Remove list markers
        .replace(/^[\s]*\d+\.\s+/gm, '')
        .replace(/\|/g, ' ') // Clean table pipes
        .replace(/\n{3,}/g, '\n\n') // Clean extra newlines
        .replace(/[ \t]+/g, ' ') // Clean extra spaces
        .trim();

      await navigator.clipboard.writeText(plainText);
      toast({
        title: "Copied",
        description: "Plain text copied to clipboard",
      });
    } catch (err) {
      toast({
        title: "Copy Failed",
        description: "Could not copy to clipboard",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="flex flex-col gap-6">
        <Card className="p-6">
          <SystemPrompt systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} />
        </Card>
        
        <Card className="p-6">
          <Collapsible open={showSettings} onOpenChange={setShowSettings}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <span>Advanced Settings</span>
                </div>
                {showSettings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 mt-4">
              <LLMProviderSelector
                config={llmConfig}
                onConfigChange={setLlmConfig}
                ollamaModels={ollama.models}
                currentOllamaModel={ollama.currentModel}
                setCurrentOllamaModel={ollama.setCurrentModel}
                ollamaTemperature={ollama.temperature}
                setOllamaTemperature={ollama.setTemperature}
                ollamaTopP={ollama.topP}
                setOllamaTopP={ollama.setTopP}
              />
              
              {llmConfig.provider === 'ollama' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
                  <ServerConfig 
                    serverUrl={ollama.serverUrl}
                    isConnected={ollama.isConnected}
                    onUpdateServerUrl={ollama.updateServerUrl}
                    onReconnect={ollama.reconnectToServer}
                  />
                  <Connector isConnected={ollama.isConnected} />
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </Card>
        
        {streamingError && (
          <Card className="p-4 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
            <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
              <BrainCircuit className="h-4 w-4" />
              <div>
                <p className="text-sm font-medium">Desktop Browser Detected</p>
                <p className="text-xs text-blue-700 dark:text-blue-300">{streamingError}</p>
              </div>
            </div>
          </Card>
        )}
        
        <Card className="p-6">
          <h3 className="text-xl font-semibold mb-4">Input</h3>
          <form onSubmit={handleSubmit}>
            <div className="mb-4 relative">
              <Textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Enter your text here..."
                className="min-h-32 font-mono text-sm pr-10"
              />
              {inputText && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setInputText("")}
                  className="absolute top-2 right-2 h-6 w-6 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            
            <div className="flex justify-between items-center">
              <div className="flex gap-2">
                {inputText && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setInputText("")}
                    className="flex items-center"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Clear
                  </Button>
                )}
              </div>
              <Button 
                type="submit" 
                disabled={isStreaming || !inputText.trim() || !ollama.isConnected || !ollama.currentModel}
                className="flex items-center"
              >
                {isStreaming ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Streaming...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Submit
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>
      </div>
      
      <Card className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold">Response</h3>
          {(output || streamedOutput) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleCopyOutput(output || streamedOutput)}
              className="h-8 px-2"
            >
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>
          )}
        </div>
        
        {/* Chain of Reasoning Display */}
        {thoughtProcess && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowThoughts(!showThoughts)}
                className="text-blue-600 dark:text-blue-400 flex items-center gap-1 p-1 h-auto"
              >
                <BrainCircuit className="w-4 h-4" />
                <span className="text-sm font-medium">Chain of Reasoning</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showThoughts ? 'rotate-180' : ''}`} />
              </Button>
              {showThoughts && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyOutput(thoughtProcess)}
                  className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              )}
            </div>
            {showThoughts && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3 font-mono text-xs text-blue-800 dark:text-blue-300 overflow-auto max-h-48">
                <div className="whitespace-pre-wrap">{thoughtProcess}</div>
              </div>
            )}
          </div>
        )}

        {isStreaming && (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center">
              <RefreshCw className="h-8 w-8 animate-spin text-primary mb-2" />
              <p className="text-sm text-gray-500">Streaming response...</p>
            </div>
          </div>
        )}
        
        <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-4 min-h-32">
          {(output || streamedOutput || isStreaming) ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {output || streamedOutput}
              </ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-1" />
              )}
            </div>
          ) : (
            <div className="text-gray-400 italic text-center py-8">
              Response will appear here after submission
            </div>
          )}
        </div>
        
        {responseTime && (output || streamedOutput) && (
          <div className="mt-2 text-right text-sm text-gray-500">
            Response time: {responseTime.toFixed(2)}s
          </div>
        )}
      </Card>
    </div>
  );
}