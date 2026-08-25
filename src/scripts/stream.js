/**
 * The record format a file is encrypted in.
 *
 * A file is cut into fixed-size records, each encrypted on its own with
 * AES-GCM, so neither side ever has to hold the whole file in memory. The
 * record number goes into the nonce and into the authenticated data, so records
 * cannot be swapped or dropped, and the last record says that it is the last,
 * so a stream cut short fails to authenticate instead of decrypting to a
 * truncated file.
 *
 * On the wire:
 *
 *     version (1) | record size (4, big endian) | base nonce (8)
 *     record 0 ciphertext+tag | record 1 ciphertext+tag | ... | last record
 *
 * Every record but the last holds exactly `record size` bytes of plaintext. The
 * last one holds what is left, which may be nothing and may be a full record.
 */

export const version = 1
export const tagLength = 16
export const nonceBaseLength = 8
export const headerLength = 1 + 4 + nonceBaseLength

// 4 MiB keeps the number of Web Crypto calls low without pinning much memory
export const recordSize = 4 * 1024 * 1024

// how many records may wait on the heap before they are folded into the Blob
const foldEvery = 8

// what a header is allowed to ask of us, so a file that is not in this format
// cannot talk us into absurd allocations
export const minRecordSize = 64 * 1024
export const maxRecordSize = 16 * 1024 * 1024

// A record that cannot be read is not different, to the person waiting, from a
// tag that does not check out, so it carries the name Web Crypto uses and gets
// the same message.
function formatError(message) {
    const error = new Error(message)
    error.name = 'OperationError'

    return error
}

function nonce(base, counter) {
    const value = new Uint8Array(base.length + 4)
    value.set(base, 0)
    new DataView(value.buffer).setUint32(base.length, counter, false)

    return value
}

// The record number and whether it ends the file are authenticated but not
// encrypted: they are what makes a reordered or truncated stream fail.
function additionalData(counter, last) {
    const data = new Uint8Array(5)
    new DataView(data.buffer).setUint32(0, counter, false)
    data[4] = last ? 1 : 0

    return data
}

function header(size, base) {
    const value = new Uint8Array(headerLength)
    value[0] = version
    new DataView(value.buffer).setUint32(1, size, false)
    value.set(base, 5)

    return value
}

// Whether a file begins the way this format does. A file from before it was
// introduced is a nonce followed by one ciphertext, which the version byte and
// the record size together rule out.
export function looksStreamed(start) {
    if (!start || start.length < headerLength + tagLength)
        return false

    if (start[0] !== version)
        return false

    const size = new DataView(start.buffer, start.byteOffset, start.byteLength).getUint32(1, false)

    return size >= minRecordSize && size <= maxRecordSize
}

function readHeader(start) {
    const view = new DataView(start.buffer, start.byteOffset, start.byteLength)

    return {
        size: view.getUint32(1, false),
        base: start.slice(5, headerLength),
    }
}

async function importKey(key, usage) {
    return window.crypto.subtle.importKey('raw', key, 'aes-gcm', false, [usage])
}

/**
 * Encrypts a File or Blob a record at a time, handing each piece of the result
 * to onBytes in order, starting with the header. The plaintext is never held
 * whole, and neither is the ciphertext when the caller passes the pieces on as
 * they come.
 */
export async function encryptRecords(file, key, onBytes, onProgress, size) {
    const step = size || recordSize
    const base = window.crypto.getRandomValues(new Uint8Array(nonceBaseLength))
    const cryptoKey = await importKey(key, 'encrypt')

    await onBytes(header(step, base))

    // an empty file still gets one record, so the format always ends on a
    // record that says it is the last
    const records = Math.max(1, Math.ceil(file.size / step))

    for (var counter = 0; counter < records; counter++) {
        const offset = counter * step
        const plain = await file.slice(offset, offset + step).arrayBuffer()
        const last = counter === records - 1

        const record = await window.crypto.subtle.encrypt(
            {
                name: 'aes-gcm',
                iv: nonce(base, counter),
                additionalData: additionalData(counter, last),
            },
            cryptoKey,
            plain,
        )

        await onBytes(new Uint8Array(record), last)

        if (onProgress)
            onProgress(Math.min(offset + step, file.size), file.size)
    }
}

/**
 * Encrypts a File or Blob into a Blob in the record format. The file is read a
 * record at a time, so the plaintext is never held whole.
 */
export async function encryptBlob(file, key, onProgress, size) {
    const parts = []

    await encryptRecords(file, key, function (bytes) {
        parts.push(bytes)
    }, onProgress, size)

    return new Blob(parts)
}

/**
 * Decrypts a stream in the record format, holding no more than one record of
 * ciphertext at a time. Each record goes to onPlain when there is one, and into
 * a Blob otherwise. Throws when a record fails to authenticate, which is also
 * what a truncated or reordered stream comes down to.
 */
export async function decryptStream(stream, key, onProgress, total, onPlain) {
    const reader = stream.getReader()
    const cryptoKey = await importKey(key, 'decrypt')

    // Records are folded into a Blob as they add up, so the plaintext waiting to
    // be written sits where the browser keeps blobs rather than on the heap.
    // Folding a Blob into a larger one does not copy what is already in it.
    var kept = new Blob([])
    var parts = []

    // With somewhere to put each record, nothing is kept at all: the file goes
    // straight where it is being written.
    const emit = onPlain || async function (bytes) {
        parts.push(bytes)

        if (parts.length >= foldEvery) {
            kept = new Blob([kept].concat(parts))
            parts = []
        }
    }

    var buffered = new Uint8Array(0)
    var counter = 0
    var read = 0
    var head = null
    var cipherRecord = 0

    const append = function (chunk) {
        const grown = new Uint8Array(buffered.length + chunk.length)
        grown.set(buffered, 0)
        grown.set(chunk, buffered.length)
        buffered = grown
    }

    const take = async function (bytes, last) {
        const record = buffered.slice(0, bytes)
        buffered = buffered.slice(bytes)

        const plain = await window.crypto.subtle.decrypt(
            {
                name: 'aes-gcm',
                iv: nonce(head.base, counter),
                additionalData: additionalData(counter, last),
            },
            cryptoKey,
            record,
        )

        await emit(new Uint8Array(plain))
        counter++
    }

    for (;;) {
        const step = await reader.read()

        if (!step.done) {
            append(step.value)
            read += step.value.length

            if (onProgress && total)
                onProgress(read, total)
        }

        if (!head) {
            if (buffered.length < headerLength) {
                if (step.done)
                    throw formatError('the file is too short to be a share')

                continue
            }

            head = readHeader(buffered)
            cipherRecord = head.size + tagLength
            buffered = buffered.slice(headerLength)
        }

        // A full record is only known to be the last one once the stream ends,
        // so one record is always held back.
        while (buffered.length > cipherRecord)
            await take(cipherRecord, false)

        if (step.done) {
            if (buffered.length < tagLength)
                throw formatError('the file ends in the middle of a record')

            await take(buffered.length, true)
            break
        }
    }

    return onPlain ? null : new Blob([kept].concat(parts))
}
