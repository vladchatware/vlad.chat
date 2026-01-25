/**
 * Utilities for formatting and extracting tool output content
 */

export interface ToolCall {
  name: string;
  input: unknown;
}

/**
 * Format a tool call input to a human-readable description
 */
export function formatToolInput(input: unknown): string {
  if (!input) return '';
  
  if (typeof input === 'string') {
    return input.slice(0, 50);
  }
  
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    
    // Common input patterns
    if (obj.filePath) return String(obj.filePath).split('/').pop() || String(obj.filePath);
    if (obj.path) return String(obj.path).split('/').pop() || String(obj.path);
    if (obj.command) return String(obj.command).slice(0, 60);
    if (obj.pattern) return `"${obj.pattern}"`;
    if (obj.query) return `"${obj.query}"`;
    if (obj.description) return String(obj.description);
    
    // Fallback to first string value
    const firstVal = Object.values(obj).find(v => typeof v === 'string');
    if (firstVal) return String(firstVal).slice(0, 50);
  }
  
  return '';
}

/**
 * Format a list of tool calls as a compact display string
 */
export function formatToolCalls(calls: ToolCall[]): string {
  return calls
    .filter(tc => tc && tc.name)
    .map(tc => {
      const displayName = tc.name.charAt(0).toUpperCase() + tc.name.slice(1);
      const desc = formatToolInput(tc.input);
      return desc ? `→ ${displayName} ${desc}` : `→ ${displayName}`;
    })
    .join('\n');
}

/**
 * Extract text content from OpenCode tool output
 */
export function extractOpenCodeContent(output: unknown): {
  textContent: string;
  toolCalls: ToolCall[];
  stepCount: number;
  isError: boolean;
} {
  if (!output || typeof output !== 'object') {
    return { textContent: '', toolCalls: [], stepCount: 0, isError: false };
  }
  
  const obj = output as Record<string, unknown>;
  
  const toolCalls = (obj.toolCalls as ToolCall[] | undefined) ?? [];
  const stepCount = (obj.steps as number) ?? (obj.stepCount as number) ?? 0;
  
  // Check if this is an actual error (has error field but no result/fullText)
  const hasError = typeof obj.error === 'string' && obj.error.length > 0;
  const hasSuccess = typeof obj.result === 'string' || typeof obj.fullText === 'string';
  const isError = hasError && !hasSuccess;
  
  // Check multiple possible locations for text content
  const textContent = 
    (typeof obj.result === 'string' ? obj.result : '') ||
    (typeof obj.fullText === 'string' ? obj.fullText : '') ||
    (typeof obj.text === 'string' ? obj.text : '') ||
    (typeof obj.partial === 'string' ? obj.partial : '') ||
    (typeof obj.error === 'string' ? obj.error : '');
  
  return { textContent, toolCalls, stepCount, isError };
}

/**
 * Extract text content from Notion MCP tool output
 */
export function extractNotionContent(output: unknown): string {
  if (!output || typeof output !== 'object') return '';
  
  const obj = output as Record<string, unknown>;
  
  if ('content' in obj && Array.isArray(obj.content)) {
    const firstContent = obj.content[0];
    if (firstContent && typeof firstContent === 'object' && 'text' in firstContent) {
      return typeof (firstContent as { text: unknown }).text === 'string' 
        ? (firstContent as { text: string }).text 
        : '';
    }
  }
  
  return '';
}

/**
 * Extract content based on tool type
 */
export function extractToolContent(output: unknown, toolName: string): string {
  if (toolName === 'coder') {
    const { textContent } = extractOpenCodeContent(output);
    return textContent;
  }
  
  return extractNotionContent(output);
}
