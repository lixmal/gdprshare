/**
 * The secret that opens a share, and the optional password that goes with it.
 *
 * The secret lives in the link fragment and never reaches the server. When the
 * sender adds a password, the file is encrypted under a key derived from both,
 * so a link that goes astray on its own opens nothing.
 */

// How much work a guess costs someone who has the link but not the password.
// The secret is the salt, so every guess has to run this to be tested.
export const passwordIterations = 600000

// Marks a link whose secret is only half of what is needed. The prefix travels
// in the fragment, so the server never learns that a password is in play.
export const passwordPrefix = 'p.'

export function keyToB64(key) {
    const b64 = Buffer.from(key).toString('base64')
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function keyFromB64(b64) {
    const key = b64.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(key, 'base64')
}

export async function deriveKey(secret, password, length) {
    const material = await window.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits'],
    )

    const bits = await window.crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            hash: 'SHA-256',
            salt: secret,
            iterations: passwordIterations,
        },
        material,
        length * 8,
    )

    return Buffer.from(bits)
}

// Reads a link fragment as the secret it carries and whether a password goes
// with it. An empty fragment is the split link: the recipient types the secret.
export function readFragment(fragment) {
    if (fragment.indexOf(passwordPrefix) === 0)
        return {
            secret: keyFromB64(fragment.slice(passwordPrefix.length)),
            needsPassword: true,
        }

    return {
        secret: fragment ? keyFromB64(fragment) : null,
        needsPassword: false,
    }
}

/**
 * A page address with the secret taken out of it.
 *
 * The fragment is the key, so an address that carries one must never be sent
 * anywhere. The query goes too: nothing on this server puts anything there that
 * a report needs, and it is the other half of a URL people paste secrets into.
 */
export function withoutSecret(url) {
    const text = String(url)

    // an address that cannot be read is reported as nothing rather than as
    // itself: it may still hold the fragment
    let parsed
    try {
        parsed = new URL(text)
    } catch (e) {
        return ''
    }

    return parsed.origin + parsed.pathname
}
