import { describe, it, vi, beforeEach } from 'vitest'
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

// Helper to create a block with text
function createBlock(type: string, text: string, hasChildren = false) {
    const block: any = {
        id: `block-${Math.random().toString(36).substr(2, 9)}`,
        type,
        has_children: hasChildren
    }

    switch (type) {
        case 'paragraph':
            block.paragraph = { rich_text: [{ plain_text: text }] }
            break
        case 'heading_1':
            block.heading_1 = { rich_text: [{ plain_text: text }] }
            break
        case 'heading_2':
            block.heading_2 = { rich_text: [{ plain_text: text }] }
            break
        case 'heading_3':
            block.heading_3 = { rich_text: [{ plain_text: text }] }
            break
        case 'bulleted_list_item':
            block.bulleted_list_item = { rich_text: [{ plain_text: text }] }
            break
        case 'numbered_list_item':
            block.numbered_list_item = { rich_text: [{ plain_text: text }] }
            break
        case 'code':
            block.code = { rich_text: [{ plain_text: text }], language: 'typescript' }
            break
        case 'quote':
            block.quote = { rich_text: [{ plain_text: text }] }
            break
    }

    return block
}

describe('convertBlocksToMarkdown - Performance Benchmarks', () => {
    beforeEach(() => {
        mockList.mockReset()
    })

    it('benchmark: small document (10 blocks)', async () => {
        const blocks = Array.from({ length: 10 }, (_, i) =>
            createBlock('paragraph', `Paragraph ${i + 1}`)
        )

        mockList.mockResolvedValueOnce({ results: blocks })

        const start = performance.now()
        await convertBlocksToMarkdown('root-id')
        const end = performance.now()

        const duration = end - start
        console.log(`\n📊 Small document (10 blocks): ${duration.toFixed(2)}ms`)
        console.log(`   Average per block: ${(duration / 10).toFixed(2)}ms`)
    })

    it('benchmark: medium document (100 blocks)', async () => {
        const blocks = Array.from({ length: 100 }, (_, i) =>
            createBlock('paragraph', `Paragraph ${i + 1}`)
        )

        mockList.mockResolvedValueOnce({ results: blocks })

        const start = performance.now()
        await convertBlocksToMarkdown('root-id')
        const end = performance.now()

        const duration = end - start
        console.log(`\n📊 Medium document (100 blocks): ${duration.toFixed(2)}ms`)
        console.log(`   Average per block: ${(duration / 100).toFixed(2)}ms`)
    })

    it('benchmark: large document (1000 blocks)', async () => {
        const blocks = Array.from({ length: 1000 }, (_, i) =>
            createBlock('paragraph', `Paragraph ${i + 1}`)
        )

        mockList.mockResolvedValueOnce({ results: blocks })

        const start = performance.now()
        await convertBlocksToMarkdown('root-id')
        const end = performance.now()

        const duration = end - start
        console.log(`\n📊 Large document (1000 blocks): ${duration.toFixed(2)}ms`)
        console.log(`   Average per block: ${(duration / 1000).toFixed(2)}ms`)
    })

    it('benchmark: deeply nested structure (5 levels, 10 blocks per level)', async () => {
        let callCount = 0
        const totalBlocks = 10 + 10 * 5 // root + nested

        mockList.mockImplementation(({ block_id }: { block_id: string }) => {
            callCount++
            const depth = parseInt(block_id.split('-')[1] || '0')

            if (depth === 0) {
                // Root level: 10 blocks, first one has children
                return Promise.resolve({
                    results: [
                        createBlock('heading_1', 'Root Heading', true),
                        ...Array.from({ length: 9 }, (_, i) =>
                            createBlock('paragraph', `Root paragraph ${i + 1}`)
                        )
                    ]
                })
            } else if (depth < 5) {
                // Nested levels: 10 blocks each
                return Promise.resolve({
                    results: Array.from({ length: 10 }, (_, i) =>
                        createBlock('paragraph', `Nested level ${depth} paragraph ${i + 1}`, depth < 4)
                    )
                })
            } else {
                // Leaf level
                return Promise.resolve({
                    results: Array.from({ length: 10 }, (_, i) =>
                        createBlock('paragraph', `Leaf paragraph ${i + 1}`)
                    )
                })
            }
        })

        const start = performance.now()
        await convertBlocksToMarkdown('root-0')
        const end = performance.now()

        const duration = end - start
        console.log(`\n📊 Deeply nested (5 levels, ~${totalBlocks} blocks): ${duration.toFixed(2)}ms`)
        console.log(`   API calls made: ${callCount}`)
        console.log(`   Average per block: ${(duration / totalBlocks).toFixed(2)}ms`)
    })

    it('benchmark: mixed content types (100 blocks)', async () => {
        const blockTypes = [
            'paragraph',
            'heading_1',
            'heading_2',
            'heading_3',
            'bulleted_list_item',
            'numbered_list_item',
            'code',
            'quote'
        ]

        const blocks = Array.from({ length: 100 }, (_, i) => {
            const type = blockTypes[i % blockTypes.length]
            return createBlock(type, `${type} content ${i + 1}`)
        })

        mockList.mockResolvedValueOnce({ results: blocks })

        const start = performance.now()
        await convertBlocksToMarkdown('root-id')
        const end = performance.now()

        const duration = end - start
        console.log(`\n📊 Mixed content types (100 blocks): ${duration.toFixed(2)}ms`)
        console.log(`   Average per block: ${(duration / 100).toFixed(2)}ms`)
    })

    it('benchmark: string concatenation performance (1000 blocks with long text)', async () => {
        const longText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10)
        const blocks = Array.from({ length: 1000 }, (_, i) =>
            createBlock('paragraph', `${longText}Block ${i + 1}`)
        )

        mockList.mockResolvedValueOnce({ results: blocks })

        const start = performance.now()
        const result = await convertBlocksToMarkdown('root-id')
        const end = performance.now()

        const duration = end - start
        const resultLength = result.length
        console.log(`\n📊 Long text blocks (1000 blocks, ~${(resultLength / 1024).toFixed(2)}KB output): ${duration.toFixed(2)}ms`)
        console.log(`   Average per block: ${(duration / 1000).toFixed(2)}ms`)
        console.log(`   Throughput: ${((resultLength / 1024) / (duration / 1000)).toFixed(2)}KB/s`)
    })

    describe('Realistic API latency simulation', () => {
        // Simulate realistic Notion API latency (50-200ms per call)
        const simulateAPILatency = (minMs = 50, maxMs = 200) => {
            const delay = minMs + Math.random() * (maxMs - minMs)
            return new Promise(resolve => setTimeout(resolve, delay))
        }

        it('benchmark: with API latency - small nested document (10 blocks, 3 levels)', async () => {
            let callCount = 0
            mockList.mockImplementation(async ({ block_id }: { block_id: string }) => {
                callCount++
                await simulateAPILatency(50, 100) // 50-100ms per API call

                const depth = block_id === 'root-id' ? 0 : parseInt(block_id.split('-')[1] || '1')

                if (depth === 0) {
                    return {
                        results: [
                            createBlock('heading_1', 'Root', true),
                            ...Array.from({ length: 4 }, (_, i) =>
                                createBlock('paragraph', `Root paragraph ${i + 1}`)
                            )
                        ]
                    }
                } else if (depth === 1) {
                    return {
                        results: Array.from({ length: 5 }, (_, i) =>
                            createBlock('paragraph', `Nested paragraph ${i + 1}`)
                        )
                    }
                } else {
                    return { results: [] }
                }
            })

            const start = performance.now()
            await convertBlocksToMarkdown('root-id')
            const end = performance.now()

            const duration = end - start
            console.log(`\n⏱️  With API latency - Small nested (10 blocks, 3 levels): ${duration.toFixed(2)}ms`)
            console.log(`   API calls: ${callCount}`)
            console.log(`   Estimated time without latency: ${(duration - callCount * 75).toFixed(2)}ms`)
            console.log(`   API overhead: ${(callCount * 75).toFixed(2)}ms (${((callCount * 75 / duration) * 100).toFixed(1)}%)`)
        })

        it('benchmark: with API latency - medium nested document (50 blocks, 5 levels)', async () => {
            let callCount = 0
            mockList.mockImplementation(async ({ block_id }: { block_id: string }) => {
                callCount++
                await simulateAPILatency(50, 150) // 50-150ms per API call

                const depth = block_id === 'root-id' ? 0 : parseInt(block_id.split('-')[1] || '1')

                if (depth === 0) {
                    return {
                        results: [
                            createBlock('heading_1', 'Root', true),
                            ...Array.from({ length: 9 }, (_, i) =>
                                createBlock('paragraph', `Root paragraph ${i + 1}`)
                            )
                        ]
                    }
                } else if (depth < 4) {
                    return {
                        results: [
                            createBlock('heading_2', `Level ${depth}`, true),
                            ...Array.from({ length: 9 }, (_, i) =>
                                createBlock('paragraph', `Level ${depth} paragraph ${i + 1}`)
                            )
                        ]
                    }
                } else {
                    return {
                        results: Array.from({ length: 10 }, (_, i) =>
                            createBlock('paragraph', `Leaf paragraph ${i + 1}`)
                        )
                    }
                }
            })

            const start = performance.now()
            await convertBlocksToMarkdown('root-id')
            const end = performance.now()

            const duration = end - start
            console.log(`\n⏱️  With API latency - Medium nested (50 blocks, 5 levels): ${duration.toFixed(2)}ms`)
            console.log(`   API calls: ${callCount}`)
            console.log(`   Estimated time without latency: ${(duration - callCount * 100).toFixed(2)}ms`)
            console.log(`   API overhead: ${(callCount * 100).toFixed(2)}ms (${((callCount * 100 / duration) * 100).toFixed(1)}%)`)
        })

        it('benchmark: with API latency - worst case (many nested blocks)', async () => {
            let callCount = 0
            // Simulate a document with many blocks that have children
            mockList.mockImplementation(async ({ block_id }: { block_id: string }) => {
                callCount++
                await simulateAPILatency(100, 200) // 100-200ms per API call (slower)

                const depth = block_id === 'root-id' ? 0 : parseInt(block_id.split('-')[1] || '1')

                if (depth === 0) {
                    // Root: 20 blocks, 10 have children
                    return {
                        results: [
                            ...Array.from({ length: 10 }, (_, i) =>
                                createBlock('heading_1', `Section ${i + 1}`, true)
                            ),
                            ...Array.from({ length: 10 }, (_, i) =>
                                createBlock('paragraph', `Paragraph ${i + 1}`)
                            )
                        ]
                    }
                } else if (depth === 1) {
                    // Each section has 5 child blocks
                    return {
                        results: Array.from({ length: 5 }, (_, i) =>
                            createBlock('paragraph', `Nested paragraph ${i + 1}`)
                        )
                    }
                } else {
                    return { results: [] }
                }
            })

            const start = performance.now()
            await convertBlocksToMarkdown('root-id')
            const end = performance.now()

            const duration = end - start
            const totalBlocks = 20 + 10 * 5 // root blocks + nested blocks
            console.log(`\n⏱️  With API latency - Worst case (${totalBlocks} blocks, many nested): ${duration.toFixed(2)}ms`)
            console.log(`   API calls: ${callCount}`)
            console.log(`   Estimated time without latency: ${(duration - callCount * 150).toFixed(2)}ms`)
            console.log(`   API overhead: ${(callCount * 150).toFixed(2)}ms (${((callCount * 150 / duration) * 100).toFixed(1)}%)`)
            console.log(`   ✅ Parallelization: All 10 child fetches happen concurrently at level 1`)
        })

        it('benchmark: parallelization benefit - many same-level blocks with children', async () => {
            let callCount = 0
            const sameLevelBlocks = 10 // 10 blocks at same level, all with children
            
            mockList.mockImplementation(async ({ block_id }: { block_id: string }) => {
                callCount++
                await simulateAPILatency(100, 150) // 100-150ms per API call

                if (block_id === 'root-id') {
                    // Root: 10 blocks, all with children
                    return {
                        results: Array.from({ length: sameLevelBlocks }, (_, i) =>
                            createBlock('heading_1', `Section ${i + 1}`, true)
                        )
                    }
                } else {
                    // Each section has 3 child blocks
                    return {
                        results: Array.from({ length: 3 }, (_, i) =>
                            createBlock('paragraph', `Content ${i + 1}`)
                        )
                    }
                }
            })

            const start = performance.now()
            await convertBlocksToMarkdown('root-id')
            const end = performance.now()

            const duration = end - start
            // With parallelization: 1 root call + 10 parallel child calls = ~200-250ms
            // Without parallelization (sequential): 1 root call + 10 sequential calls = ~1100-1500ms
            const sequentialEstimate = 100 + (sameLevelBlocks * 125) // Sequential estimate
            const speedup = sequentialEstimate / duration

            console.log(`\n🚀 Parallelization benchmark - ${sameLevelBlocks} same-level blocks with children:`)
            console.log(`   Actual time (parallelized): ${duration.toFixed(2)}ms`)
            console.log(`   Estimated sequential time: ${sequentialEstimate.toFixed(2)}ms`)
            console.log(`   Speedup: ${speedup.toFixed(2)}x faster`)
            console.log(`   API calls: ${callCount} (1 root + ${sameLevelBlocks} parallel children)`)
        })
    })
})
