
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Copy, RefreshCw, Send, BrainCircuit, ChevronDown } from "lucide-react";
import { SystemPrompt } from "./system-prompt";
import { ModelSelector } from "./model-selector";
import { useOllama } from "@/hooks/use-ollama";
import { ServerConfig } from "./server-config";
import { Connector } from "./connector";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface OllamaResponse {
  response: string;
}

export function OllamaChat() {
  const { toast } = useToast();
  const ollama = useOllama();
  const [inputText, setInputText] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>(
    "You are a physician assistant compiling information to synthesize it. You are comfortable with medical jargon and you use sentence fragments for directness. Format the following medical information into a clinical note with these sections:\n1. ID: Patient identification and basic demographics\n2. HPI: History of Present Illness with relevant details\n3. Course of Illness including hospitalizations with items and most relevant tests listed in order of date, with dates where included\n4. Problem list: Issue-based and sorted by importance followed by a few plans for management in sentence fragments\n\nBe concise and use standard medical abbreviations where appropriate. All results should be in plain text, no markdown or other formatting. All dates should be in the format Month, day, like May 5, and year should be included if it is not the current year. Always provide complete responses without truncation."
  );
  
  // Real-time streaming state
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamedOutput, setStreamedOutput] = useState<string>("");
  const [thoughtProcess, setThoughtProcess] = useState<string>("");
  const [showThoughts, setShowThoughts] = useState<boolean>(false);

  const generateWithStream = async () => {
    if (!ollama.currentModel) {
      toast({
        title: "Model Required",
        description: "Please select a model first",
        variant: "destructive"
      });
      return;
    }

    setIsStreaming(true);
    setStreamedOutput("");
    setOutput("");
    setThoughtProcess("");
    setShowThoughts(false);
    
    try {
      const streamUrl = `/api/ollama/generate-stream?model=${encodeURIComponent(ollama.currentModel)}&prompt=${encodeURIComponent(inputText)}&system=${encodeURIComponent(systemPrompt)}&temperature=${ollama.temperature}&top_p=${ollama.topP}`;
      
      console.log("=== CLIENT STREAMING DEBUG ===");
      console.log("Stream URL:", streamUrl);
      console.log("Model:", ollama.currentModel);
      console.log("Input text length:", inputText.length);
      console.log("System prompt length:", systemPrompt.length);
      console.log("Creating EventSource...");
      
      const eventSource = new EventSource(streamUrl);
      
      let fullResponse = "";
      let currentThought = "";
      let inThinkMode = false;
      let messageCount = 0;
      const startTime = Date.now();
      
      eventSource.onopen = (event) => {
        console.log("EventSource connection opened:", event);
      };
      
      eventSource.onmessage = (event) => {
        messageCount++;
        console.log(`Message ${messageCount} received:`, event.data);
        
        try {
          if (event.data === '[DONE]') {
            console.log("Received [DONE], closing connection");
            eventSource.close();
            
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
            console.log(`Streaming completed in ${timeTaken}s, final response length: ${fullResponse.length}`);
            return;
          }
          
          const data = JSON.parse(event.data);
          console.log(`Parsed data:`, data);
          
          if (data.response) {
            fullResponse += data.response;
            console.log(`Added response chunk, total length: ${fullResponse.length}`);
            
            // Real-time think tag processing
            if (data.response.includes('<think>')) {
              inThinkMode = true;
              console.log("Entering think mode");
            }
            
            if (inThinkMode) {
              currentThought += data.response;
              if (data.response.includes('</think>')) {
                inThinkMode = false;
                console.log("Exiting think mode");
                const thinkMatch = currentThought.match(/<think>([\s\S]*?)<\/think>/);
                if (thinkMatch && thinkMatch[1]) {
                  setThoughtProcess(thinkMatch[1].trim());
                  console.log("Set thought process");
                }
              }
            }
            
            // Update streamed output (excluding think tags for display)
            const displayText = fullResponse.replace(/<think>[\s\S]*?<\/think>/, '').trim();
            setStreamedOutput(displayText);
            console.log(`Updated display text length: ${displayText.length}`);
          }
          
        } catch (e) {
          console.error("Error parsing streaming data:", e, "Raw data:", event.data);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error("EventSource error:", error);
        console.log("EventSource readyState:", eventSource.readyState);
        eventSource.close();
        setIsStreaming(false);
        toast({
          title: "Streaming Error",
          description: "Connection to streaming service was lost",
          variant: "destructive"
        });
      };
      
    } catch (error) {
      console.error("Error starting stream:", error);
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

  const handleClearInput = () => {
    setInputText("");
  };

  return (
    <div className="flex flex-col space-y-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xl font-semibold">Ollama Configuration</h2>
        <Connector isConnected={ollama.isConnected} />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <ServerConfig 
            serverUrl={ollama.serverUrl}
            isConnected={ollama.isConnected}
            onUpdateServerUrl={ollama.updateServerUrl}
            onReconnect={ollama.reconnectToServer}
          />
        </Card>
        <Card className="p-4">
          <ModelSelector 
            models={ollama.models}
            isLoading={ollama.isModelsLoading}
            currentModel={ollama.currentModel}
            setCurrentModel={ollama.setCurrentModel}
            temperature={ollama.temperature}
            setTemperature={ollama.setTemperature}
            topP={ollama.topP}
            setTopP={ollama.setTopP}
            refreshModels={ollama.refreshModels}
          />
        </Card>
      </div>

      <SystemPrompt 
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
      />
      
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Input</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center mb-1">
              <label className="text-sm font-medium">Enter your prompt</label>
              <Button 
                type="button"
                variant="ghost" 
                size="sm"
                onClick={handleClearInput}
                className="h-8 px-2 text-gray-500"
              >
                <Trash className="h-4 w-4 mr-1" />
                Clear
              </Button>
            </div>
            
            <Textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Enter your text here..."
              className="min-h-32 font-mono text-sm"
            />
          </div>
          
          <div className="flex justify-end">
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
      
      <Card className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold">Response</h3>
          {output && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleCopyOutput(output)}
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
        
        {responseTime && output && (
          <div className="mt-2 text-right text-sm text-gray-500">
            Response time: {responseTime.toFixed(2)}s
          </div>
        )}
      </Card>
    </div>
  );
}
