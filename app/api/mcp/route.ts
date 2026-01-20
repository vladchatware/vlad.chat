import { z } from "zod"
import notion from "@/lib/notion"
import { convertBlocksToMarkdown } from "@/lib/notion-markdown"
import { getRelativeTime } from "@/lib/utils"
import { createMcpHandler } from "mcp-handler"
import type {
  PageObjectResponse,
  DatabaseObjectResponse,
  PartialPageObjectResponse,
  PartialDatabaseObjectResponse,
  DataSourceObjectResponse,
  PartialDataSourceObjectResponse,
  QueryDataSourceParameters
} from "@notionhq/client";

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'notion-get-database',
      'Retrieves the schema of a Notion database, including all properties and their types. Use this to discover available properties before constructing filters for database queries.',
      {
        database_id: z.string().describe('The identifier for the Notion database.')
      },
      async ({ database_id }) => {
        try {
          const database = await notion.databases.retrieve({ database_id })

          let title = 'Untitled'
          if ('title' in database && Array.isArray(database.title)) {
            title = database.title.map(t => t.plain_text).join('')
          } else if ('properties' in database) {
            const titleProperty = Object.values(database.properties).find((prop) =>
              'type' in prop && prop.type === 'title'
            )
            if (titleProperty && 'type' in titleProperty && titleProperty.type === 'title' && 'title' in titleProperty) {
              title = titleProperty.title.map((t) => t.plain_text).join('')
            }
          }

          const properties: Array<{
            name: string
            type: string
            options?: string[]
            metadata?: Record<string, unknown>
          }> = []

          if ('properties' in database) {
            for (const [propName, prop] of Object.entries(database.properties)) {
              const propInfo: {
                name: string
                type: string
                options?: string[]
                metadata?: Record<string, unknown>
              } = {
                name: propName,
                type: prop.type,
              }

              // Add type-specific metadata
              if (prop.type === 'select' && 'select' in prop && prop.select) {
                propInfo.options = prop.select.options.map((opt) => opt.name)
              } else if (prop.type === 'multi_select' && 'multi_select' in prop) {
                propInfo.options = prop.multi_select.options.map((opt) => opt.name)
              } else if (prop.type === 'status' && 'status' in prop && prop.status) {
                propInfo.options = prop.status.options.map((opt) => opt.name)
              } else if (prop.type === 'relation' && 'relation' in prop) {
                propInfo.metadata = {
                  database_id: prop.relation.database_id,
                }
              } else if (prop.type === 'formula' && 'formula' in prop) {
                propInfo.metadata = {
                  formula_expression: prop.formula.expression,
                }
              }

              properties.push(propInfo)
            }
          }

          const schemaText = `Database: ${title}\nDatabase ID: ${database_id}\n\nProperties:\n${properties.map(p => {
            let propText = `- ${p.name} (${p.type})`
            if (p.options && p.options.length > 0) {
              propText += `\n  Options: ${p.options.join(', ')}`
            }
            if (p.metadata) {
              propText += `\n  Metadata: ${JSON.stringify(p.metadata)}`
            }
            return propText
          }).join('\n')}`

          return {
            content: [{ type: 'text', text: schemaText }]
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error retrieving database schema: ${error instanceof Error ? error.message : 'Unknown error'}` }]
          }
        }
      }
    )
    server.tool(
      'notion-search',
      `Searches all parent or child pages and databases that have been shared with an integration, OR queries a specific database with filters.

If database_id is provided, queries that database with arbitrary filters. Otherwise, performs a semantic search over the workspace.

For database queries, first use notion-get-database to discover available properties, then construct filters matching the Notion API filter structure.`,
      {
        database_id: z.string().optional().describe('Optional database ID. If provided, queries this database instead of searching the workspace.'),
        query: z.string().optional().describe('Semantic search query over your entire Notion workspace. Only used when database_id is not provided.'),
        filters: z.unknown().optional().describe('Arbitrary filter object matching Notion API filter structure. Only used when database_id is provided. Supports property filters, timestamp filters, and compound filters (and/or). Example: { property: "Status", select: { equals: "Done" } } or { timestamp: "created_time", created_time: { past_week: {} } }'),
        sorts: z.array(z.unknown()).optional().describe('Array of sort criteria. Only used when database_id is provided. Each sort can be { property: "PropertyName", direction: "ascending"|"descending" } or { timestamp: "created_time"|"last_edited_time", direction: "ascending"|"descending" }'),
        filter_properties: z.array(z.string()).optional().describe('Optional array of property names to include in response. Only used when database_id is provided. Reduces payload size.'),
        sort: z.object({
          timestamp: z.enum(['last_edited_time']).default('last_edited_time').describe('The name of the timestamp to sort against. Only used when database_id is not provided.'),
          direction: z.enum(["ascending", "descending"]).default('descending').describe('The direction to sort. Only used when database_id is not provided.')
        }).default({}).describe('A set of criteria, direction and timestamp keys, that orders the results. Only used when database_id is not provided.'),
        start_cursor: z.string().optional().describe('A cursor value returned in a previous response. If supplied, limits the response to results starting after the cursor.'),
        page_size: z.number().default(1).describe('The number of items from the full list to include in the response. Maximum: 100.'),
        filter: z.object({
          property: z.enum(['object']).default('object').describe('The name of the property to filter by. Only used when database_id is not provided.'),
          value: z.enum(['page', 'database']).default('page').describe('The value of the property to filter the results by. Only used when database_id is not provided.')
        }).default({ property: 'object', value: 'page' })
      },
      async ({ database_id, query, filters, sorts, filter_properties, sort, filter, page_size, start_cursor }) => {
        // If database_id is provided, query the database
        if (database_id) {
          try {
            const queryParams: QueryDataSourceParameters = {
              data_source_id: database_id,
              page_size: Math.min(page_size || 100, 100),
            }

            if (start_cursor) {
              queryParams.start_cursor = start_cursor
            }

            if (filters) {
              queryParams.filter = filters as QueryDataSourceParameters['filter']
            }

            if (sorts && sorts.length > 0) {
              queryParams.sorts = sorts as QueryDataSourceParameters['sorts']
            }

            if (filter_properties && filter_properties.length > 0) {
              queryParams.filter_properties = filter_properties
            }

            // Use dataSources.query - databases are queried through data sources in Notion API v5
            const res = await notion.dataSources.query(queryParams)

            const formatPropertyValue = (prop: PageObjectResponse['properties'][string]): string => {
              if (!prop || !('type' in prop)) return ''
              
              switch (prop.type) {
                case 'title':
                  return prop.title.map((t) => t.plain_text).join('')
                case 'rich_text':
                  return prop.rich_text.map((t) => t.plain_text).join('')
                case 'number':
                  return prop.number?.toString() || ''
                case 'select':
                  return prop.select?.name || ''
                case 'multi_select':
                  return prop.multi_select.map((s) => s.name).join(', ')
                case 'date':
                  if (prop.date) {
                    const dateStr = prop.date.start
                    const timeStr = prop.date.end ? ` - ${prop.date.end}` : ''
                    return `${dateStr}${timeStr}`
                  }
                  return ''
                case 'people':
                  return prop.people.map((p) => ('name' in p && p.name) || p.id).join(', ')
                case 'checkbox':
                  return prop.checkbox ? 'Yes' : 'No'
                case 'url':
                  return prop.url || ''
                case 'email':
                  return prop.email || ''
                case 'phone_number':
                  return prop.phone_number || ''
                case 'status':
                  return prop.status?.name || ''
                case 'created_time':
                  return prop.created_time ? getRelativeTime(new Date(prop.created_time)) : ''
                case 'last_edited_time':
                  return prop.last_edited_time ? getRelativeTime(new Date(prop.last_edited_time)) : ''
                default:
                  return JSON.stringify(prop)
              }
            }

            const text = res.results.map((page) => {
              let title = 'Untitled'
              const properties: string[] = []

              if ('properties' in page) {
                for (const [propName, prop] of Object.entries(page.properties)) {
                  if (propName === 'Name' || ('type' in prop && prop.type === 'title')) {
                    const titleValue = formatPropertyValue(prop)
                    if (titleValue) title = titleValue
                  } else {
                    const value = formatPropertyValue(prop)
                    if (value) {
                      properties.push(`  ${propName}: ${value}`)
                    }
                  }
                }
              }

              const lastEditedTime = 'last_edited_time' in page ? page.last_edited_time : undefined
              const timeAgo = lastEditedTime ? getRelativeTime(new Date(lastEditedTime)) : ''

              let result = `${page.id} ${title} ${timeAgo}`
              if (properties.length > 0) {
                result += '\n' + properties.join('\n')
              }
              return result
            }).join('\n\n')

            return {
              content: [{ type: 'text', text }]
            }
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Error querying database: ${error instanceof Error ? error.message : 'Unknown error'}` }]
            }
          }
        }

        // Otherwise, perform regular search
        const searchParams: Parameters<typeof notion.search>[0] = {
          query: query || '',
          sort: {
            timestamp: sort.timestamp,
            direction: sort.direction
          },
          page_size,
          start_cursor,
          filter: {
            property: 'object',
            value: (filter.value === 'database' ? 'data_source' : (filter.value || 'page')) as 'page' | 'data_source'
          }
        };

        const res = await notion.search(searchParams)

        const text = res.results.map((result: PageObjectResponse | DatabaseObjectResponse | PartialPageObjectResponse | PartialDatabaseObjectResponse | DataSourceObjectResponse | PartialDataSourceObjectResponse) => {
          let title = "Untitled";

          if ('properties' in result) {
            const props = result.properties;
            const titleProperty = Object.values(props).find((prop) =>
              typeof prop === 'object' &&
              prop !== null &&
              'type' in prop &&
              (prop as Record<string, unknown>).type === 'title'
            ) as { title: Array<{ plain_text: string }> } | undefined;

            if (titleProperty) {
              title = titleProperty.title.map((t) => t.plain_text).join('');
            }
          } else if ('title' in result) {
            title = result.title.map(t => t.plain_text).join('');
          }

          const lastEditedTime = 'last_edited_time' in result ? result.last_edited_time : undefined;
          const timeAgo = lastEditedTime ? getRelativeTime(new Date(lastEditedTime)) : '';

          return `${result.id} ${title} ${timeAgo}`
        }).join('\n');

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
