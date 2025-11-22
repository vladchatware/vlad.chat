import { z } from "zod"
import notion from "@/lib/notion"
import { convertBlocksToMarkdown } from "@/lib/notion-markdown"
import { createMcpHandler } from "mcp-handler"
import {
  PageObjectResponse,
  DatabaseObjectResponse,
  PartialPageObjectResponse,
  PartialDatabaseObjectResponse,
  DataSourceObjectResponse,
  PartialDataSourceObjectResponse
} from "@notionhq/client";

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'notion-search',
      `Searches all parent or child pages and databases that have been shared with an integration.

Returns all pages or databases, excluding duplicated linked databases, that have titles that include the query param.If no query param is provided, then the response contains all pages or databases that have been shared with the integration.The results adhere to any limitations related to an integration's capabilities.

To limit the request to search only pages or to search only databases, use the filter param.`,
      {
        sort: z.object({
          timestamp: z.enum(['last_edited_time']).default('last_edited_time').describe('The name of the timestamp to sort against. Possible values include last_edited_time.'),
          direction: z.enum(["ascending", "descending"]).default('descending').describe('The direction to sort. Possible values include ascending and descending.')
        }).default({}).describe('A set of criteria, direction and timestamp keys, that orders the results. The only supported timestamp value is "last_edited_time". Supported direction values are "ascending" and "descending". If sort is not provided, then the most recently edited results are returned first.'),
        query: z.string().describe('Semantic search query over your entire Notion workspace and connected sources. For best results, dont provide more than one question per tool call.'),
        start_cursor: z.string().optional().describe('A cursor value returned in a previous response that If supplied, limits the response to results starting after the cursor. If not supplied, then the first page of results is returned.'),
        page_size: z.number().default(1).describe('The number of items from the full list to include in the response. Maximum: 100.'),
        filter: z.object({
          property: z.enum(['object']).optional().describe('The name of the property to filter by. Currently the only property you can filter by is the object type. Possible values include object. Limitation: Currently the only filter allowed is object which will filter by type of object (either page or database)'),
          value: z.enum(['page', 'database']).optional().describe('The value of the property to filter the results by. Possible values for object type include page or database. Limitation: Currently the only filter allowed is object which will filter by type of object (either page or database)')
        }).default({})
      },
      async ({ query, sort, filter, page_size, start_cursor }) => {
        const searchParams: Parameters<typeof notion.search>[0] = {
          query,
          sort: {
            timestamp: sort.timestamp,
            direction: sort.direction
          },
          page_size,
          start_cursor
        };

        if (filter.property && filter.value) {
          searchParams.filter = {
            property: 'object',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value: filter.value as any
          };
        }

        const res = await notion.search(searchParams)

        const payload = res.results.map((result: PageObjectResponse | DatabaseObjectResponse | PartialPageObjectResponse | PartialDatabaseObjectResponse | DataSourceObjectResponse | PartialDataSourceObjectResponse) => {
          const common = {
            object: result.object,
            id: result.id,
            url: 'url' in result ? result.url : undefined,
            created_time: 'created_time' in result ? result.created_time : undefined,
            last_edited_time: 'last_edited_time' in result ? result.last_edited_time : undefined,
          }

          if ('properties' in result) {
            // It's a Page or DataSource with properties
            // DataSourceObjectResponse might not have title in properties in the same way, but let's check
            const props = result.properties;
            const titleProperty = Object.values(props).find((prop) =>
              typeof prop === 'object' &&
              prop !== null &&
              'type' in prop &&
              (prop as Record<string, unknown>).type === 'title'
            ) as { title: Array<{ plain_text: string }> } | undefined;

            const title = titleProperty
              ? titleProperty.title.map((t) => t.plain_text).join('')
              : "Untitled";

            return {
              ...common,
              title,
              properties: props
            }
          } else if ('title' in result) {
            // It's a Database
            const title = result.title.map(t => t.plain_text).join('');
            return {
              ...common,
              title,
            }
          }

          return common
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

          let markdown = ''

          // Add page title if requested
          if ('properties' in page) {
            const titleProperty = Object.values(page.properties).find(prop =>
              prop.type === 'title'
            )
            if (titleProperty && titleProperty.type === 'title') {
              const title = titleProperty.title.map(rt => rt.plain_text).join('')
              markdown += `# ${title} \n\n`
            }
          }

          // Convert all blocks to markdown
          const contentMarkdown = await convertBlocksToMarkdown(page_id)
          markdown += contentMarkdown

          return {
            content: [{ type: 'text', text: markdown }]
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error converting page to markdown: ${error instanceof Error ? error.message : 'Unknown error'} ` }]
          }
        }
      }
    )
  },
  {},
  { basePath: '/api' },
);

export { handler as GET, handler as POST, handler as DELETE };
