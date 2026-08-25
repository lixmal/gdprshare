/**
 * The record format: a file cut into separately encrypted records, so neither
 * side has to hold it whole. What matters is that it round trips, and that a
 * stream someone has meddled with fails instead of decrypting to something.
 */

import { webcrypto } from 'crypto'
import { Blob as NodeBlob } from 'buffer'
import { ReadableStream as NodeReadableStream } from 'stream/web'
import {
    decryptStream,
    encryptBlob,
    headerLength,
    looksStreamed,
    minRecordSize,
    tagLength,
} from '../stream'

// small records keep the tests quick while exercising the same paths
const SIZE = minRecordSize

// jsdom ships neither Web Crypto nor a Blob that streams, and the code under
// test needs the real ones
beforeAll(() => {
    if (!window.crypto || !window.crypto.subtle)
        Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true })

    global.ReadableStream = NodeReadableStream
    global.Blob = NodeBlob
})

const key = () => webcrypto.getRandomValues(new Uint8Array(32))

function body(bytes) {
    const content = new Uint8Array(bytes)
    for (var i = 0; i < bytes; i++)
        content[i] = i % 251

    return content
}

async function roundTrip(bytes) {
    const secret = key()
    const plain = body(bytes)
    const sealed = await encryptBlob(new Blob([plain]), secret, null, SIZE)
    const opened = await decryptStream(sealed.stream(), secret, null, sealed.size)

    return { plain, opened: new Uint8Array(await opened.arrayBuffer()) }
}

// a stream of one chunk, which is the worst case for the record buffering
function streamOf(bytes) {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(bytes)
            controller.close()
        },
    })
}

describe('round trip', () => {
    test.each([
        ['an empty file', 0],
        ['less than one record', 1000],
        ['exactly one record', SIZE],
        ['a record and a bit', SIZE + 17],
        ['exactly three records', SIZE * 3],
        ['three records and a bit', SIZE * 3 + 5],
    ])('carries %s through unchanged', async (_name, bytes) => {
        const { plain, opened } = await roundTrip(bytes)

        expect(opened).toHaveLength(bytes)
        expect(Buffer.from(opened)).toEqual(Buffer.from(plain))
    })

    test('reports progress up to the whole file', async () => {
        const seen = []
        await encryptBlob(new Blob([body(SIZE * 2 + 10)]), key(), (done, total) => {
            seen.push([done, total])
        }, SIZE)

        expect(seen).toHaveLength(3)
        expect(seen[seen.length - 1]).toEqual([SIZE * 2 + 10, SIZE * 2 + 10])
    })
})

describe('a stream someone meddled with', () => {
    const sealedBytes = async (bytes) => {
        const secret = key()
        const sealed = await encryptBlob(new Blob([body(bytes)]), secret, null, SIZE)

        return { secret, bytes: new Uint8Array(await sealed.arrayBuffer()) }
    }

    test('fails on a flipped bit', async () => {
        const { secret, bytes } = await sealedBytes(SIZE + 40)
        bytes[headerLength + 20] ^= 0x01

        await expect(decryptStream(streamOf(bytes), secret, null, bytes.length))
            .rejects.toThrow()
    })

    test('fails when the last record is cut short', async () => {
        const { secret, bytes } = await sealedBytes(SIZE + 40)

        await expect(decryptStream(streamOf(bytes.slice(0, bytes.length - 5)), secret, null, 0))
            .rejects.toThrow()
    })

    // the record number is authenticated, so a record cannot stand in for another
    test('fails when two records are swapped', async () => {
        const { secret, bytes } = await sealedBytes(SIZE * 3)
        const record = SIZE + tagLength
        const first = bytes.slice(headerLength, headerLength + record)
        const second = bytes.slice(headerLength + record, headerLength + record * 2)
        bytes.set(second, headerLength)
        bytes.set(first, headerLength + record)

        await expect(decryptStream(streamOf(bytes), secret, null, bytes.length))
            .rejects.toThrow()
    })

    // the last record says that it is the last, so dropping it is not silent
    test('fails when whole records are dropped from the end', async () => {
        const { secret, bytes } = await sealedBytes(SIZE * 3)
        const record = SIZE + tagLength

        await expect(decryptStream(streamOf(bytes.slice(0, headerLength + record * 2)), secret, null, 0))
            .rejects.toThrow()
    })

    test('fails with the wrong key', async () => {
        const { bytes } = await sealedBytes(1000)

        await expect(decryptStream(streamOf(bytes), key(), null, bytes.length))
            .rejects.toThrow()
    })

    test('fails on a file too short to hold a header', async () => {
        await expect(decryptStream(streamOf(new Uint8Array(4)), key(), null, 0))
            .rejects.toThrow()
    })
})

describe('looksStreamed', () => {
    test('recognises the format', async () => {
        const sealed = await encryptBlob(new Blob([body(100)]), key(), null, SIZE)
        const start = new Uint8Array(await sealed.slice(0, 64).arrayBuffer())

        expect(looksStreamed(start)).toBe(true)
    })

    // a share from before this format is a 12 byte nonce and one ciphertext
    test('does not mistake the older single record for it', () => {
        for (var attempt = 0; attempt < 200; attempt++) {
            const legacy = webcrypto.getRandomValues(new Uint8Array(12 + 100 + tagLength))

            expect(looksStreamed(legacy)).toBe(false)
        }
    })

    test('says no to something too short to judge', () => {
        expect(looksStreamed(new Uint8Array(8))).toBe(false)
        expect(looksStreamed(null)).toBe(false)
    })
})
