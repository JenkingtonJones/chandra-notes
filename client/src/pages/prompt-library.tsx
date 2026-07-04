import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPromptSchema, type Prompt, type InsertPrompt } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, Copy, Edit, Trash2, BookOpen, Sparkles } from "lucide-react";

export default function PromptLibrary() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const { toast } = useToast();

  const { data: prompts = [], isLoading } = useQuery<Prompt[]>({
    queryKey: ["/api/prompts"],
  });

  const createPromptMutation = useMutation({
    mutationFn: async (data: InsertPrompt) => {
      const res = await apiRequest("POST", "/api/prompts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompts"] });
      setIsCreateDialogOpen(false);
      toast({
        title: "Success",
        description: "Prompt created successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create prompt",
        variant: "destructive",
      });
    },
  });

  const updatePromptMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertPrompt> }) => {
      const res = await apiRequest("PUT", `/api/prompts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompts"] });
      setEditingPrompt(null);
      toast({
        title: "Success",
        description: "Prompt updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update prompt",
        variant: "destructive",
      });
    },
  });

  const deletePromptMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/prompts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompts"] });
      toast({
        title: "Success",
        description: "Prompt deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete prompt",
        variant: "destructive",
      });
    },
  });

  const form = useForm<InsertPrompt>({
    resolver: zodResolver(insertPromptSchema),
    defaultValues: {
      title: "",
      content: "",
      category: "",
      tags: [],
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  });

  const editForm = useForm<InsertPrompt>({
    resolver: zodResolver(insertPromptSchema),
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

  const handleCreatePrompt = (data: InsertPrompt) => {
    createPromptMutation.mutate({
      ...data,
      createdAt: new Date().toISOString(),
    });
  };

  const handleUpdatePrompt = (data: InsertPrompt) => {
    if (editingPrompt) {
      updatePromptMutation.mutate({
        id: editingPrompt.id,
        data,
      });
    }
  };

  const handleCopyPrompt = (content: string) => {
    navigator.clipboard.writeText(content);
    toast({
      title: "Copied",
      description: "Prompt copied to clipboard",
    });
  };

  const handleEditPrompt = (prompt: Prompt) => {
    setEditingPrompt(prompt);
    editForm.reset({
      title: prompt.title,
      content: prompt.content,
      category: prompt.category,
      tags: prompt.tags || [],
      isActive: prompt.isActive,
      createdAt: prompt.createdAt,
    });
  };

  const handleDeletePrompt = (id: number) => {
    if (confirm("Are you sure you want to delete this prompt?")) {
      deletePromptMutation.mutate(id);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BookOpen className="h-8 w-8" />
            Prompt Library
          </h1>
          <p className="text-muted-foreground mt-2">
            Browse and manage your collection of AI prompts
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Prompt
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Prompt</DialogTitle>
              <DialogDescription>
                Add a new prompt to your library for future use.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleCreatePrompt)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter prompt title" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Development, Creative, Analysis" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Content</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Enter your prompt content..."
                          className="min-h-32"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tags"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tags (comma-separated)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="tag1, tag2, tag3"
                          value={field.value?.join(", ") || ""}
                          onChange={(e) => field.onChange(e.target.value.split(",").map(tag => tag.trim()).filter(Boolean))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createPromptMutation.isPending}>
                    {createPromptMutation.isPending ? "Creating..." : "Create Prompt"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

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
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by category" />
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

      {isLoading ? (
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
          {filteredPrompts.map((prompt: Prompt) => (
            <Card key={prompt.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-start justify-between">
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    {prompt.title}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCopyPrompt(prompt.content)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEditPrompt(prompt)}
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeletePrompt(prompt.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardTitle>
                <CardDescription>
                  <Badge variant="secondary">{prompt.category}</Badge>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3 line-clamp-3">
                  {prompt.content}
                </p>
                {prompt.tags && prompt.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {prompt.tags.map((tag, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {filteredPrompts.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">No prompts found</h3>
          <p className="text-sm text-muted-foreground">
            {searchTerm || selectedCategory !== "all"
              ? "Try adjusting your search or filter criteria"
              : "Create your first prompt to get started"}
          </p>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingPrompt} onOpenChange={() => setEditingPrompt(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Prompt</DialogTitle>
            <DialogDescription>
              Make changes to your prompt.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleUpdatePrompt)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter prompt title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Development, Creative, Analysis" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Content</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Enter your prompt content..."
                        className="min-h-32"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tags (comma-separated)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="tag1, tag2, tag3"
                        value={field.value?.join(", ") || ""}
                        onChange={(e) => field.onChange(e.target.value.split(",").map(tag => tag.trim()).filter(Boolean))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingPrompt(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updatePromptMutation.isPending}>
                  {updatePromptMutation.isPending ? "Updating..." : "Update Prompt"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}