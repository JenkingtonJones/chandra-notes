import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Copy, AlertCircle, RefreshCw, Eye, EyeOff, BrainCircuit, ChevronDown } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { OllamaCompletionResponse } from "@/types/ollama";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface OutputSectionProps {
  inputText: string;
  systemPrompt: string;
  modelId: string;
  temperature: number;
  topP: number;
}

export function OutputSection({
  inputText,
  systemPrompt,
  modelId,
  temperature,
  topP
}: OutputSectionProps) {
  const { toast } = useToast();
  const [output, setOutput] = useState<string>("");
  const [thoughtProcess, setThoughtProcess] = useState<string>("");
  const [showThoughts, setShowThoughts] = useState<boolean>(false);
  const [tokenInfo, setTokenInfo] = useState<{ tokens: number; time: number } | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamedOutput, setStreamedOutput] = useState<string>("");
  
  // Real-time streaming function using EventSource
  const generateWithStream = async () => {
    setIsStreaming(true);
    setStreamedOutput("");
    setOutput("");
    setThoughtProcess("");
    
    try {
      // Use EventSource for true real-time streaming
      const eventSource = new EventSource(`/api/ollama/generate-stream?model=${encodeURIComponent(modelId)}&prompt=${encodeURIComponent(inputText)}&system=${encodeURIComponent(systemPrompt)}&temperature=${temperature}&top_p=${topP}`);
      
      let fullResponse = "";
      let currentThought = "";
      let inThinkMode = false;
      
      eventSource.onmessage = (event) => {
        try {
          if (event.data === '[DONE]') {
            eventSource.close();
            
            // Final processing for think tags
            const thinkMatch = fullResponse.match(/<think>([\s\S]*?)<\/think>/);
            if (thinkMatch && thinkMatch[1]) {
              setThoughtProcess(thinkMatch[1].trim());
              setOutput(fullResponse.replace(/<think>[\s\S]*?<\/think>/, '').trim());
            } else {
              setOutput(fullResponse);
            }
            
            setIsStreaming(false);
            return;
          }
          
          const data = JSON.parse(event.data);
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
          
        } catch (e) {
          console.error("Error parsing streaming data:", e);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error("EventSource error:", error);
        eventSource.close();
        setIsStreaming(false);
        toast({
          title: "Streaming Error",
          description: "Connection to streaming service was lost",
          variant: "destructive"
        });
      };
      
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to start streaming",
        variant: "destructive"
      });
      setIsStreaming(false);
    }
  };

  // Remove unused mutation since we're using direct streaming

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelId) {
      toast({
        title: "Model Required",
        description: "Please select a model before generating a response",
        variant: "destructive"
      });
      return;
    }
    
    if (!inputText.trim()) {
      toast({
        title: "Input Required", 
        description: "Please enter some text to generate a response",
        variant: "destructive"
      });
      return;
    }
    
    // Clear previous outputs and start streaming
    setOutput("");
    setStreamedOutput("");
    setTokenInfo(null);
    setThoughtProcess("");
    setShowThoughts(false);
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

  const toggleThoughts = () => {
    setShowThoughts(!showThoughts);
  };

  return (
    <form id="generate-form" onSubmit={handleSubmit} className="flex flex-col h-full">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 h-full flex flex-col">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200">Output</h2>
          <div className="flex items-center gap-2">
            {thoughtProcess && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={toggleThoughts}
                className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 p-1 flex items-center gap-1"
              >
                {showThoughts ? <EyeOff className="w-4 h-4" /> : <BrainCircuit className="w-4 h-4" />}
                <span className="text-xs">{showThoughts ? "Hide CoT" : "Show CoT"}</span>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleCopyOutput(output)}
              disabled={!output}
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1"
            >
              <Copy className="w-5 h-5" />
            </Button>
          </div>
        </div>
        
        {isStreaming && (
          <div className="flex items-center justify-center flex-1">
            <div className="flex flex-col items-center">
              <div className="loader ease-linear rounded-full border-4 border-gray-200 border-t-4 h-12 w-12 mb-4"></div>
              <div className="text-center">
                <h2 className="text-base font-semibold text-gray-700 dark:text-gray-300">Streaming...</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Real-time response generation</p>
              </div>
            </div>
          </div>
        )}
        
        {!isStreaming && (
          <div className="flex flex-col flex-1">
            {thoughtProcess && (
              <Collapsible open={showThoughts} onOpenChange={setShowThoughts} className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={toggleThoughts}
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
                <CollapsibleContent>
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3 font-mono text-xs text-blue-800 dark:text-blue-300 overflow-auto max-h-48">
                    <div className="whitespace-pre-wrap">{thoughtProcess}</div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
            
            <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-3 flex-1 overflow-auto">
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
                <div className="text-gray-400 dark:text-gray-500 italic">
                  Output will appear here after transformation
                </div>
              )}
            </div>
            
            {tokenInfo && output && (
              <div className="mt-3 flex justify-between items-center">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Tokens: {tokenInfo.tokens} | Time: {tokenInfo.time.toFixed(1)}s
                </div>
                
                <div className="flex items-center gap-2">
                  <Button 
                    type="submit"
                    variant="ghost" 
                    size="sm"
                    className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
