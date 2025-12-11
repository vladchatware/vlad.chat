import { describe, it, expect, vi, beforeEach } from 'vitest'
import { convertBlocksToMarkdown } from './notion-markdown'

// Mock the notion client
const mockList = vi.fn()

vi.mock('@/lib/notion', () => ({
    default: {
        blocks: {
            children: {
                list: (...args: unknown[]) => mockList(...args)
            }
        }
    }
}))

describe('convertBlocksToMarkdown', () => {
    beforeEach(() => {
        mockList.mockReset()
    })

    it('should convert a paragraph block', async () => {
        mockList.mockResolvedValueOnce({
            results: [
                {
                    type: 'paragraph',
                    paragraph: {
                        rich_text: [
                            { plain_text: 'Hello world' }
                        ]
                    }
                }
            ]
        })

        const markdown = await convertBlocksToMarkdown('block-id')
        expect(markdown).toBe('Hello world\n\n')
    })

    it('should handle empty paragraphs', async () => {
        mockList.mockResolvedValueOnce({
            results: [
                {
                    type: 'paragraph',
                    paragraph: {
                        rich_text: []
                    }
                }
            ]
        })

        const markdown = await convertBlocksToMarkdown('block-id')
        expect(markdown).toBe('\n\n')
    })

    it('should convert headings', async () => {
        mockList.mockResolvedValueOnce({
            results: [
                {
                    type: 'heading_1',
                    heading_1: { rich_text: [{ plain_text: 'Heading 1' }] }
                },
                {
                    type: 'heading_2',
                    heading_2: { rich_text: [{ plain_text: 'Heading 2' }] }
                },
                {
                    type: 'heading_3',
                    heading_3: { rich_text: [{ plain_text: 'Heading 3' }] }
                }
            ]
        })

        const markdown = await convertBlocksToMarkdown('block-id')
        expect(markdown).toBe('# Heading 1\n\n## Heading 2\n\n### Heading 3\n\n')
    })

    it('should convert lists', async () => {
        mockList.mockResolvedValueOnce({
            results: [
                {
                    type: 'bulleted_list_item',
                    bulleted_list_item: { rich_text: [{ plain_text: 'Bullet item' }] }
                },
                {
                    type: 'numbered_list_item',
                    numbered_list_item: { rich_text: [{ plain_text: 'Numbered item' }] }
                }
            ]
        })

        const markdown = await convertBlocksToMarkdown('block-id')
        expect(markdown).toBe('- Bullet item\n1. Numbered item\n')
    })

    it('should convert to-do items', async () => {
        mockList.mockResolvedValueOnce({
            results: [
                {
                    type: 'to_do',
                    to_do: {
                        rich_text: [{ plain_text: 'Unchecked task' }],
                        checked: false
                    }
                },
                {
                    type: 'to_do',
                    to_do: {
                        rich_text: [{ plain_text: 'Checked task' }],
                        checked: true
                    }
                }
            ]
        })

        const markdown = await convertBlocksToMarkdown('block-id')
        expect(markdown).toBe('[ ] Unchecked task\n[x] Checked task\n')
    })

    it('should convert code blocks', async () => {
        mockList.mockResolvedValueOnce({
            results: [
                {
                    type: 'code',
                    code: {
                        rich_text: [{ plain_text: 'console.log("hello")' }],
                        language: 'javascript'
                    }
                }
            ]
        })

        const markdown = await convertBlocksToMarkdown('block-id')
        expect(markdown).toBe('```javascript\nconsole.log("hello")\n```\n\n')
    })

    it('should convert quotes and callouts', async () => {
        mockList.mockResolvedValueOnce({
            results: [
                {
                    type: 'quote',
                    quote: { rich_text: [{ plain_text: 'This is a quote' }] }
                },
                {
                    type: 'callout',
                    callout: {
                        rich_text: [{ plain_text: 'This is a callout' }],
                        icon: { type: 'emoji', emoji: '⚠️' }
                    }
                }
            ]
        })

        const markdown = await convertBlocksToMarkdown('block-id')
        expect(markdown).toBe('> This is a quote\n\n> ⚠️ This is a callout\n\n')
    })

    it('should handle nested blocks', async () => {
        // First call returns parent block
        mockList.mockResolvedValueOnce({
            results: [
                {
                    id: 'parent-block',
                    type: 'bulleted_list_item',
                    bulleted_list_item: { rich_text: [{ plain_text: 'Parent item' }] },
                    has_children: true
                }
            ]
        })
        const markdown = await convertBlocksToMarkdown('root-id')

        // Per updated spec: nested child blocks are not fetched recursively
        expect(mockList).toHaveBeenCalledTimes(1)
        expect(mockList).toHaveBeenNthCalledWith(1, { block_id: 'root-id' })

        expect(markdown).toBe('- Parent item\n')
    })

    it('should ignore unknown block types', async () => {
        mockList.mockResolvedValueOnce({
            results: [
                {
                    type: 'unknown_type',
                    unknown_type: {}
                }
            ]
        })

        const markdown = await convertBlocksToMarkdown('block-id')
        expect(markdown).toBe('')
    })
})
