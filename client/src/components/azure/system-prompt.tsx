import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronUp, Settings, RefreshCw, Download } from "lucide-react";
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
  const [isOpen, setIsOpen] = useState(false);
  const [localPrompt, setLocalPrompt] = useState(systemPrompt || "You are a physician assistant compiling information to synthesize it. You are comfortable with medical jargon and you use sentence fragments for directness. Format the following medical information into a clinical note with these sections:\n1. ID: Patient identification and basic demographics\n2. HPI: History of Present Illness with relevant details\n3. Course of Illness including hospitalizations with items and most relevant tests listed in order of date, with dates where included\n4. Problem list: Issue-based and sorted by importance followed by a few plans for management in sentence fragments\n\nBe concise and use standard medical abbreviations where appropriate.");
  const [selectedService, setSelectedService] = useState<string>("");
  const [selectedPrompt, setSelectedPrompt] = useState<string>("");
  const { toast } = useToast();

  // Fetch services
  const { data: services = [], isLoading: isLoadingServices } = useQuery<Service[]>({
    queryKey: ["/api/external-prompts/services"],
  });

  // Fetch prompts
  const { data: prompts = [], isLoading: isLoadingPrompts } = useQuery<ExternalPrompt[]>({
    queryKey: ["/api/external-prompts"],
  });

  // Filter prompts by selected service
  const filteredPrompts = prompts.filter((prompt: ExternalPrompt) => 
    selectedService ? prompt.service === selectedService : true
  );

  const handleLoadPrompt = () => {
    const prompt = prompts.find(p => p.id.toString() === selectedPrompt);
    if (prompt) {
      setLocalPrompt(prompt.content);
      toast({
        title: "Prompt Loaded",
        description: `"${prompt.name}" has been loaded into the system prompt`,
      });
    }
  };

  const handleSave = () => {
    setSystemPrompt(localPrompt);
  };

  const handleReset = () => {
    const defaultPrompt = "You are a physician assistant compiling information to synthesize it. You are comfortable with medical jargon and you use sentence fragments for directness. Format the following medical information into a clinical note with these sections:\n1. ID: Patient identification and basic demographics\n2. HPI: History of Present Illness with relevant details\n3. Course of Illness including hospitalizations with items and most relevant tests listed in order of date, with dates where included\n4. Problem list: Issue-based and sorted by importance followed by a few plans for management in sentence fragments\n\nBe concise and use standard medical abbreviations where appropriate. All results should be in plain text, no markdown or other formatting. All dates should be in the format Month, day, like May 5, and year should be included if it is not the current year. Always provide complete responses without truncation.";
    setLocalPrompt(defaultPrompt);
    setSystemPrompt(defaultPrompt);
  };

  return (
    <Card className="p-4 mb-6">
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Settings className="h-5 w-5 text-blue-500" />
            <h3 className="text-lg font-medium">System Instructions</h3>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              {isOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              <span className="sr-only">Toggle</span>
            </Button>
          </CollapsibleTrigger>
        </div>
        
        <CollapsibleContent className="mt-4 space-y-4">
          <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 p-4 text-sm text-blue-800 dark:text-blue-300">
            <p className="mb-2">
              These instructions tell the AI how to interpret and respond to your input. 
              They act as context for the conversation.
            </p>
          </div>

          {/* External Prompt Selectors */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Service
              </label>
              <Select
                value={selectedService}
                onValueChange={setSelectedService}
                disabled={isLoadingServices}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select service" />
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
          
          <div className="space-y-3">
            <Textarea
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              placeholder="Enter system instructions here..."
              className="min-h-32 font-mono text-sm resize-y"
            />
            
            <div className="flex justify-end space-x-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleReset}
                className="flex items-center"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Reset
              </Button>
              <Button 
                size="sm"
                onClick={handleSave}
                className="flex items-center"
              >
                Save
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}