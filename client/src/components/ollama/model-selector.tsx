import { Model } from "@/types/ollama";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RefreshCw, BrainCircuit, Zap, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ModelSelectorProps {
  models: Model[];
  currentModel: string;
  setCurrentModel: (modelId: string) => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  topP: number;
  setTopP: (topP: number) => void;
  onRefreshModels: () => void;
}

export function ModelSelector({
  models,
  currentModel,
  setCurrentModel,
  temperature,
  setTemperature,
  topP,
  setTopP,
  onRefreshModels
}: ModelSelectorProps) {
  console.log("ModelSelector - models:", models);
  console.log("ModelSelector - currentModel:", currentModel);
  
  // Helper function to get model size in a readable format
  const formatModelSize = (sizeInBytes: number) => {
    const sizeInGB = sizeInBytes / (1024 * 1024 * 1024);
    return `${sizeInGB.toFixed(1)}GB`;
  };

  // Check if model is large and slow
  const isLargeModel = (sizeInBytes: number) => {
    const sizeInGB = sizeInBytes / (1024 * 1024 * 1024);
    return sizeInGB > 15; // Models over 15GB are considered large
  };
  
  // Get model icon based on name
  const getModelIcon = (modelName: string) => {
    if (modelName.includes('deepseek-r1')) {
      return <BrainCircuit className="w-4 h-4 mr-2 text-purple-500" />;
    } else if (modelName.includes('deepseek-v2')) {
      return <Zap className="w-4 h-4 mr-2 text-blue-500" />;
    } else {
      return <Bot className="w-4 h-4 mr-2 text-green-500" />;
    }
  };
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6 space-y-4">
      {/* Model Selection Row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Model:</span>
          <Select value={currentModel} onValueChange={setCurrentModel}>
            <SelectTrigger className="w-full bg-gray-100 dark:bg-gray-700 border-0 rounded-md px-3 py-2 text-sm">
              <SelectValue placeholder="Select a model">
                {currentModel && (
                  <div className="flex items-center">
                    {getModelIcon(currentModel)}
                    <span className="truncate">{currentModel}</span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {models.length > 0 ? (
                models.map(model => {
                  // Get parameter size from details
                  const paramSize = model.details?.parameter_size || "";
                  
                  return (
                    <SelectItem key={model.name} value={model.name} className="py-2">
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center">
                          {getModelIcon(model.name)}
                          <span>{model.name}</span>
                        </div>
                        <div className="ml-2 flex gap-1 items-center">
                          {model.name.includes('deepseek-r1') && (
                            <Badge variant="outline" className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300">
                              CoT
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {paramSize}
                          </Badge>
                        </div>
                      </div>
                    </SelectItem>
                  );
                })
              ) : (
                <SelectItem value="no-models" disabled>No models available</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        
        <Button 
          className="bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-md whitespace-nowrap"
          onClick={onRefreshModels}
          size="sm"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>
      
      {/* Large Model Warning */}
      {models.find(m => m.name === currentModel) && isLargeModel(models.find(m => m.name === currentModel)!.size) && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <BrainCircuit className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          <div className="text-sm text-amber-800 dark:text-amber-200">
            <strong>Large Model Notice:</strong> This {formatModelSize(models.find(m => m.name === currentModel)!.size)} model may take 2-10 minutes to respond. Consider using a smaller model for faster results.
          </div>
        </div>
      )}
      
      {/* Parameters Row */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Temp:</span>
          <Slider 
            value={[temperature]} 
            min={0} 
            max={1} 
            step={0.05} 
            className="flex-1 max-w-[120px]"
            onValueChange={(values) => setTemperature(values[0])} 
          />
          <span className="text-sm min-w-[2.5rem] text-right">{temperature.toFixed(2)}</span>
        </div>
        
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Top P:</span>
          <Slider 
            value={[topP]} 
            min={0} 
            max={1} 
            step={0.05} 
            className="flex-1 max-w-[120px]"
            onValueChange={(values) => setTopP(values[0])} 
          />
          <span className="text-sm min-w-[2.5rem] text-right">{topP.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
