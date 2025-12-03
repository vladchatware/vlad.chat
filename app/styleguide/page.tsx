'use client';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageAvatar } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput,
  ToolInput,
} from '@/components/ai-elements/tool';
import { Fragment, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { Response } from '@/components/ai-elements/response';
import { CopyIcon, RefreshCcwIcon } from 'lucide-react';
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/source';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import { Loader } from '@/components/ai-elements/loader';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { Action, Actions } from '@/components/ai-elements/actions';

const models = [
  { name: 'GPT 5 mini', value: 'openai/gpt-5-mini' },
  { name: 'GPT 5', value: 'openai/gpt-5' },
];

const suggestions = [
  'Latest updates',
  'Roadmap',
  'Notion Templates',
];

export default function StyleguidePage() {
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(models[0].value);
  const { messages, sendMessage, status, error, regenerate } = useChat({
    onError: (error) => {
      console.log('error caught', error);
    },
  });

  const handleSubmit = async (message: { text: string }) => {
    if (!message.text) return;
    sendMessage(
      { text: message.text },
      {
        body: { model },
      },
    );
    setInput('');
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl py-8 px-4">
        <h1 className="text-4xl font-bold mb-2">AI Elements Styleguide</h1>
        <p className="text-muted-foreground mb-8">
          A comprehensive guide to all components from useChat and ai-elements
        </p>

        {/* Status Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">useChat Status States</h2>
          <div className="space-y-4 p-4 border rounded-lg">
            <div>
              <strong>Current Status:</strong> <code className="bg-muted px-2 py-1 rounded">{status || 'idle'}</code>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                <strong>Possible states:</strong> idle, submitted, streaming, error
              </div>
              {error && (
                <div className="text-sm text-destructive">
                  <strong>Error:</strong> {error.message}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Conversation Components */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Conversation Components</h2>
          <div className="border rounded-lg p-4 bg-muted/20">
            <Conversation>
              <ConversationContent>
                <div className="space-y-4">
                  <Message from="assistant">
                    <MessageContent>
                      <Response>This is an assistant message in a conversation.</Response>
                    </MessageContent>
                  </Message>
                  <Message from="user">
                    <MessageContent>
                      <Response>This is a user message.</Response>
                    </MessageContent>
                  </Message>
                </div>
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </div>
        </section>

        {/* Empty State */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Conversation Empty State</h2>
          <div className="border rounded-lg h-64 bg-muted/20">
            <ConversationEmptyState
              title="No messages yet"
              description="Start a conversation to see messages here"
            />
          </div>
        </section>

        {/* Message Variants */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Message Variants</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <Message from="assistant">
              <MessageContent variant="contained">
                <Response>Contained variant (default) - Assistant message</Response>
              </MessageContent>
            </Message>
            <Message from="user">
              <MessageContent variant="contained">
                <Response>Contained variant - User message</Response>
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent variant="flat">
                <Response>Flat variant - Assistant message</Response>
              </MessageContent>
            </Message>
            <Message from="user">
              <MessageContent variant="flat">
                <Response>Flat variant - User message</Response>
              </MessageContent>
            </Message>
          </div>
        </section>

        {/* Message with Avatar */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Message with Avatar</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <Message from="assistant">
              <MessageAvatar src="https://github.com/vercel.png" name="Assistant" />
              <MessageContent>
                <Response>Message with avatar</Response>
              </MessageContent>
            </Message>
            <Message from="user">
              <MessageAvatar src="https://github.com/vercel.png" name="User" />
              <MessageContent>
                <Response>User message with avatar</Response>
              </MessageContent>
            </Message>
          </div>
        </section>

        {/* Response Component */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Response Component</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <Message from="assistant">
              <MessageContent>
                <Response>
                  This is a Response component that supports markdown formatting.
                  You can use **bold**, *italic*, and [links](https://example.com).
                </Response>
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent>
                <Response>
                  Multiple Response components can be used in a single message:
                </Response>
                <Response>First response</Response>
                <Response>Second response</Response>
                <Response>Third response</Response>
              </MessageContent>
            </Message>
          </div>
        </section>

        {/* Markdown Features */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Markdown Features</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <Message from="assistant">
              <MessageContent>
                <Response>
                  {`# Headers

You can use headers with # symbols:

# H1 Header
## H2 Header
### H3 Header
#### H4 Header

---

## Lists

### Unordered Lists
- Item one
- Item two
  - Nested item
  - Another nested item
- Item three

### Ordered Lists
1. First item
2. Second item
3. Third item
   1. Nested numbered item
   2. Another nested item

---

## Text Formatting

- **Bold text**
- *Italic text*
- ***Bold and italic***
- ~~Strikethrough~~
- \`Inline code\`
- [Links](https://example.com)

---

## Blockquotes

> This is a blockquote. It can span multiple lines.
> 
> You can nest blockquotes too:
> > Nested quote
> > Another line

---

## Code Blocks

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

\`\`\`python
def greet(name):
    return f"Hello, {name}!"
\`\`\`

---

## Tables

| Feature | Supported | Notes |
|---------|-----------|-------|
| Headers | Yes | # ## ### |
| Lists | Yes | Ordered and unordered |
| Tables | Yes | GitHub Flavored Markdown |
| Code | Yes | Inline and blocks |
| Images | Yes | Standard markdown syntax |

---

## Task Lists

- [x] Completed task
- [x] Another completed task
- [ ] Incomplete task
- [ ] Another incomplete task

---

## Math (LaTeX)

Inline math: $E = mc^2$

Block math:

$$
\\sum_{i=1}^{n} x_i = x_1 + x_2 + \\cdots + x_n
$$`}
                </Response>
              </MessageContent>
            </Message>
          </div>
        </section>

        {/* Images in Responses */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Images in Responses</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <Message from="assistant">
              <MessageContent>
                <Response>
                  Images can be included in markdown responses using standard markdown syntax:
                  
                  ![Random Nature Image](https://picsum.photos/800/400?random=1)
                  
                  The Response component uses Streamdown which supports standard markdown image syntax.
                </Response>
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent>
                <Response>
                  You can also include images with regular HTML img tags directly in MessageContent:
                </Response>
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent variant="flat">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src="https://picsum.photos/600/300?random=2" 
                  alt="Random image example" 
                  className="rounded-md my-2 max-w-full"
                />
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent>
                <Response>
                  This approach gives you more control over styling and attributes.
                </Response>
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent>
                <Response>
                  Multiple images can be displayed together:
                </Response>
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent variant="flat">
                <div className="grid grid-cols-2 gap-2 my-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src="https://picsum.photos/400/300?random=3" 
                    alt="Random image 1" 
                    className="rounded-md w-full"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src="https://picsum.photos/400/300?random=4" 
                    alt="Random image 2" 
                    className="rounded-md w-full"
                  />
                </div>
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent>
                <Response>
                  Images can be arranged in grids or other layouts.
                </Response>
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent>
                <Response>
                  For AI-generated images (base64 from Experimental_GeneratedImage), use the Image component from ai-elements. The Image component automatically converts base64 data to data URIs. It&apos;s specifically designed for images generated by AI models that return Experimental_GeneratedImage objects from the AI SDK.
                </Response>
                <Response>
                  {`Example usage:

\`\`\`tsx
<Image base64={image.base64} mediaType={image.mediaType} alt="Generated image" />
\`\`\``}
                </Response>
              </MessageContent>
            </Message>
          </div>
        </section>

        {/* Sources */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Sources Component</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <Sources>
              <SourcesTrigger count={3} />
              <SourcesContent>
                <Source href="https://example.com" title="Example Source 1" />
                <Source href="https://example.com" title="Example Source 2" />
                <Source href="https://example.com" title="Example Source 3" />
              </SourcesContent>
            </Sources>
            <Message from="assistant">
              <MessageContent>
                <Response>Message with sources above</Response>
              </MessageContent>
            </Message>
          </div>
        </section>

        {/* Reasoning */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Reasoning Component</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <Reasoning defaultOpen={true}>
              <ReasoningTrigger />
              <ReasoningContent>
                This is reasoning content that can be collapsed. It shows the AI&apos;s
                thought process before generating a response.
              </ReasoningContent>
            </Reasoning>
            <Message from="assistant">
              <MessageContent>
                <Response>Message with reasoning above</Response>
              </MessageContent>
            </Message>
            <Reasoning defaultOpen={false} isStreaming={false}>
              <ReasoningTrigger />
              <ReasoningContent>
                This reasoning is closed by default. Click to expand.
              </ReasoningContent>
            </Reasoning>
            <Reasoning defaultOpen={true} isStreaming={true}>
              <ReasoningTrigger />
              <ReasoningContent>
                This reasoning is currently streaming (isStreaming=true)
              </ReasoningContent>
            </Reasoning>
          </div>
        </section>

        {/* Tools */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Tool Component</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <Tool defaultOpen={true}>
              <ToolHeader
                type="tool-notion"
                state="output-available"
                title="Notion Tool"
              />
              <ToolContent>
                <ToolInput input={{ query: 'Search for documents' }} />
                <ToolOutput output="Found 3 documents" errorText="" />
              </ToolContent>
            </Tool>
            <Tool defaultOpen={false}>
              <ToolHeader
                type="tool-notion"
                state="input-streaming"
                title="Tool Pending"
              />
              <ToolContent>
                <ToolInput input={{ query: 'Processing...' }} />
              </ToolContent>
            </Tool>
            <Tool defaultOpen={true}>
              <ToolHeader
                type="tool-notion"
                state="output-error"
                title="Tool Error"
              />
              <ToolContent>
                <ToolInput input={{ query: 'Failed query' }} />
                <ToolOutput output={null} errorText="An error occurred" />
              </ToolContent>
            </Tool>
            <Tool defaultOpen={true}>
              <ToolHeader
                type="tool-notion"
                state="input-available"
                title="Tool Running"
              />
              <ToolContent>
                <ToolInput input={{ query: 'Running...' }} />
              </ToolContent>
            </Tool>
          </div>
        </section>

        {/* Actions */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Actions Component</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <Message from="assistant">
              <MessageContent>
                <Response>Message with actions below</Response>
              </MessageContent>
            </Message>
            <Actions>
              <Action
                onClick={() => {}}
                label="Retry"
                tooltip="Regenerate response"
              >
                <RefreshCcwIcon className="size-3" />
              </Action>
              <Action
                onClick={() => {}}
                label="Copy"
                tooltip="Copy to clipboard"
              >
                <CopyIcon className="size-3" />
              </Action>
            </Actions>
          </div>
        </section>

        {/* Loader */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Loader Component</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <div className="flex justify-center">
              <Loader />
            </div>
              <p className="text-sm text-muted-foreground text-center">
              Loader shown when status is &apos;submitted&apos;
            </p>
          </div>
        </section>

        {/* Suggestions */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Suggestions Component</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <Suggestions>
              {suggestions.map((suggestion) => (
                <Suggestion
                  key={suggestion}
                  suggestion={suggestion}
                  onClick={() => {}}
                />
              ))}
            </Suggestions>
            <Suggestions>
              <Suggestion
                suggestion="Error suggestion - click to regenerate"
                onClick={() => {}}
              />
            </Suggestions>
          </div>
        </section>

        {/* Prompt Input */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Prompt Input Component</h2>
          <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
            <PromptInput onSubmit={handleSubmit}>
              <PromptInputBody>
                <PromptInputTextarea
                  onChange={(e) => setInput(e.target.value)}
                  value={input}
                  placeholder="Type a message..."
                />
              </PromptInputBody>
              <PromptInputToolbar>
                <PromptInputTools>
                  <PromptInputModelSelect
                    onValueChange={(value) => setModel(value)}
                    value={model}
                  >
                    <PromptInputModelSelectTrigger>
                      <PromptInputModelSelectValue />
                    </PromptInputModelSelectTrigger>
                    <PromptInputModelSelectContent>
                      {models.map((m) => (
                        <PromptInputModelSelectItem key={m.value} value={m.value}>
                          {m.name}
                        </PromptInputModelSelectItem>
                      ))}
                    </PromptInputModelSelectContent>
                  </PromptInputModelSelect>
                </PromptInputTools>
                <PromptInputSubmit disabled={!input} status={status} />
              </PromptInputToolbar>
            </PromptInput>
          </div>
        </section>

        {/* Complete Chat Example */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Complete Chat Example</h2>
          <div className="border rounded-lg bg-muted/20">
            <Conversation>
              <ConversationContent>
                <Message from="assistant">
                  <MessageContent>
                    <Response>Hello! I&apos;m an AI assistant.</Response>
                  </MessageContent>
                </Message>
                {messages.map((message, messageIndex) => (
                  <div key={message.id}>
                    {message.role === 'assistant' &&
                      message.parts.filter((part) => part.type === 'source-url').length > 0 && (
                        <Sources>
                          <SourcesTrigger
                            count={
                              message.parts.filter((part) => part.type === 'source-url').length
                            }
                          />
                          {message.parts
                            .filter((part) => part.type === 'source-url')
                            .map((part, i) => (
                              <SourcesContent key={`${message.id}-${i}`}>
                                <Source href={part.url} title={part.url} />
                              </SourcesContent>
                            ))}
                        </Sources>
                      )}
                    {message.parts.map((part, partIndex) => {
                      switch (part.type) {
                        case 'text':
                          return (
                            <Fragment key={`${message.id}-${partIndex}`}>
                              <Message from={message.role}>
                                <MessageContent>
                                  <Response>{part.text}</Response>
                                </MessageContent>
                              </Message>
                              {message.role === 'assistant' &&
                                messageIndex === messages.length - 1 &&
                                partIndex === message.parts.length - 1 && (
                                  <Actions className="-mt-3">
                                    <Action
                                      onClick={() => {
                                        regenerate({ body: { model } });
                                      }}
                                      label="Retry"
                                    >
                                      <RefreshCcwIcon className="size-3" />
                                    </Action>
                                    <Action
                                      onClick={() => navigator.clipboard.writeText(part.text)}
                                      label="Copy"
                                    >
                                      <CopyIcon className="size-3" />
                                    </Action>
                                  </Actions>
                                )}
                            </Fragment>
                          );
                        case 'reasoning':
                          return (
                            <Reasoning
                              key={`${message.id}-${partIndex}`}
                              className="w-full"
                              isStreaming={
                                status === 'streaming' &&
                                partIndex === message.parts.length - 1 &&
                                message.id === messages.at(-1)?.id
                              }
                            >
                              <ReasoningTrigger />
                              <ReasoningContent>{part.text}</ReasoningContent>
                            </Reasoning>
                          );
                        case 'dynamic-tool': {
                          const content =
                            (part.output as { content: [{ text: string }] })?.content[0]?.text ??
                            [];
                          return (
                            <Tool key={`${message.id}-${partIndex}`} defaultOpen={false}>
                              <ToolHeader type={'tool-notion'} state={part.state} />
                              <ToolContent>
                                <ToolInput input={part.input} />
                                <ToolOutput output={content} errorText={part.errorText} />
                              </ToolContent>
                            </Tool>
                          );
                        }
                        default:
                          return null;
                      }
                    })}
                  </div>
                ))}
                {status === 'submitted' && (
                  <div className="flex justify-center py-4">
                    <Loader />
                  </div>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
            <div className="p-4 border-t">
              {error && (
                <Suggestions>
                  <Suggestion
                    suggestion={`An error occurred: ${error.message}. Regenerate.`}
                    onClick={() => regenerate({ body: { model } })}
                  />
                </Suggestions>
              )}
              <Suggestions>
                {suggestions.map((suggestion) => (
                  <Suggestion
                    key={suggestion}
                    onClick={() => {
                      sendMessage(
                        { text: suggestion },
                        {
                          body: { model },
                        },
                      );
                    }}
                    suggestion={suggestion}
                  />
                ))}
              </Suggestions>
              <PromptInput onSubmit={handleSubmit} className="mt-4">
                <PromptInputBody>
                  <PromptInputTextarea
                    onChange={(e) => setInput(e.target.value)}
                    value={input}
                  />
                </PromptInputBody>
                <PromptInputToolbar>
                  <PromptInputTools>
                    <PromptInputModelSelect
                      onValueChange={(value) => setModel(value)}
                      value={model}
                    >
                      <PromptInputModelSelectTrigger>
                        <PromptInputModelSelectValue />
                      </PromptInputModelSelectTrigger>
                      <PromptInputModelSelectContent>
                        {models.map((m) => (
                          <PromptInputModelSelectItem key={m.value} value={m.value}>
                            {m.name}
                          </PromptInputModelSelectItem>
                        ))}
                      </PromptInputModelSelectContent>
                    </PromptInputModelSelect>
                  </PromptInputTools>
                  <PromptInputSubmit disabled={!input && !status} status={status} />
                </PromptInputToolbar>
              </PromptInput>
            </div>
          </div>
        </section>

        {/* Message Parts Reference */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Message Parts Reference</h2>
          <div className="border rounded-lg p-4 bg-muted/20">
            <div className="space-y-4 text-sm">
              <div>
                <strong>Message parts from useChat:</strong>
                <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                  <li><code>text</code> - Text content from the message</li>
                  <li><code>reasoning</code> - AI reasoning/thinking process</li>
                  <li><code>dynamic-tool</code> - Tool execution results</li>
                  <li><code>source-url</code> - Source URLs for citations</li>
                </ul>
              </div>
              <div>
                <strong>Message roles:</strong>
                <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                  <li><code>user</code> - User messages</li>
                  <li><code>assistant</code> - Assistant/AI messages</li>
                </ul>
              </div>
              <div>
                <strong>Tool states:</strong>
                <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                  <li><code>input-streaming</code> - Tool input is being streamed</li>
                  <li><code>input-available</code> - Tool is running</li>
                  <li><code>output-available</code> - Tool completed successfully</li>
                  <li><code>output-error</code> - Tool encountered an error</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

