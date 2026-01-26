# Vlad Subagent for OpenCode

This directory contains the configuration for the Vlad subagent, which provides access to Vlad's Notion knowledge base and templates through OpenCode.

## Setup

### 1. MCP Server Configuration

The Notion MCP server is configured in `opencode.json` at the project root. The server endpoint is:
- **Production**: `https://vlad.chat/api/mcp`
- **Local Development**: Use ngrok to expose your local server, then update the URL in `opencode.json`

For local development:
1. Start your Next.js dev server: `bun run dev`
2. In another terminal, start ngrok: `ngrok http 3000`
3. Update `opencode.json` with your ngrok URL:
   ```json
   {
     "mcp": {
       "vlad-notion": {
         "type": "remote",
         "url": "https://your-ngrok-url.ngrok.io/api/mcp",
         "enabled": true
       }
     }
   }
   ```

### 2. Agent Configuration

The Vlad subagent is configured in `.opencode/agents/vlad.md`. It includes:
- Full system prompts from `lib/ai.ts`
- Read-only access to Notion tools
- No file write/edit permissions (knowledge base access only)

## Usage

### Invoking the Agent

In any OpenCode session, you can invoke the Vlad subagent by:

1. **Manual invocation**: Type `@vlad` followed by your question
   ```
   @vlad what are your latest projects?
   ```

2. **Auto-invocation**: Primary agents can automatically invoke Vlad when they detect questions about:
   - Vlad's knowledge base
   - Notion templates
   - Productivity systems
   - Vlad's projects or work

### Available Tools

The Vlad subagent has access to these Notion MCP tools:
- `notion-search`: Search pages and databases in the Notion workspace
- `notion-get-database`: Retrieve database schema and properties
- `notion-fetch`: Fetch page content and convert to markdown
- `notion-fetch-database-entry`: Fetch a database entry with all properties

## Testing

To test the integration:

1. **Verify MCP server is accessible**:
   ```bash
   curl https://vlad.chat/api/mcp
   ```

2. **Check OpenCode can see the MCP server**:
   ```bash
   opencode mcp list
   ```

3. **Test the subagent**:
   - Start an OpenCode session
   - Type `@vlad help` or `@vlad what templates do you have?`
   - Verify the agent responds with Vlad's personality and can access Notion tools

## Configuration Files

- **Agent**: `.opencode/agents/vlad.md` - Subagent configuration with system prompts
- **MCP Server**: `opencode.json` - Remote MCP server configuration
- **MCP Implementation**: `app/api/mcp/route.ts` - The actual MCP server endpoint

## Notes

- The MCP server must be publicly accessible for OpenCode to connect to it
- For production, ensure your production URL is set in `opencode.json`
- The agent is read-only by design - it cannot modify files or run bash commands
- All Notion tools are enabled via the `notion-*` wildcard pattern
