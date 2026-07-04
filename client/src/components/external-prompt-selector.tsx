import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Globe, BookOpen, Search, Copy, Check, Cloud, Database } from "lucide-react";

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
  lastUsed: string;
  createdAt: string;
  updatedAt: string;
}

interface Service {
  id: number;
  name: string;
  description: string;
}

interface ExternalPromptSelectorProps {
  onSelectPrompt: (prompt: string, source?: 'local' | 'external') => void;
  trigger?: React.ReactNode;
}

export function ExternalPromptSelector({ onSelectPrompt, trigger }: ExternalPromptSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedService, setSelectedService] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"local" | "external">("external");

  // Fetch external prompts
  const { data: externalPrompts = [], isLoading: isLoadingExternal } = useQuery<ExternalPrompt[]>({
    queryKey: ["/api/external-prompts"],
    enabled: isOpen && activeTab === "external",
  });

  // Fetch external services
  const { data: externalServices = [], isLoading: isLoadingServices } = useQuery<Service[]>({
    queryKey: ["/api/external-prompts/services"],
    enabled: isOpen && activeTab === "external",
  });

  // Fetch local prompts (existing)
  const { data: localPrompts = [], isLoading: isLoadingLocal } = useQuery({
    queryKey: ["/api/prompts"],
    enabled: isOpen && activeTab === "local",
  });

  const filteredExternalPrompts = externalPrompts.filter((prompt: ExternalPrompt) => {
    const matchesSearch = prompt.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         prompt.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         prompt.content.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesService = selectedService === "all" || prompt.service === selectedService;
    return matchesSearch && matchesService && prompt.status === 'active';
  });

  const filteredLocalPrompts = (localPrompts as any[]).filter((prompt: any) => {
    const matchesSearch = prompt.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         prompt.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         prompt.tags?.some((tag: string) => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedService === "all" || prompt.category === selectedService;
    return matchesSearch && matchesCategory;
  });

  const localCategories = (localPrompts as any[]).reduce((acc: string[], p: any) => {
    if (!acc.includes(p.category)) {
      acc.push(p.category);
    }
    return acc;
  }, []);

  const handleSelectExternalPrompt = (prompt: ExternalPrompt) => {
    onSelectPrompt(prompt.content, 'external');
    setIsOpen(false);
  };

  const handleSelectLocalPrompt = (prompt: any) => {
    onSelectPrompt(prompt.content, 'local');
    setIsOpen(false);
  };

  const handleCopyPrompt = (content: string, id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const defaultTrigger = (
    <Button variant="outline" size="sm" className="flex items-center gap-2">
      <Globe className="h-4 w-4" />
      Browse All Prompts
    </Button>
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Select a Prompt
          </DialogTitle>
          <DialogDescription>
            Choose from your local prompts or browse the external prompt library.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "local" | "external")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="external" className="flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              External Library
            </TabsTrigger>
            <TabsTrigger value="local" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Local Prompts
            </TabsTrigger>
          </TabsList>

          <div className="flex gap-4 items-center mb-4 mt-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search prompts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedService} onValueChange={setSelectedService}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {activeTab === "external" 
                  ? externalServices.map((service) => (
                      <SelectItem key={service.id} value={service.name}>
                        {service.name}
                      </SelectItem>
                    ))
                  : localCategories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))
                }
              </SelectContent>
            </Select>
          </div>

          <TabsContent value="external" className="mt-0">
            <ScrollArea className="h-96">
              {isLoadingExternal || isLoadingServices ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[...Array(6)].map((_, i) => (
                    <Card key={i} className="animate-pulse">
                      <CardHeader>
                        <div className="h-4 bg-muted rounded w-3/4"></div>
                        <div className="h-3 bg-muted rounded w-1/2"></div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="h-3 bg-muted rounded"></div>
                          <div className="h-3 bg-muted rounded w-5/6"></div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : filteredExternalPrompts.length === 0 ? (
                <div className="text-center py-8">
                  <Cloud className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-muted-foreground">No external prompts found</h3>
                  <p className="text-sm text-muted-foreground">
                    {searchTerm || selectedService !== "all"
                      ? "Try adjusting your search or filter criteria"
                      : "No external prompts available"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredExternalPrompts.map((prompt: ExternalPrompt) => (
                    <Card 
                      key={prompt.id} 
                      className="cursor-pointer hover:shadow-md transition-shadow border-2 hover:border-primary/50"
                      onClick={() => handleSelectExternalPrompt(prompt)}
                    >
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-start justify-between">
                          <span className="line-clamp-1 flex items-center gap-2">
                            <Cloud className="h-3 w-3 text-blue-500" />
                            {prompt.name}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => handleCopyPrompt(prompt.content, prompt.id, e)}
                            className="h-6 w-6 p-0 ml-2 flex-shrink-0"
                          >
                            {copiedId === prompt.id ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </CardTitle>
                        <CardDescription>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {prompt.service}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Used {prompt.apiCalls} times
                            </span>
                          </div>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                          {prompt.description}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {prompt.content}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="local" className="mt-0">
            <ScrollArea className="h-96">
              {isLoadingLocal ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[...Array(4)].map((_, i) => (
                    <Card key={i} className="animate-pulse">
                      <CardHeader>
                        <div className="h-4 bg-muted rounded w-3/4"></div>
                        <div className="h-3 bg-muted rounded w-1/2"></div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="h-3 bg-muted rounded"></div>
                          <div className="h-3 bg-muted rounded w-5/6"></div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : filteredLocalPrompts.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-muted-foreground">No local prompts found</h3>
                  <p className="text-sm text-muted-foreground">
                    {searchTerm || selectedService !== "all"
                      ? "Try adjusting your search or filter criteria"
                      : "No local prompts available"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredLocalPrompts.map((prompt: any) => (
                    <Card 
                      key={prompt.id} 
                      className="cursor-pointer hover:shadow-md transition-shadow border-2 hover:border-primary/50"
                      onClick={() => handleSelectLocalPrompt(prompt)}
                    >
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-start justify-between">
                          <span className="line-clamp-1 flex items-center gap-2">
                            <Database className="h-3 w-3 text-green-500" />
                            {prompt.title}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => handleCopyPrompt(prompt.content, prompt.id, e)}
                            className="h-6 w-6 p-0 ml-2 flex-shrink-0"
                          >
                            {copiedId === prompt.id ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </CardTitle>
                        <CardDescription>
                          <Badge variant="secondary" className="text-xs">
                            {prompt.category}
                          </Badge>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <p className="text-xs text-muted-foreground line-clamp-3 mb-2">
                          {prompt.content}
                        </p>
                        {prompt.tags && prompt.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {prompt.tags.slice(0, 3).map((tag: string, index: number) => (
                              <Badge key={index} variant="outline" className="text-xs px-1 py-0">
                                {tag}
                              </Badge>
                            ))}
                            {prompt.tags.length > 3 && (
                              <Badge variant="outline" className="text-xs px-1 py-0">
                                +{prompt.tags.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}