// Utility function to strip markdown formatting and return plain text
export function stripMarkdown(text: string): string {
  if (!text) return '';
  
  return text
    // Remove headers (### Header -> Header)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold (**text** or __text__ -> text)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    // Remove italic (*text* or _text_ -> text)
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    // Remove strikethrough (~~text~~ -> text)
    .replace(/~~(.*?)~~/g, '$1')
    // Remove inline code (`code` -> code)
    .replace(/`([^`]+)`/g, '$1')
    // Remove code blocks (```code``` -> code)
    .replace(/```[\s\S]*?```/g, (match) => {
      return match.replace(/```(\w+)?\n?/g, '').replace(/```/g, '');
    })
    // Remove links ([text](url) -> text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images (![alt](url) -> alt)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove horizontal rules (--- -> )
    .replace(/^---+$/gm, '')
    // Remove blockquotes (> text -> text)
    .replace(/^>\s?/gm, '')
    // Remove list markers (- item or * item or 1. item -> item)
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove tables (keep content, remove pipes)
    .replace(/\|/g, ' ')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Helper function to copy text to clipboard with success notification
export async function copyToClipboard(text: string, toast?: any): Promise<boolean> {
  try {
    const plainText = stripMarkdown(text);
    await navigator.clipboard.writeText(plainText);
    
    if (toast) {
      toast({
        title: "Copied to clipboard",
        description: "Plain text copied successfully",
      });
    }
    
    return true;
  } catch (error) {
    console.error('Failed to copy text:', error);
    
    if (toast) {
      toast({
        title: "Copy failed",
        description: "Could not copy text to clipboard",
        variant: "destructive",
      });
    }
    
    return false;
  }
}