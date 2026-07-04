import { AzureChat } from "@/components/azure/azure-chat";

export default function AzureChatPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <header className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-200">Azure LLM Chat</h1>
            <a 
              href="/" 
              className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
            >
              Back to Home
            </a>
          </div>
          <p className="text-gray-600 dark:text-gray-400 max-w-2xl">
            This page connects directly to the Azure LLM API for text generation. Enter your text in the input field below and click "Submit" to get a response.
          </p>
        </header>
        
        <main>
          <AzureChat />
        </main>
      </div>
    </div>
  );
}