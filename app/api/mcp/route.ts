import { z } from "zod"
import notion from "@/lib/notion"
import { createMcpHandler } from "mcp-handler"
import { DataSourceObjectResponse, PageObjectResponse } from "@notionhq/client";

// Helper function to convert Notion blocks to markdown
async function convertBlocksToMarkdown(blockId: string, depth = 0): Promise<string> {
  const blocks = await notion.blocks.children.list({ block_id: blockId })
  let markdown = ''

  for (const block of blocks.results) {
    if (!('type' in block)) continue

    const indent = '  '.repeat(depth)

    switch (block.type) {
      case 'paragraph':
        if (block.paragraph.rich_text.length > 0) {
          const text = block.paragraph.rich_text.map(rt => rt.plain_text).join('')
          markdown += `${indent}${text}\n\n`
        } else {
          markdown += `${indent}\n\n`
        }
        break

      case 'heading_1':
        const h1Text = block.heading_1.rich_text.map(rt => rt.plain_text).join('')
        markdown += `${indent}# ${h1Text}\n\n`
        break

      case 'heading_2':
        const h2Text = block.heading_2.rich_text.map(rt => rt.plain_text).join('')
        markdown += `${indent}## ${h2Text}\n\n`
        break

      case 'heading_3':
        const h3Text = block.heading_3.rich_text.map(rt => rt.plain_text).join('')
        markdown += `${indent}### ${h3Text}\n\n`
        break

      case 'bulleted_list_item':
        const bulletText = block.bulleted_list_item.rich_text.map(rt => rt.plain_text).join('')
        markdown += `${indent}- ${bulletText}\n`
        break

      case 'numbered_list_item':
        const numberText = block.numbered_list_item.rich_text.map(rt => rt.plain_text).join('')
        markdown += `${indent}1. ${numberText}\n`
        break

      case 'to_do':
        const todoText = block.to_do.rich_text.map(rt => rt.plain_text).join('')
        const checkbox = block.to_do.checked ? '[x]' : '[ ]'
        markdown += `${indent}${checkbox} ${todoText}\n`
        break

      case 'toggle':
        const toggleText = block.toggle.rich_text.map(rt => rt.plain_text).join('')
        markdown += `${indent}<details>\n${indent}<summary>${toggleText}</summary>\n`
        break

      case 'code':
        const codeText = block.code.rich_text.map(rt => rt.plain_text).join('')
        const language = block.code.language
        markdown += `${indent}\`\`\`${language}\n${codeText}\n${indent}\`\`\`\n\n`
        break

      case 'quote':
        const quoteText = block.quote.rich_text.map(rt => rt.plain_text).join('')
        markdown += `${indent}> ${quoteText}\n\n`
        break

      case 'callout':
        const calloutText = block.callout.rich_text.map(rt => rt.plain_text).join('')
        const icon = block.callout.icon?.type === 'emoji' ? block.callout.icon.emoji : '💡'
        markdown += `${indent}> ${icon} ${calloutText}\n\n`
        break

      case 'divider':
        markdown += `${indent}---\n\n`
        break

      case 'table':
        // For tables, we'll need to handle them specially
        markdown += `${indent}[Table content - not fully supported in markdown conversion]\n\n`
        break

      default:
        // For unsupported block types, try to extract any text content
        if ('rich_text' in block && Array.isArray(block.rich_text)) {
          const text = block.rich_text.map(rt => rt.plain_text).join('')
          if (text) {
            markdown += `${indent}${text}\n\n`
          }
        }
    }

    // Recursively process child blocks
    if (block.has_children) {
      const childMarkdown = await convertBlocksToMarkdown(block.id, depth + 1)
      markdown += childMarkdown
    }
  }

  return markdown
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'notion-search',
      `Searches all parent or child pages and databases that have been shared with an integration.

Returns all pages or databases, excluding duplicated linked databases, that have titles that include the query param. If no query param is provided, then the response contains all pages or databases that have been shared with the integration. The results adhere to any limitations related to an integration's capabilities.

To limit the request to search only pages or to search only databases, use the filter param.`,
      {
        sort: z.object({
          timestamp: z.any().describe('The name of the timestamp to sort against. Possible values include last_edited_time.'),
          direction: z.enum(["ascending", "descending"]).describe('The direction to sort. Possible values include ascending and descending.')
        }).default({ direction: 'ascending' }).describe('A set of criteria, direction and timestamp keys, that orders the results. The only supported timestamp value is "last_edited_time". Supported direction values are "ascending" and "descending". If sort is not provided, then the most recently edited results are returned first.'),
        query: z.string().describe('Semantic search query over your entire Notion workspace and connected sources. For best results, dont provide more than one question per tool call.'),
        start_cursor: z.string().optional().describe('A cursor value returned in a previous response that If supplied, limits the response to results starting after the cursor. If not supplied, then the first page of results is returned.'),
        page_size: z.number().default(3).describe('The number of items from the full list to include in the response. Maximum: 100.'),
        filter: z.object({
          property: z.string().optional().describe('The name of the property to filter by. Currently the only property you can filter by is the object type. Possible values include object. Limitation: Currently the only filter allowed is object which will filter by type of object (either page or database)'),
          value: z.string().optional().describe('The value of the property to filter the results by. Possible values for object type include page or database. Limitation: Currently the only filter allowed is object which will filter by type of object (either page or database)')
        }).default({})
      },
      async ({ query, start_cursor }) => {
        const res = await notion.search({ query, start_cursor, page_size: 1 })
        const payload = res.results.map(result => {
          return {
            object: result.object,
            id: result.id,
            properties: (result as PageObjectResponse | DataSourceObjectResponse).properties
          }
        })
        const text = JSON.stringify(payload, null, 2)
        return {
          content: [{ type: 'text', text }]
        }
      }
    )
    server.tool(
      'notion-fetch',
      'Retrieves a Notion page and converts it to markdown format. This tool recursively fetches all blocks and their children to create a complete markdown representation of the page.',
      {
        page_id: z.string().describe('Identifier for a Notion page to retrieve.')
      },
      async ({ page_id }) => {
        try {
          // First, get the page to extract the title
          const page = await notion.pages.retrieve({ page_id })
          console.log('got page')

          let markdown = ''

          // Add page title if requested
          if ('properties' in page) {
            const titleProperty = Object.values(page.properties).find(prop =>
              prop.type === 'title'
            )
            if (titleProperty && titleProperty.type === 'title') {
              const title = titleProperty.title.map(rt => rt.plain_text).join('')
              markdown += `# ${title}\n\n`
            }
            console.log('got title')
          }

          // Convert all blocks to markdown
          const contentMarkdown = await convertBlocksToMarkdown(page_id)
          markdown += contentMarkdown

          console.log('got content')
          return {
            content: [{ type: 'text', text: markdown }]
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error converting page to markdown: ${error instanceof Error ? error.message : 'Unknown error'}` }]
          }
        }
      }
    )
  },
  {},
  { basePath: '/api' },
);

export { handler as GET, handler as POST, handler as DELETE };
