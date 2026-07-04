import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Search, Copy, Check, Cloud, BarChart3, Database, Globe } from "lucide-react";
import { Link } from "wouter";

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

interface Stats {
  total: string;
  services: string;
  apiCalls: string;
  successRate: string;
}

export default function ExternalPromptsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedService, setSelectedService] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: prompts = [], isLoading: isLoadingPrompts } = useQuery<ExternalPrompt[]>({
    queryKey: ["/api/external-prompts"],
  });

  const { data: services = [], isLoading: isLoadingServices } = useQuery<Service[]>({
    queryKey: ["/api/external-prompts/services"],
  });

  const { data: stats, isLoading: isLoadingStats } = useQuery<Stats>({
    queryKey: ["/api/external-prompts/stats"],
  });

  const filteredPrompts = prompts.filter((prompt: ExternalPrompt) => {
    const matchesSearch = prompt.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         prompt.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         prompt.content.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesService = selectedService === "all" || prompt.service === selectedService;
    return matchesSearch && matchesService && prompt.status === 'active';
  });

  const handleCopyPrompt = (content: string, id: number) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({
      title: "Copied",
      description: "Prompt copied to clipboard",
    });
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Globe className="h-8 w-8" />
            External Prompt Library
          </h1>
          <p className="text-muted-foreground mt-2">
            Browse and use prompts from the external prompt server
          </p>
        </div>
        <Link href="/">
          <Button variant="outline">
            Back to Chat
          </Button>
        </Link>
      </div>

      <Tabs defaultValue="prompts" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="prompts" className="flex items-center gap-2">
            <Cloud className="h-4 w-4" />
            Prompts
          </TabsTrigger>
          <TabsTrigger value="services" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Services
          </TabsTrigger>
          <TabsTrigger value="stats" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Statistics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prompts" className="space-y-4">
          <div className="flex gap-4 items-center">
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
                <SelectValue placeholder="All services" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Services</SelectItem>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.name}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoadingPrompts ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                      <div className="h-3 bg-muted rounded w-4/6"></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPrompts.map((prompt: ExternalPrompt) => (
                <Card key={prompt.id} className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <CardTitle className="flex items-start justify-between">
                      <span className="flex items-center gap-2">
                        <Cloud className="h-4 w-4 text-blue-500" />
                        {prompt.name}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopyPrompt(prompt.content, prompt.id)}
                      >
                        {copiedId === prompt.id ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </CardTitle>
                    <CardDescription>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary">{prompt.service}</Badge>
                        <Badge variant="outline" className="text-xs">
                          v{prompt.version}
                        </Badge>
                      </div>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-3">
                      {prompt.description}
                    </p>
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <div className="flex justify-between">
                        <span>API Calls:</span>
                        <span>{prompt.apiCalls}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Last Used:</span>
                        <span>{formatDate(prompt.lastUsed)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Created By:</span>
                        <span>{prompt.createdBy}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {filteredPrompts.length === 0 && !isLoadingPrompts && (
            <div className="text-center py-12">
              <Cloud className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-muted-foreground">No prompts found</h3>
              <p className="text-sm text-muted-foreground">
                {searchTerm || selectedService !== "all"
                  ? "Try adjusting your search or filter criteria"
                  : "No external prompts available"}
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="services" className="space-y-4">
          {isLoadingServices ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-3 bg-muted rounded w-1/2"></div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {services.map((service: Service) => {
                const servicePrompts = prompts.filter(p => p.service === service.name);
                return (
                  <Card key={service.id} className="hover:shadow-md transition-shadow">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-green-500" />
                        {service.name}
                      </CardTitle>
                      <CardDescription>
                        {service.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Prompts:</span>
                          <span>{servicePrompts.length}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>Total API Calls:</span>
                          <span>{servicePrompts.reduce((sum, p) => sum + p.apiCalls, 0)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="stats" className="space-y-4">
          {isLoadingStats ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-8 bg-muted rounded w-1/2"></div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Total Prompts</CardTitle>
                  <CardDescription className="text-2xl font-bold">
                    {stats.total}
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Services</CardTitle>
                  <CardDescription className="text-2xl font-bold">
                    {stats.services}
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">API Calls</CardTitle>
                  <CardDescription className="text-2xl font-bold">
                    {stats.apiCalls}
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                  <CardDescription className="text-2xl font-bold">
                    {stats.successRate}
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          ) : (
            <div className="text-center py-12">
              <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-muted-foreground">Statistics unavailable</h3>
              <p className="text-sm text-muted-foreground">
                Unable to load statistics from the external prompt server
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}