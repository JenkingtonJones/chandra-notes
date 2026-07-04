import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";

export function InstructionsBox() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="p-4 mb-6">
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="w-full"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <HelpCircle className="h-5 w-5 text-blue-500" />
            <h3 className="text-lg font-medium">Instructions</h3>
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
            <h4 className="font-medium mb-2">How to use this application:</h4>
            <ol className="list-decimal list-inside space-y-2">
              <li>
                Type your text in the input field below.
              </li>
              <li>
                Click the "Submit" button to send your text to the Azure Language Model.
              </li>
              <li>
                The model will process your input and return a response in the output section.
              </li>
              <li>
                You can copy the response to your clipboard using the "Copy" button.
              </li>
            </ol>
            
            <div className="mt-4">
              <h4 className="font-medium mb-1">About the API:</h4>
              <p>
                This application connects to a configured Azure virtual machine
                running a language model, which processes your text.
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}