import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { BookOpen, Search, Copy, Check } from "lucide-react";
import { type Prompt } from "@shared/schema";

interface PromptSelectorProps {
  onSelectPrompt: (prompt: string) => void;
  trigger?: React.ReactNode;
}

export function PromptSelector({ onSelectPrompt, trigger }: PromptSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const { data: prompts = [], isLoading } = useQuery<Prompt[]>({
    queryKey: ["/api/prompts"],
  });

  const filteredPrompts = (prompts as Prompt[]).filter((prompt: Prompt) => {
    const matchesSearch = prompt.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         prompt.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         prompt.tags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === "all" || prompt.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = (prompts as Prompt[]).reduce((acc: string[], p: Prompt) => {
    if (!acc.includes(p.category)) {
      acc.push(p.category);
    }
    return acc;
  }, []);

  const handleSelectPrompt = (prompt: Prompt) => {
    onSelectPrompt(prompt.content);
    setIsOpen(false);
  };

  const handleCopyPrompt = (prompt: Prompt, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(prompt.content);
    setCopiedId(prompt.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const defaultTrigger = (
    <Button variant="outline" size="sm" className="flex items-center gap-2">
      <BookOpen className="h-4 w-4" />
      Browse Prompts
    </Button>
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Select a Prompt
          </DialogTitle>
          <DialogDescription>
            Choose from your saved prompts to use in your conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 items-center mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search prompts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ScrollArea className="h-96">
          {isLoading ? (
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
          ) : filteredPrompts.length === 0 ? (
            <div className="text-center py-8">
              <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-muted-foreground">No prompts found</h3>
              <p className="text-sm text-muted-foreground">
                {searchTerm || selectedCategory !== "all"
                  ? "Try adjusting your search or filter criteria"
                  : "No prompts available"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredPrompts.map((prompt: Prompt) => (
                <Card 
                  key={prompt.id} 
                  className="cursor-pointer hover:shadow-md transition-shadow border-2 hover:border-primary/50"
                  onClick={() => handleSelectPrompt(prompt)}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-start justify-between">
                      <span className="line-clamp-1">{prompt.title}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => handleCopyPrompt(prompt, e)}
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
                        {prompt.tags.slice(0, 3).map((tag, index) => (
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
      </DialogContent>
    </Dialog>
  );
}