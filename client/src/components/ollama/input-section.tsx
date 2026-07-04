import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SystemPrompt } from "./system-prompt"; 
import { ExternalPromptSelector } from "@/components/external-prompt-selector";
import { ArrowRightIcon, TrashIcon } from "lucide-react";

interface InputSectionProps {
  inputText: string;
  setInputText: (text: string) => void;
  systemPrompt: string;
  setSystemPrompt: (prompt: string) => void;
}

export function InputSection({
  inputText,
  setInputText,
  systemPrompt,
  setSystemPrompt
}: InputSectionProps) {
  const handleClearInput = () => {
    setInputText("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-4 flex-1 flex flex-col">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200">Input</h2>
          <div className="flex items-center gap-2">
            <ExternalPromptSelector 
              onSelectPrompt={(prompt) => setInputText(prompt)}
            />
            <Button 
              variant="ghost" 
              size="sm"
              onClick={handleClearInput}
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1"
            >
              <TrashIcon className="w-5 h-5" />
            </Button>
          </div>
        </div>
        
        <Textarea 
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Enter your text here..."
          className="w-full flex-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-3 font-mono text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
        />
        
        <div className="mt-3 flex justify-end">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {inputText.length} characters
          </div>
        </div>
      </div>

      <SystemPrompt
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
      />
      
      <div className="flex justify-end">
        <Button 
          type="submit"
          form="generate-form"
          className="bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-md px-6 py-3 transition-colors flex items-center gap-2"
        >
          <span>Transform</span>
          <ArrowRightIcon className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
