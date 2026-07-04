import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ServerIcon, CheckIcon, XIcon, RefreshCw } from "lucide-react";

interface ServerConfigProps {
  serverUrl: string;
  isConnected: boolean;
  onUpdateServerUrl: (url: string) => Promise<boolean>;
  onReconnect?: () => void;
}

export function ServerConfig({ 
  serverUrl, 
  isConnected, 
  onUpdateServerUrl,
  onReconnect 
}: ServerConfigProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!urlInput.trim()) return;
    
    setIsSubmitting(true);
    
    try {
      const success = await onUpdateServerUrl(urlInput);
      if (success) {
        setIsEditing(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReconnect = async () => {
    if (!onReconnect) return;
    
    setIsReconnecting(true);
    
    try {
      // Trigger the reconnection attempt
      onReconnect();
    } finally {
      // Reset the loading state after a brief delay to show the user the action was performed
      setTimeout(() => setIsReconnecting(false), 1500);
    }
  };

  return (
    <Card className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ServerIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <h3 className="text-lg font-medium">Ollama Server Configuration</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} mr-1.5`}></div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>
      
      {isEditing ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://localhost:11434"
              className="flex-1"
              disabled={isSubmitting}
            />
            <div className="flex gap-2">
              <Button 
                type="submit" 
                disabled={isSubmitting || urlInput === serverUrl}
                className="w-full sm:w-auto"
              >
                <CheckIcon className="w-4 h-4 mr-1" />
                Save
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => {
                  setIsEditing(false);
                  setUrlInput(serverUrl);
                }}
                disabled={isSubmitting}
                className="w-full sm:w-auto"
              >
                <XIcon className="w-4 h-4 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Enter the URL of your Ollama server, including the port (e.g., http://localhost:11434)
          </p>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-2 flex-1 overflow-x-auto text-sm">
              <code className="font-mono">{serverUrl}</code>
            </div>
            <div className="flex gap-2 ml-2">
              <Button 
                type="button" 
                variant="outline" 
                size="sm"
                onClick={handleReconnect}
                disabled={isReconnecting}
                className="whitespace-nowrap"
                title="Reconnect to server"
              >
                <RefreshCw className={`w-4 h-4 ${isReconnecting ? 'animate-spin' : ''}`} />
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setIsEditing(true)}
                className="whitespace-nowrap"
              >
                Edit
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {isConnected 
              ? "Connected to Ollama server successfully" 
              : "Unable to connect to the server. Please check the URL and ensure the Ollama server is running."}
          </p>
        </div>
      )}
    </Card>
  );
}