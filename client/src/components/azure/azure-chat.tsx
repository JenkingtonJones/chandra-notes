import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Copy, RefreshCw, AlertCircle, Send, Trash } from "lucide-react";
import { SystemPrompt } from "./system-prompt";
import { ExternalPromptSelector } from "@/components/external-prompt-selector";

interface AzureChatResponse {
  response: string;
  original_response?: string;
  combined_from_multiple_requests?: boolean;
}

export function AzureChat() {
  const { toast } = useToast();
  const [inputText, setInputText] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>(
    "You are a physician assistant compiling information to synthesize it. You are comfortable with medical jargon and you use sentence fragments for directness. Format the following medical information into a clinical note with these sections:\n1. ID: Patient identification and basic demographics\n2. HPI: History of Present Illness with relevant details\n3. Course of Illness including hospitalizations with items and most relevant tests listed in order of date, with dates where included\n4. Problem list: Issue-based and sorted by importance followed by a few plans for management in sentence fragments\n\nBe concise and use standard medical abbreviations where appropriate. All results should be in plain text, no markdown or other formatting. All dates should be in the format Month, day, like May 5, and year should be included if it is not the current year. Always provide complete responses without truncation."
  );
  
  const { mutate, isPending, error, isError } = useMutation({
    mutationFn: async () => {
      const startTime = Date.now();
      console.log("Sending request to Azure LLM API:", {
        prompt: inputText,
        systemPrompt: systemPrompt
      });
      
      // Combine system prompt with user input
      // We'll format it in a way that the Azure LLM can understand the system prompt as instructions
      const formattedPrompt = systemPrompt 
        ? `[System Instructions]\n${systemPrompt}\n\n[User Input]\n${inputText}`
        : inputText;
      
      const response = await apiRequest("POST", "/api/azure/chat", {
        prompt: formattedPrompt,
        max_tokens: 2000  // Request more tokens for longer responses
      });
      
      const data: AzureChatResponse = await response.json();
      console.log("Received response from Azure LLM API:", data);
      console.log("Response length:", data.response ? data.response.length : 0);
      
      // Check if this was a combined response
      if (data.combined_from_multiple_requests) {
        console.log("Combined from multiple requests to overcome token limits");
      }
      
      const timeTaken = (Date.now() - startTime) / 1000;
      setResponseTime(timeTaken);
      return data.response || "";
    },
    onSuccess: (data) => {
      console.log("Received response from API:", data);
      setOutput(data);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate response",
        variant: "destructive"
      });
    }
  });

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
    mutate();
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
      <SystemPrompt 
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
      />
      
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Input</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center mb-1">
              <label className="text-sm font-medium">Type or paste unformatted medical information</label>
              <div className="flex gap-2">
                <ExternalPromptSelector 
                  onSelectPrompt={(prompt) => setInputText(prompt)}
                />
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
              disabled={isPending || !inputText.trim()}
              className="flex items-center"
            >
              {isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
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
        
        {isPending && (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center">
              <RefreshCw className="h-8 w-8 animate-spin text-primary mb-2" />
              <p className="text-sm text-gray-500">Chandra is thinking...</p>
            </div>
          </div>
        )}
        
        {isError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4 mb-4">
            <div className="flex items-start">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 mr-2" />
              <div>
                <h4 className="text-sm font-medium text-red-800 dark:text-red-300">Error</h4>
                <p className="text-sm text-red-700 dark:text-red-400">
                  {error instanceof Error ? error.message : "Failed to connect to Chandra server. Please try again."}
                </p>
              </div>
            </div>
          </div>
        )}
        
        {!isPending && !isError && (
          <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-4 min-h-32">
            {output ? (
              <div className="font-mono text-sm whitespace-pre-wrap">{output}</div>
            ) : (
              <div className="text-gray-400 italic text-center py-8">
                Response will appear here after submission
              </div>
            )}
          </div>
        )}
        
        {responseTime && output && (
          <div className="mt-2 text-right text-sm text-gray-500">
            Response time: {responseTime.toFixed(2)}s
          </div>
        )}
      </Card>
    </div>
  );
}