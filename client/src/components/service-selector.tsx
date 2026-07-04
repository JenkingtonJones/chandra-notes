
import { useServiceSelector } from "@/hooks/use-service-selector";
import { Button } from "@/components/ui/button";
import { Cloud, Server } from "lucide-react";
import { useEffect } from "react";

export function ServiceSelector() {
  const { selectedService, setSelectedService } = useServiceSelector();

  // Log the current selection to verify it's working
  useEffect(() => {
    console.log(`ServiceSelector: Current service is ${selectedService}`);
  }, [selectedService]);

  const handleServiceChange = (service: 'azure' | 'ollama') => {
    console.log(`Changing service to: ${service}`);
    setSelectedService(service);
  };

  return (
    <div className="flex flex-col space-y-2 mb-6">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Select AI Service Provider
      </label>
      <div className="flex space-x-2">
        <Button
          variant={selectedService === 'azure' ? 'default' : 'outline'}
          className="flex-1"
          onClick={() => handleServiceChange('azure')}
        >
          <Cloud className="h-4 w-4 mr-2" />
          Azure LLM
        </Button>
        <Button
          variant={selectedService === 'ollama' ? 'default' : 'outline'}
          className="flex-1"
          onClick={() => handleServiceChange('ollama')}
        >
          <Server className="h-4 w-4 mr-2" />
          Ollama
        </Button>
      </div>
    </div>
  );
}
