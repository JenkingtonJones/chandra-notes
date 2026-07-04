import { Button } from "@/components/ui/button";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { OllamaChat } from "@/components/ollama/ollama-chat-working";

export default function Home() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <header className="mb-6">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3 mb-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 text-center font-medium">
              🧪 Research Preview - Multi-LLM Testing Interface
            </p>
          </div>
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-200">SHN Chandra v0.3 Note Builder</h1>
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                className="rounded-md bg-gray-200 dark:bg-gray-700"
              >
                {theme === "light" ? (
                  <MoonIcon className="h-5 w-5" />
                ) : (
                  <SunIcon className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
          <p className="text-gray-600 dark:text-gray-400 max-w-2xl mb-6">
            AI-powered chat interface for generating text completions with real-time streaming.
          </p>
        </header>

        <main>
          <OllamaChat />
        </main>
      </div>
    </div>
  );
}
