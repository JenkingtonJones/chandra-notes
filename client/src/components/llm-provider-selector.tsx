import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Bot, Cloud, Settings2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type LLMProvider = 'ollama' | 'openai' | 'azure-openai';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  temperature: number;
  maxTokens: number;
  // OpenAI specific
  openaiModel?: string;
  // Azure OpenAI specific
  azureEndpoint?: string;
  azureApiKey?: string;
  azureModel?: string;
}

interface LLMProviderSelectorProps {
  config: LLMConfig;
  onConfigChange: (config: LLMConfig) => void;
  ollamaModels: any[];
  currentOllamaModel: string;
  setCurrentOllamaModel: (model: string) => void;
  ollamaTemperature: number;
  setOllamaTemperature: (temp: number) => void;
  ollamaTopP: number;
  setOllamaTopP: (topP: number) => void;
}

export function LLMProviderSelector({
  config,
  onConfigChange,
  ollamaModels,
  currentOllamaModel,
  setCurrentOllamaModel,
  ollamaTemperature,
  setOllamaTemperature,
  ollamaTopP,
  setOllamaTopP,
}: LLMProviderSelectorProps) {
  const [showOpenAISettings, setShowOpenAISettings] = useState(false);
  const [showAzureSettings, setShowAzureSettings] = useState(false);

  const openaiModels = [
    'o3-pro',
    'o3',
    'o3-mini',
    'o1-pro',
    'o1',
    'o1-mini',
    'gpt-4.5-preview',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'chatgpt-4o-latest',
    'gpt-4o',
    'gpt-4o-2024-11-20',
    'gpt-4o-2024-08-06',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
  ];

  const reasoningModels = ['o3-pro', 'o3', 'o3-mini', 'o1-pro', 'o1', 'o1-mini'];
  const isReasoningModel = reasoningModels.includes(config.openaiModel || 'gpt-4o');

  const updateConfig = (updates: Partial<LLMConfig>) => {
    onConfigChange({ ...config, ...updates });
  };

  const getProviderIcon = (provider: LLMProvider) => {
    switch (provider) {
      case 'ollama':
        return <Bot className="w-4 h-4 text-blue-500" />;
      case 'openai':
        return <Cloud className="w-4 h-4 text-green-500" />;
      case 'azure-openai':
        return <Cloud className="w-4 h-4 text-blue-600" />;
      default:
        return <Settings2 className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="provider">LLM Provider</Label>
        <Select value={config.provider} onValueChange={(value: LLMProvider) => updateConfig({ provider: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Select LLM provider">
              <div className="flex items-center gap-2">
                {getProviderIcon(config.provider)}
                <span className="capitalize">{config.provider === 'azure-openai' ? 'Azure OpenAI' : config.provider}</span>
              </div>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ollama">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-blue-500" />
                <span>Ollama (Local)</span>
              </div>
            </SelectItem>
            <SelectItem value="openai">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-green-500" />
                <span>OpenAI ChatGPT</span>
              </div>
            </SelectItem>
            <SelectItem value="azure-openai">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-blue-600" />
                <span>Azure OpenAI</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {config.provider === 'ollama' && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="ollama-model">Model</Label>
            <Select value={currentOllamaModel} onValueChange={setCurrentOllamaModel}>
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {ollamaModels.map((model) => (
                  <SelectItem key={model.name} value={model.name}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="temperature">Temperature: {ollamaTemperature.toFixed(2)}</Label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={ollamaTemperature}
                onChange={(e) => setOllamaTemperature(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <Label htmlFor="top-p">Top P: {ollamaTopP.toFixed(2)}</Label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={ollamaTopP}
                onChange={(e) => setOllamaTopP(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </div>
      )}

      {config.provider === 'openai' && (
        <Collapsible open={showOpenAISettings} onOpenChange={setShowOpenAISettings}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full">
              OpenAI Configuration
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 mt-3">
            <div>
              <Label htmlFor="openai-model">Model</Label>
              <Select 
                value={config.openaiModel || 'gpt-4o'} 
                onValueChange={(value) => updateConfig({ openaiModel: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {openaiModels.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="openai-temperature">
                  Temperature: {config.temperature.toFixed(2)}
                  {isReasoningModel && <span className="text-xs text-gray-500 ml-1">(disabled for reasoning models)</span>}
                </Label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={config.temperature}
                  onChange={(e) => updateConfig({ temperature: parseFloat(e.target.value) })}
                  className="w-full"
                  disabled={isReasoningModel}
                />
              </div>
              <div>
                <Label htmlFor="max-tokens">Max Tokens</Label>
                <Input
                  type="number"
                  value={config.maxTokens}
                  onChange={(e) => updateConfig({ maxTokens: parseInt(e.target.value) })}
                  min="1"
                  max="4000"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {config.provider === 'azure-openai' && (
        <Collapsible open={showAzureSettings} onOpenChange={setShowAzureSettings}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full">
              Azure OpenAI Configuration
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 mt-3">
            <div>
              <Label htmlFor="azure-endpoint">Azure Endpoint</Label>
              <Input
                placeholder="https://your-resource.openai.azure.com"
                value={config.azureEndpoint || ''}
                onChange={(e) => updateConfig({ azureEndpoint: e.target.value })}
              />
            </div>
            
            <div>
              <Label htmlFor="azure-api-key">API Key</Label>
              <Input
                type="password"
                placeholder="Your Azure OpenAI API key"
                value={config.azureApiKey || ''}
                onChange={(e) => updateConfig({ azureApiKey: e.target.value })}
              />
            </div>
            
            <div>
              <Label htmlFor="azure-model">Deployment Name</Label>
              <Input
                placeholder="gpt-4o"
                value={config.azureModel || 'gpt-4o'}
                onChange={(e) => updateConfig({ azureModel: e.target.value })}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="azure-temperature">Temperature: {config.temperature.toFixed(2)}</Label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={config.temperature}
                  onChange={(e) => updateConfig({ temperature: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </div>
              <div>
                <Label htmlFor="azure-max-tokens">Max Tokens</Label>
                <Input
                  type="number"
                  value={config.maxTokens}
                  onChange={(e) => updateConfig({ maxTokens: parseInt(e.target.value) })}
                  min="1"
                  max="4000"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}