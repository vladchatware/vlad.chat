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
        query: z.string().optional().describe('Search query to match against page titles. Note: Notion search only matches page titles, not page content. Only used when database_id is not provided.'),
        filters: z.unknown().optional().describe('Arbitrary filter object matching Notion API filter structure. Only used when database_id is provided. Supports property filters, timestamp filters, and compound filters (and/or). Example: { property: "Status", select: { equals: "Done" } } or { timestamp: "created_time", created_time: { past_week: {} } }'),
        sorts: z.array(z.unknown()).optional().describe('Array of sort criteria. Only used when database_id is provided. Each sort can be { property: "PropertyName", direction: "ascending"|"descending" } or { timestamp: "created_time"|"last_edited_time", direction: "ascending"|"descending" }'),
        filter_properties: z.array(z.string()).optional().describe('Optional array of property names to include in response. Only used when database_id is provided. Reduces payload size.'),
        sort: z.object({
          timestamp: z.enum(['last_edited_time']).default('last_edited_time').describe('The name of the timestamp to sort against. Only used when database_id is not provided.'),
          direction: z.enum(["ascending", "descending"]).default('descending').describe('The direction to sort. Only used when database_id is not provided.')
        }).default({}).describe('A set of criteria, direction and timestamp keys, that orders the results. Only used when database_id is not provided.'),
        start_cursor: z.string().optional().describe('A cursor value returned in a previous response. If supplied, limits the response to results starting after the cursor.'),
        page_size: z.number().optional().describe('The number of items from the full list to include in the response. Maximum: 100. Defaults to 20 when a query is provided (to better find subpages), 1 otherwise.'),
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
        // Use a higher default page_size when query is provided to show more relevant results
        // Increased to 20 to better find subpages and nested content
        // When a query is provided, use at least 20 results to improve chances of finding the right page
        // Use nullish coalescing to only apply default when page_size is undefined
        const effectivePageSize = query 
          ? Math.max(page_size ?? 20, 20)  // At least 20 when query is provided
          : (page_size ?? 1)  // Default to 1 when no query
        
        const searchParams: Parameters<typeof notion.search>[0] = {
          page_size: effectivePageSize,
          start_cursor,
          filter: {
            property: 'object',
            value: (filter.value === 'database' ? 'data_source' : (filter.value || 'page')) as 'page' | 'data_source'
          }
        }

        // Only include query if it's provided and non-empty
        if (query && query.trim()) {
          searchParams.query = query.trim()
        } else {
          // Only apply sort when there's no query - let Notion's relevance ranking work when query is provided
          searchParams.sort = {
            timestamp: sort.timestamp,
            direction: sort.direction
          }
        }

        const res = await notion.search(searchParams)

        // Collect unique parent page IDs to fetch their titles
        const parentPageIds = new Set<string>()
        res.results.forEach((result) => {
          if ('parent' in result && result.parent && result.parent.type === 'page_id') {
            parentPageIds.add(result.parent.page_id)
          }
        })

        // Fetch parent page titles in parallel
        const parentTitles = new Map<string, string>()
        if (parentPageIds.size > 0) {
          const parentFetchPromises = Array.from(parentPageIds).map(async (parentId) => {
            try {
              const parentPage = await notion.pages.retrieve({ page_id: parentId })
              let parentTitle = 'Untitled'
              
              if ('properties' in parentPage) {
                const titleProperty = Object.values(parentPage.properties).find((prop) =>
                  'type' in prop && prop.type === 'title'
                ) as PageObjectResponse['properties'][string] | undefined
                if (titleProperty && 'type' in titleProperty && titleProperty.type === 'title') {
                  parentTitle = titleProperty.title.map((t) => t.plain_text).join('')
                }
              } else if ('title' in parentPage && Array.isArray(parentPage.title)) {
                parentTitle = parentPage.title.map(t => t.plain_text).join('')
              }
              
              return { parentId, parentTitle }
            } catch (error) {
              console.error(`Error fetching parent page ${parentId}:`, error)
              return { parentId, parentTitle: 'Unknown' }
            }
          })
          
          const parentResults = await Promise.all(parentFetchPromises)
          parentResults.forEach(({ parentId, parentTitle }) => {
            parentTitles.set(parentId, parentTitle)
          })
        }

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

          // Show parent page title for subpages
          let parentInfo = ''
          if ('parent' in result && result.parent) {
            if (result.parent.type === 'page_id') {
              const parentTitle = parentTitles.get(result.parent.page_id)
              if (parentTitle) {
                parentInfo = ` (in ${parentTitle})`
              }
            } else if (result.parent.type === 'database_id') {
              // For database parents, we could fetch the database title, but that's less common
              // Skip showing database_id to avoid polluting context
            }
          }

          return `${result.id} ${title}${parentInfo} ${timeAgo}`
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
    server.tool(
      'notion-fetch-database-entry',
      'Retrieves a Notion database entry (page) and formats it with all database properties displayed clearly, followed by the page content. Use this when you have a database entry ID from notion-search results and want to see the full entry details.',
      {
        page_id: z.string().describe('Identifier for a Notion database entry (page ID) to retrieve. This should be a page ID that represents a database entry.')
      },
      async ({ page_id }) => {
        try {
          // Retrieve the page
          const page = await notion.pages.retrieve({ page_id })

          let output = ''

          // Format properties if this is a database entry
          if ('properties' in page) {
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
                  return prop.created_time ? new Date(prop.created_time).toISOString() : ''
                case 'last_edited_time':
                  return prop.last_edited_time ? new Date(prop.last_edited_time).toISOString() : ''
                case 'relation':
                  return prop.relation.map((r) => r.id).join(', ')
                case 'rollup':
                  // Rollup properties can be complex, show a simplified version
                  if (prop.rollup.type === 'number' && prop.rollup.number !== null) {
                    return prop.rollup.number.toString()
                  } else if (prop.rollup.type === 'date' && prop.rollup.date) {
                    return prop.rollup.date.start
                  } else if (prop.rollup.type === 'array' && prop.rollup.array.length > 0) {
                    return `[${prop.rollup.array.length} items]`
                  }
                  return ''
                case 'formula':
                  // Formula properties can be various types
                  if (prop.formula.type === 'string' && prop.formula.string) {
                    return prop.formula.string
                  } else if (prop.formula.type === 'number' && prop.formula.number !== null) {
                    return prop.formula.number.toString()
                  } else if (prop.formula.type === 'boolean' && prop.formula.boolean !== null) {
                    return prop.formula.boolean ? 'Yes' : 'No'
                  } else if (prop.formula.type === 'date' && prop.formula.date) {
                    return prop.formula.date.start
                  }
                  return ''
                default:
                  return JSON.stringify(prop)
              }
            }

            // Extract title
            let title = 'Untitled'
            const properties: Array<{ name: string; value: string }> = []

            for (const [propName, prop] of Object.entries(page.properties)) {
              const value = formatPropertyValue(prop)
              
              // Identify title property
              if (prop.type === 'title' || propName === 'Name') {
                if (value) title = value
              } else {
                // Add non-title properties
                if (value) {
                  properties.push({ name: propName, value })
                }
              }
            }

            // Format output with title and properties
            output += `# ${title}\n\n`
            output += `**Entry ID:** ${page_id}\n\n`

            if (properties.length > 0) {
              output += `## Properties\n\n`
              for (const { name, value } of properties) {
                output += `**${name}:** ${value}\n\n`
              }
            }

            // Add metadata
            const lastEditedTime = 'last_edited_time' in page ? page.last_edited_time : undefined
            const createdTime = 'created_time' in page ? page.created_time : undefined
            if (lastEditedTime || createdTime) {
              output += `## Metadata\n\n`
              if (createdTime) {
                output += `**Created:** ${new Date(createdTime).toLocaleString()}\n\n`
              }
              if (lastEditedTime) {
                output += `**Last Edited:** ${new Date(lastEditedTime).toLocaleString()} (${getRelativeTime(new Date(lastEditedTime))})\n\n`
              }
            }

            // Add page content if available
            try {
              const contentMarkdown = await convertBlocksToMarkdown(page_id)
              if (contentMarkdown.trim()) {
                output += `## Content\n\n${contentMarkdown}`
              }
            } catch (error) {
              // If content fetch fails, continue without it
              console.error(`Error fetching content for page ${page_id}:`, error)
            }
          } else {
            // If it's not a database entry, fall back to regular page format
            let title = 'Untitled'
            if ('title' in page && Array.isArray(page.title)) {
              title = page.title.map(t => t.plain_text).join('')
            }
            output += `# ${title}\n\n`
            
            try {
              const contentMarkdown = await convertBlocksToMarkdown(page_id)
              output += contentMarkdown
            } catch (error) {
              console.error(`Error fetching content for page ${page_id}:`, error)
            }
          }

          return {
            content: [{ type: 'text', text: output }]
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error fetching database entry: ${error instanceof Error ? error.message : 'Unknown error'}` }]
          }
        }
      }
    )
  },
  {},
  { basePath: '/api' },
);

export { handler as GET, handler as POST, handler as DELETE };
