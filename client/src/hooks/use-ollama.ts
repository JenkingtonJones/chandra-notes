import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Model, OllamaModelsResponse } from "@/types/ollama";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function useOllama() {
  const { toast } = useToast();
  const [currentModel, setCurrentModel] = useState<string>("");
  const [temperature, setTemperature] = useState<number>(0.7);
  const [topP, setTopP] = useState<number>(0.9);
  const [serverUrl, setServerUrl] = useState<string>(() => {
    return localStorage.getItem("ollamaServerUrl") || "http://localhost:11434";
  });
  
  // Fetch available models
  const {
    data: modelsData,
    isLoading: isModelsLoading,
    isError: isModelsError,
    error: modelsError,
    refetch: refetchModels
  } = useQuery({
    queryKey: ["/api/ollama/models"],
    retry: 2,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
  
  // Ping Ollama to check connection
  const {
    data: pingData,
    isLoading: isPingLoading,
    isError: isPingError,
    error: pingError,
    refetch: refetchPing
  } = useQuery({
    queryKey: ["/api/ollama/ping"],
    refetchInterval: 30000, // Check connection every 30 seconds
    retry: 2
  });

  // Determine connection status
  const isConnected = !isPingError && !!pingData;
  const connectionError = isPingError ? (pingError as Error).message : undefined;
  
  // Set models or show error
  console.log("Models data from API:", modelsData);
  const models: Model[] = (modelsData as any)?.models || [];
  console.log("Parsed models:", models);

  // Sync the Ollama URL to the backend only when the user has explicitly set one
  // (persisted in localStorage). This prevents a fresh browser's local default
  // from overwriting the server's configured URL, which lives in the database /
  // the OLLAMA_API_URL env var rather than being hardcoded in the client.
  useEffect(() => {
    const stored = localStorage.getItem("ollamaServerUrl");
    if (!stored) return;
    apiRequest("POST", "/api/ollama/config", { serverUrl: stored })
      .then(() => console.log("Synced Ollama URL to backend:", stored))
      .catch((error) => console.error("Failed to sync Ollama URL to backend:", error));
  }, [serverUrl]);

  // Set first model as default if none selected and models are available
  useEffect(() => {
    if (models.length > 0 && !currentModel) {
      setCurrentModel(models[0].name);
    }
  }, [models, currentModel]);

  // Refresh models when connection changes
  useEffect(() => {
    if (isConnected) {
      refetchModels();
    }
  }, [isConnected, refetchModels]);
  
  // Handle connection errors
  useEffect(() => {
    if (isPingError) {
      toast({
        title: "Connection Error",
        description: "Could not connect to Ollama server. Please ensure it is running.",
        variant: "destructive",
      });
    }
  }, [isPingError, toast]);

  // Function to refresh models
  const refreshModels = () => {
    refetchModels();
    toast({
      title: "Refreshing Models",
      description: "Getting available models from Ollama server",
    });
  };

  // Function to reconnect to the server
  const reconnectToServer = async () => {
    try {
      // Sync the current localStorage URL to the backend
      const currentUrl = localStorage.getItem("ollamaServerUrl") || "http://localhost:11434";
      await apiRequest("POST", "/api/ollama/config", { serverUrl: currentUrl });
      
      // Refresh connection status and models list
      refetchPing();
      refetchModels();
      
      toast({
        title: "Reconnecting",
        description: "Attempting to reconnect to Ollama server",
      });
    } catch (error) {
      toast({
        title: "Reconnection Error",
        description: error instanceof Error ? error.message : "Failed to reconnect",
        variant: "destructive"
      });
    }
  };
  
  // Function to update the server URL
  const updateServerUrl = async (url: string) => {
    try {
      localStorage.setItem("ollamaServerUrl", url);
      setServerUrl(url);
      
      // Update the server config on the backend
      await apiRequest("POST", "/api/ollama/config", { serverUrl: url });
      
      // Refresh connection status and models list
      refetchPing();
      refetchModels();
      
      toast({
        title: "Server Updated",
        description: `Ollama server URL updated to ${url}`,
      });
      
      return true;
    } catch (error) {
      toast({
        title: "Configuration Error",
        description: error instanceof Error ? error.message : "Failed to update server URL",
        variant: "destructive"
      });
      return false;
    }
  };

  return {
    models,
    isModelsLoading,
    isModelsError,
    currentModel,
    setCurrentModel,
    isConnected,
    connectionError,
    temperature,
    setTemperature,
    topP,
    setTopP,
    refreshModels,
    serverUrl,
    updateServerUrl,
    reconnectToServer
  };
}
