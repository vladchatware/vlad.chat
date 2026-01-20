import notion from "@/lib/notion"
import type { BlockObjectResponse, RichTextItemResponse } from "@notionhq/client"

// Helper function to convert a single block to markdown (without children)
function blockToMarkdown(block: BlockObjectResponse, depth: number): string {
    if (!('type' in block)) return ''

    const indent = '  '.repeat(depth)
    let markdown = ''

    switch (block.type) {
        case 'paragraph':
            if (block.paragraph.rich_text.length > 0) {
                const text = block.paragraph.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
                markdown += `${indent}${text}\n\n`
            } else {
                markdown += `${indent}\n\n`
            }
            break

        case 'heading_1':
            const h1Text = block.heading_1.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
            markdown += `${indent}# ${h1Text}\n\n`
            break

        case 'heading_2':
            const h2Text = block.heading_2.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
            markdown += `${indent}## ${h2Text}\n\n`
            break

        case 'heading_3':
            const h3Text = block.heading_3.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
            markdown += `${indent}### ${h3Text}\n\n`
            break

        case 'bulleted_list_item':
            const bulletText = block.bulleted_list_item.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
            markdown += `${indent}- ${bulletText}\n`
            break

        case 'numbered_list_item':
            const numberText = block.numbered_list_item.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
            markdown += `${indent}1. ${numberText}\n`
            break

        case 'to_do':
            const todoText = block.to_do.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
            const checkbox = block.to_do.checked ? '[x]' : '[ ]'
            markdown += `${indent}${checkbox} ${todoText}\n`
            break

        case 'toggle':
            const toggleText = block.toggle.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
            markdown += `${indent}<details>\n${indent}<summary>${toggleText}</summary>\n`
            break

        case 'code':
            const codeText = block.code.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
            const language = block.code.language
            markdown += `${indent}\`\`\`${language}\n${codeText}\n${indent}\`\`\`\n\n`
            break

        case 'quote':
            const quoteText = block.quote.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
            markdown += `${indent}> ${quoteText}\n\n`
            break

        case 'callout':
            const calloutText = block.callout.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
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
                const text = block.rich_text.map((rt: RichTextItemResponse) => rt.plain_text).join('')
                if (text) {
                    markdown += `${indent}${text}\n\n`
                }
            }
    }

    return markdown
}

// Helper function to convert Notion blocks to markdown
export async function convertBlocksToMarkdown(blockId: string, depth = 0): Promise<string> {
    const blocks = await notion.blocks.children.list({ block_id: blockId })
    let markdown = ''

    // Separate blocks into those with and without children
    const blocksWithChildren: Array<{ block: BlockObjectResponse; index: number }> = []
    const blocksWithoutChildren: Array<{ block: BlockObjectResponse; index: number }> = []

    blocks.results.forEach((block, index) => {
        if (!('type' in block)) return
        if (block.has_children) {
            blocksWithChildren.push({ block, index })
        } else {
            blocksWithoutChildren.push({ block, index })
        }
    })

    // Process blocks without children immediately
    for (const { block } of blocksWithoutChildren) {
        markdown += blockToMarkdown(block, depth)
    }

    // Fetch all child blocks in parallel for blocks with children
    const childMarkdownPromises = blocksWithChildren.map(async ({ block }) => {
        try {
            const childMarkdown = await convertBlocksToMarkdown(block.id, depth + 1)
            return { block, childMarkdown }
        } catch (error) {
            // If one child fetch fails, continue with others
            console.error(`Error fetching children for block ${block.id}:`, error)
            return { block, childMarkdown: '' }
        }
    })

    // Wait for all child fetches to complete
    const childResults = await Promise.all(childMarkdownPromises)

    // Process blocks with children in order, appending their child markdown
    for (const { block, childMarkdown } of childResults) {
        markdown += blockToMarkdown(block, depth)
        markdown += childMarkdown
    }

    return markdown
}
