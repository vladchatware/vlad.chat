import { z } from "zod"
import notion from "@/lib/notion"
import { createMcpHandler } from "mcp-handler"

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'notion-get-users',
      'List All users',
      {
        start_cursor: z.string().optional().describe('If supplied, this endpoint will return a page of results starting after the cursor provided. If not supplied, this endpoint will return the first page of results.'),
        page_size: z.number().default(100).describe('The number of items from the full list desired in the response. Maximum: 100')
      },
      async ({ start_cursor, page_size }) => {
        const users = await notion.users.list({ start_cursor, page_size })
        return {
          content: [{ type: 'text', text: JSON.stringify(users, null, 2) }]
        }
      }
    )
    server.tool(
      'notion-retrieve-block',
      'Retrieves a Block object using the ID specified.',
      { block_id: z.string().describe('Identifier for a Notion block') },
      async (args) => {
        const block = await notion.blocks.retrieve(args)
        return {
          content: [{ type: 'text', text: JSON.stringify(block, null, 2) }]
        }
      }
    )
    server.tool(
      'notion-retrieve-page',
      'Retrieves a Page object using the ID specified.',
      {
        page_id: z.string().describe('Identifier for a Notion page'),
        filter_properties: z.string().array().optional().describe('A list of page property value IDs associated with the page. Use this param to limit the response to a specific page property value or values. To retrieve multiple properties, specify each page property ID. For example: ?filter_properties=iAk8&filter_properties=b7dh.')
      },
      async (args) => {
        const page = await notion.pages.retrieve(args)
        return {
          content: [{ type: 'text', text: JSON.stringify(page, null, 2) }]
        }
      }
    )
    server.tool(
      'notion-retrieve-database',
      'Retrieves a database object — a container for one or more data sources — for a provided database ID. The response adheres to any limits to an integration’s capabilities.',
      { database_id: z.string() },
      async ({ database_id }) => {
        const database = await notion.databases.retrieve({ database_id })
        return {
          content: [{ type: 'text', text: JSON.stringify(database, null, 2) }]
        }
      }
    )
    server.tool(
      'notion-retrieve-datasources',
      'Retrieves a data source object — information that describes the structure and columns of a data source — for a provided data source ID. The response adheres to any limits to an integration’s capabilities and the permissions of the parent database. To fetch data source rows (i.e. the child pages of a data source) rather than columns, use the notion-query-datasource.',
      { data_source_id: z.string() },
      async (args) => {
        const dataSource = await notion.dataSources.retrieve(args)
        return {
          content: [{ type: 'text', text: JSON.stringify(dataSource, null, 2) }]
        }
      }
    )
    server.tool(
      'notion-search',
      `Searches all parent or child pages and databases that have been shared with an integration.

Returns all pages or databases, excluding duplicated linked databases, that have titles that include the query param. If no query param is provided, then the response contains all pages or databases that have been shared with the integration. The results adhere to any limitations related to an integration’s capabilities.

To limit the request to search only pages or to search only databases, use the filter param.`,
      {
        sort: z.object({
          timestamp: z.string().describe('The name of the timestamp to sort against. Possible values include last_edited_time.'),
          direction: z.enum(["ascending", "descending"]).describe('The direction to sort. Possible values include ascending and descending.')
        }).default({
          timestamp: 'last_edited_time',
          direction: 'ascending'
        }).describe('A set of criteria, direction and timestamp keys, that orders the results. The only supported timestamp value is "last_edited_time". Supported direction values are "ascending" and "descending". If sort is not provided, then the most recently edited results are returned first.'),
        query: z.string().describe('Semantic search query over your entire Notion workspace and connected sources. For best results, dont provide more than one question per tool call.'),
        start_cursor: z.string().optional().describe('A cursor value returned in a previous response that If supplied, limits the response to results starting after the cursor. If not supplied, then the first page of results is returned.'),
        page_size: z.number().default(100).describe('The number of items from the full list to include in the response. Maximum: 100.'),
        filter: z.object({
          property: z.string().describe('The name of the property to filter by. Currently the only property you can filter by is the object type. Possible values include object. Limitation: Currently the only filter allowed is object which will filter by type of object (either page or database)'),
          value: z.string().describe('The value of the property to filter the results by. Possible values for object type include page or database. Limitation: Currently the only filter allowed is object which will filter by type of object (either page or database)')
        }).optional().nullable()
      },
      async (args) => {
        const res = await notion.search(args)
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
        }
      }
    )
  },
  {},
  { basePath: '/api' },
);

export { handler as GET, handler as POST, handler as DELETE };
