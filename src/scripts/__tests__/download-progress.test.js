/**
 * Streaming read progress. The visible UI is covered by the e2e suite, this
 * pins the reporting itself, which is timing dependent and racy in a browser.
 */

import { Download } from '../Download'

// Minimal stand-in for a fetch Response that hands out the given chunks.
function streamingResponse(chunks, contentLength) {
    var index = 0

    return {
        headers: {
            get: (name) => (name === 'Content-Length' && contentLength !== null
                ? String(contentLength)
                : null),
        },
        body: {
            getReader: () => ({
                read: () => Promise.resolve(
                    index < chunks.length
                        ? { done: false, value: chunks[index++] }
                        : { done: true, value: undefined },
                ),
            }),
        },
        arrayBuffer: () => Promise.reject(new Error('should have streamed instead')),
    }
}

function subject() {
    const component = new Download({ t: (k) => k })
    const seen = []
    component.setState = (patch) => seen.push(patch)

    return { component, seen }
}

describe('readWithProgress', () => {
    test('returns the chunks joined back together in order', async () => {
        const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])]
        const { component } = subject()

        const buffer = await component.readWithProgress(streamingResponse(chunks, 6))

        expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
    })

    test('reports a rising percentage that ends at 100', async () => {
        const chunks = [new Uint8Array(25), new Uint8Array(25), new Uint8Array(50)]
        const { component, seen } = subject()

        await component.readWithProgress(streamingResponse(chunks, 100))

        expect(seen.map((s) => s.progress)).toEqual([25, 50, 100])
    })

    test('never reports above 100 when more bytes arrive than advertised', async () => {
        // a proxy or a stale header can make the body longer than Content-Length
        const chunks = [new Uint8Array(80), new Uint8Array(80)]
        const { component, seen } = subject()

        await component.readWithProgress(streamingResponse(chunks, 100))

        seen.forEach((s) => expect(s.progress).toBeLessThanOrEqual(100))
    })

    test('stays indeterminate when the server sends no Content-Length', async () => {
        const chunks = [new Uint8Array(10), new Uint8Array(10)]
        const { component, seen } = subject()

        await component.readWithProgress(streamingResponse(chunks, null))

        // no total means no honest percentage, so the bar is not shown
        seen.forEach((s) => expect(s.progress).toBeNull())
    })

    test('handles an empty body without dividing by zero', async () => {
        const { component } = subject()

        const buffer = await component.readWithProgress(streamingResponse([], 0))

        expect(new Uint8Array(buffer)).toEqual(new Uint8Array([]))
    })

    test('falls back to a plain buffer read without streaming support', async () => {
        const expected = new Uint8Array([9, 8, 7]).buffer
        const { component, seen } = subject()

        const buffer = await component.readWithProgress({
            headers: { get: () => '3' },
            body: null,
            arrayBuffer: () => Promise.resolve(expected),
        })

        expect(buffer).toBe(expected)
        // nothing to report, so the phase label carries the wait on its own
        expect(seen).toHaveLength(0)
    })
})
