import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import PromptLibrary from "@/pages/prompt-library";
import ExternalPromptsPage from "@/pages/external-prompts";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/prompts" component={PromptLibrary} />
      <Route path="/external-prompts" component={ExternalPromptsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
