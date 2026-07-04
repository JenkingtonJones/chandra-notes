import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ChevronDown, HelpCircle, Download } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface ExternalPrompt {
  id: number;
  name: string;
  service: string;
  description: string;
  content: string;
  status: string;
  version: string;
  createdBy: string;
  apiCalls: number;
  lastUsed: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Service {
  id: number;
  name: string;
  description: string;
}

interface SystemPromptProps {
  systemPrompt: string;
  setSystemPrompt: (prompt: string) => void;
}

export function SystemPrompt({ systemPrompt, setSystemPrompt }: SystemPromptProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<string>("");
  const [selectedPrompt, setSelectedPrompt] = useState<string>("");
  const { toast } = useToast();

  // Fetch services with timeout and error handling
  const { data: servicesData, isLoading: isLoadingServices, isError: isServicesError } = useQuery({
    queryKey: ["/api/external-prompts/services"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Fetch prompts with timeout and error handling
  const { data: promptsData, isLoading: isLoadingPrompts, isError: isPromptsError } = useQuery({
    queryKey: ["/api/external-prompts"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Safely handle the data with type checking
  const services: Service[] = (servicesData && Array.isArray(servicesData)) ? servicesData as Service[] : [];
  const prompts: ExternalPrompt[] = (promptsData && Array.isArray(promptsData)) ? promptsData as ExternalPrompt[] : [];

  // Filter prompts by selected service
  const filteredPrompts = prompts.filter((prompt: ExternalPrompt) => 
    selectedService ? prompt.service === selectedService : true
  );

  const handleLoadPrompt = () => {
    const prompt = prompts.find((p: ExternalPrompt) => p.id.toString() === selectedPrompt);
    if (prompt) {
      setSystemPrompt(prompt.content);
      toast({
        title: "Prompt Loaded",
        description: `"${prompt.name}" has been loaded into the system prompt`,
      });
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-4">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200">System Prompt</h2>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsHelpOpen(!isHelpOpen)}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-0 h-auto"
          >
            <HelpCircle className="w-5 h-5" />
          </Button>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setIsOpen(!isOpen)}
          className="text-gray-500 p-1"
        >
          <ChevronDown className={`w-5 h-5 transition-transform ${isOpen ? '' : 'rotate-180'}`} />
        </Button>
      </div>
      
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleContent className="transition-height space-y-3">
          {isHelpOpen && (
            <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded-md mb-3 text-sm">
              <p className="text-gray-700 dark:text-gray-300 mb-2">
                The system prompt sets the behavior and context for the AI model. Use it to:
              </p>
              <ul className="list-disc pl-5 text-gray-700 dark:text-gray-300 space-y-1">
                <li>Define the AI's role (e.g., "You are a helpful assistant")</li>
                <li>Provide specific instructions for formatting or style</li>
                <li>Set constraints on the AI's responses</li>
                <li>Provide background context for the task</li>
              </ul>
            </div>
          )}

          {/* External Prompt Selectors */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Service
              </label>
              <Select
                value={selectedService}
                onValueChange={setSelectedService}
                disabled={false}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={isServicesError ? "External server unavailable" : isLoadingServices ? "Loading services..." : "Select service"} />
                </SelectTrigger>
                <SelectContent>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={service.name}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Prompt
              </label>
              <Select
                value={selectedPrompt}
                onValueChange={setSelectedPrompt}
                disabled={isLoadingPrompts || filteredPrompts.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select prompt" />
                </SelectTrigger>
                <SelectContent>
                  {filteredPrompts.map((prompt) => (
                    <SelectItem key={prompt.id} value={prompt.id.toString()}>
                      {prompt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                onClick={handleLoadPrompt}
                disabled={!selectedPrompt}
                className="w-full flex items-center gap-2"
                variant="outline"
              >
                <Download className="h-4 w-4" />
                Load Prompt
              </Button>
            </div>
          </div>
          
          <Textarea 
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Load a prompt from the server above or type your own system prompt here..."
            className="w-full h-32 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-3 font-mono text-sm resize-y focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={false}
            style={{ pointerEvents: 'auto' }}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
