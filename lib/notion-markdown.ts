import notion from "@/lib/notion"
import type { BlockObjectResponse, RichTextItemResponse } from "@notionhq/client"

export type MarkdownConversionOptions = {
    maxBlocks?: number
    maxChars?: number
    preserveStructureOnTrim?: boolean
}

export type MarkdownConversionResult = {
    markdown: string
    truncated: boolean
    processedBlocks: number
    processedChars: number
}

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

type ConversionContext = {
    processedBlocks: number
    truncated: boolean
    trimMarkerAppended: boolean
    structureLines: string[]
    preserveStructureOnTrim: boolean
}

function appendWithCharLimit(current: string, next: string, maxChars: number, ctx: ConversionContext): string {
    if (!next || ctx.truncated) return current
    if (maxChars === Number.POSITIVE_INFINITY) return current + next

    const remaining = maxChars - current.length
    if (remaining <= 0) {
        ctx.truncated = true
        return current
    }
    if (next.length <= remaining) {
        return current + next
    }

    ctx.truncated = true
    return current + next.slice(0, remaining)
}

function blockToStructureLine(block: BlockObjectResponse, depth: number): string {
    const indent = '  '.repeat(depth)
    return `${indent}- ${block.type}`
}

async function listBlocksLimited(blockId: string, maxBlocks: number, ctx: ConversionContext): Promise<BlockObjectResponse[]> {
    const collected: BlockObjectResponse[] = []
    let startCursor: string | undefined

    while (!ctx.truncated && (maxBlocks === Number.POSITIVE_INFINITY || ctx.processedBlocks < maxBlocks)) {
        const page = await notion.blocks.children.list({
            block_id: blockId,
            start_cursor: startCursor,
            page_size: 100,
        })

        for (const block of page.results) {
            if (!('type' in block)) continue
            if (maxBlocks !== Number.POSITIVE_INFINITY && ctx.processedBlocks >= maxBlocks) {
                break
            }
            collected.push(block)
            ctx.processedBlocks += 1
        }

        if (
            !page.has_more ||
            !page.next_cursor ||
            ctx.truncated ||
            (maxBlocks !== Number.POSITIVE_INFINITY && ctx.processedBlocks >= maxBlocks)
        ) {
            break
        }
        startCursor = page.next_cursor
    }

    return collected
}

async function convertBlocksRecursive(
    blockId: string,
    depth: number,
    maxBlocks: number,
    maxChars: number,
    ctx: ConversionContext
): Promise<string> {
    const blocks = await listBlocksLimited(blockId, maxBlocks, ctx)
    let markdown = ''

    for (const block of blocks) {
        if (ctx.preserveStructureOnTrim) {
            ctx.structureLines.push(blockToStructureLine(block, depth))
        }

        if (!ctx.truncated) {
            const nextMarkdown = blockToMarkdown(block, depth)
            const beforeLen = markdown.length
            markdown = appendWithCharLimit(markdown, nextMarkdown, maxChars, ctx)
            if (ctx.truncated && !ctx.trimMarkerAppended && markdown.length >= beforeLen) {
                const marker = `\n\n[Content trimmed for faster response. Full page structure is included below.]\n\n`
                markdown = appendWithCharLimit(markdown, marker, maxChars, ctx)
                ctx.trimMarkerAppended = true
            }
        }

        if (block.has_children) {
            try {
                const childMarkdown = await convertBlocksRecursive(block.id, depth + 1, maxBlocks, maxChars, ctx)
                if (!ctx.truncated) {
                    markdown = appendWithCharLimit(markdown, childMarkdown, maxChars, ctx)
                }
            } catch (error) {
                console.error(`Error fetching children for block ${block.id}:`, error)
            }
        }
    }

    return markdown
}

export async function convertBlocksToMarkdownWithMeta(
    blockId: string,
    options: MarkdownConversionOptions = {}
): Promise<MarkdownConversionResult> {
    const maxBlocks = options.maxBlocks ?? Number.POSITIVE_INFINITY
    const maxChars = options.maxChars ?? Number.POSITIVE_INFINITY
    const preserveStructureOnTrim = options.preserveStructureOnTrim ?? false
    const ctx: ConversionContext = {
        processedBlocks: 0,
        truncated: false,
        trimMarkerAppended: false,
        structureLines: [],
        preserveStructureOnTrim,
    }

    let markdown = await convertBlocksRecursive(blockId, 0, maxBlocks, maxChars, ctx)
    if (ctx.truncated && preserveStructureOnTrim && ctx.structureLines.length > 0) {
        markdown += `\n\n## Structure Outline\n\n${ctx.structureLines.join('\n')}\n`
    }

    return {
        markdown,
        truncated: ctx.truncated,
        processedBlocks: ctx.processedBlocks,
        processedChars: markdown.length,
    }
}

// Helper function to convert Notion blocks to markdown
export async function convertBlocksToMarkdown(
    blockId: string,
    depth = 0,
    options: MarkdownConversionOptions = {}
): Promise<string> {
    const maxBlocks = options.maxBlocks ?? Number.POSITIVE_INFINITY
    const maxChars = options.maxChars ?? Number.POSITIVE_INFINITY
    const preserveStructureOnTrim = options.preserveStructureOnTrim ?? false
    const ctx: ConversionContext = {
        processedBlocks: 0,
        truncated: false,
        trimMarkerAppended: false,
        structureLines: [],
        preserveStructureOnTrim,
    }
    let markdown = await convertBlocksRecursive(blockId, depth, maxBlocks, maxChars, ctx)
    if (ctx.truncated && preserveStructureOnTrim && ctx.structureLines.length > 0 && depth === 0) {
        markdown += `\n\n## Structure Outline\n\n${ctx.structureLines.join('\n')}\n`
    }
    return markdown
}
