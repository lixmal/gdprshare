/**
 * The secret in the link, and the password that can be required alongside it.
 */

import { webcrypto } from 'crypto'
import {
    deriveKey,
    keyFromB64,
    keyToB64,
    passwordPrefix,
    readFragment,
    withoutSecret,
} from '../keys'

const KEY_LENGTH = 32

beforeAll(() => {
    // jsdom ships no Web Crypto, and the real one is what the code has to use
    if (!window.crypto || !window.crypto.subtle)
        Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true })
})

describe('readFragment', () => {
    test('reads a plain link as a secret that needs nothing else', () => {
        const secret = new Uint8Array(KEY_LENGTH).fill(7)
        const read = readFragment(keyToB64(secret))

        expect(read.needsPassword).toBe(false)
        expect(Buffer.from(read.secret)).toEqual(Buffer.from(secret))
    })

    test('reads a marked link as a secret that wants a password', () => {
        const secret = new Uint8Array(KEY_LENGTH).fill(9)
        const read = readFragment(passwordPrefix + keyToB64(secret))

        expect(read.needsPassword).toBe(true)
        expect(Buffer.from(read.secret)).toEqual(Buffer.from(secret))
    })

    test('reads an empty fragment as a split link', () => {
        expect(readFragment('')).toEqual({ secret: null, needsPassword: false })
    })

    test('keeps the secret out of a base64 round trip unharmed', () => {
        const secret = webcrypto.getRandomValues(new Uint8Array(KEY_LENGTH))

        expect(Buffer.from(keyFromB64(keyToB64(secret)))).toEqual(Buffer.from(secret))
        // the fragment is URL safe, so it survives being pasted into an address bar
        expect(keyToB64(secret)).not.toMatch(/[+/=]/)
    })
})

describe('deriveKey', () => {
    const secret = new Uint8Array(KEY_LENGTH).fill(3)

    test('gives a key of the requested length', async () => {
        const key = await deriveKey(secret, 'correct horse', KEY_LENGTH)

        expect(key).toHaveLength(KEY_LENGTH)
    })

    test('is the same key for the same secret and password', async () => {
        const first = await deriveKey(secret, 'correct horse', KEY_LENGTH)
        const second = await deriveKey(secret, 'correct horse', KEY_LENGTH)

        expect(Buffer.from(first)).toEqual(Buffer.from(second))
    })

    test('is a different key for a different password', async () => {
        const right = await deriveKey(secret, 'correct horse', KEY_LENGTH)
        const wrong = await deriveKey(secret, 'correct horst', KEY_LENGTH)

        expect(Buffer.from(right)).not.toEqual(Buffer.from(wrong))
    })

    test('is a different key for a different secret', async () => {
        const other = new Uint8Array(KEY_LENGTH).fill(4)

        expect(Buffer.from(await deriveKey(secret, 'same', KEY_LENGTH)))
            .not.toEqual(Buffer.from(await deriveKey(other, 'same', KEY_LENGTH)))
    })

    test('never hands back the secret itself', async () => {
        const key = await deriveKey(secret, 'a password', KEY_LENGTH)

        // the link alone must not be the key when a password is in play
        expect(Buffer.from(key)).not.toEqual(Buffer.from(secret))
    })
})

describe('withoutSecret', () => {
    // The error report the download page sends carries the address of the page.
    // The fragment of that address is the key to the file, so it must never be
    // part of what is sent.
    it('drops the fragment', () => {
        expect(withoutSecret('https://share.example.org/d/abc123#Zm9vYmFy'))
            .toBe('https://share.example.org/d/abc123')
    })

    it('drops a fragment that marks a password', () => {
        expect(withoutSecret('https://share.example.org/d/abc123#p.Zm9vYmFy'))
            .toBe('https://share.example.org/d/abc123')
    })

    it('drops the query as well', () => {
        expect(withoutSecret('https://share.example.org/d/abc123?lang=de#Zm9vYmFy'))
            .toBe('https://share.example.org/d/abc123')
    })

    it('keeps an address that carries no secret', () => {
        expect(withoutSecret('https://share.example.org/d/abc123'))
            .toBe('https://share.example.org/d/abc123')
    })

    // an address that cannot be read may still hold the fragment, so nothing of
    // it is reported
    it('reports nothing for an address it cannot read', () => {
        expect(withoutSecret('not an address#secret')).toBe('')
        expect(withoutSecret('')).toBe('')
    })
})
