/**
 * Locale detection, server error mapping and locale file integrity.
 */

import fs from 'fs'
import path from 'path'
import i18n, { detectLocale, isRtl, serverErrorIsExpected, serverErrorText, supportedLocales } from '../i18n'

const localeDir = path.join(__dirname, '..', '..', '..', 'public', 'locales')

describe('detectLocale', () => {
    test('picks an exact regional match before the base language', () => {
        expect(detectLocale('', ['pt-BR'])).toBe('pt-BR')
        expect(detectLocale('', ['zh-TW'])).toBe('zh-TW')
    })

    test('falls back to the base language for an unshipped region', () => {
        expect(detectLocale('', ['de-AT'])).toBe('de')
        expect(detectLocale('', ['fr-CA'])).toBe('fr')
        expect(detectLocale('', ['es-MX'])).toBe('es')
    })

    test('routes chinese script and region tags to the right file', () => {
        // mainland and Singapore use simplified, Taiwan/HK/Macau traditional
        expect(detectLocale('', ['zh'])).toBe('zh-CN')
        expect(detectLocale('', ['zh-Hans'])).toBe('zh-CN')
        expect(detectLocale('', ['zh-SG'])).toBe('zh-CN')
        expect(detectLocale('', ['zh-Hant'])).toBe('zh-TW')
        expect(detectLocale('', ['zh-HK'])).toBe('zh-TW')
        expect(detectLocale('', ['zh-MO'])).toBe('zh-TW')
    })

    test('keeps european and brazilian portuguese apart', () => {
        expect(detectLocale('', ['pt-PT'])).toBe('pt')
        expect(detectLocale('', ['pt'])).toBe('pt')
        expect(detectLocale('', ['pt-BR'])).toBe('pt-BR')
    })

    test('honours the order of the browser preference list', () => {
        expect(detectLocale('', ['xx', 'ja', 'de'])).toBe('ja')
    })

    test('is case insensitive', () => {
        expect(detectLocale('', ['DE-de'])).toBe('de')
        expect(detectLocale('', ['ZH-hant'])).toBe('zh-TW')
    })

    test('lets the lang query parameter override the browser', () => {
        expect(detectLocale('?lang=th', ['de'])).toBe('th')
        expect(detectLocale('?foo=1&lang=ko', ['de'])).toBe('ko')
    })

    test('ignores an unsupported override and keeps detecting', () => {
        expect(detectLocale('?lang=klingon', ['ja'])).toBe('ja')
    })

    test('falls back to english when nothing matches', () => {
        expect(detectLocale('', ['xx', 'yy'])).toBe('en')
        expect(detectLocale('', [])).toBe('en')
        expect(detectLocale('', undefined)).toBe('en')
    })
})

describe('isRtl', () => {
    test('flags right to left languages', () => {
        expect(isRtl('ar')).toBe(true)
        expect(isRtl('he')).toBe(true)
    })

    test('leaves left to right languages alone', () => {
        expect(isRtl('en')).toBe(false)
        expect(isRtl('zh-TW')).toBe(false)
        expect(isRtl('de')).toBe(false)
    })
})

describe('serverErrorText', () => {
    test('translates a known error code', () => {
        const text = serverErrorText({ code: 'file_not_found', message: 'file not found' })

        expect(text).toBe(i18n.t('errors.server.file_not_found'))
        // the terse API wording is replaced by the user facing sentence
        expect(text).not.toBe('file not found')
    })

    test('falls back to the api message for an unknown code', () => {
        const text = serverErrorText({ code: 'something_new', message: 'something new broke' })

        expect(text).toBe('something new broke')
    })

    test('falls back to the api message when there is no code at all', () => {
        expect(serverErrorText({ message: 'legacy response' })).toBe('legacy response')
    })

    test('does not throw on an empty response body', () => {
        expect(serverErrorText(null)).toBe('')
        expect(serverErrorText({})).toBe('')
    })
})

describe('serverErrorIsExpected', () => {
    // an end state the link reached on its own reads as a notice, not as
    // something that went wrong
    test.each([
        'file_not_found',
        'download_count_expired',
        'file_expired',
        'file_not_yet_downloadable',
        'download_location_forbidden',
    ])('%s is an expected end state', (code) => {
        expect(serverErrorIsExpected({ code })).toBe(true)
    })

    test.each(['file_retrieval_failed', 'tls_requirements_not_met', 'something_new'])(
        '%s is a real error',
        (code) => {
            expect(serverErrorIsExpected({ code })).toBe(false)
        },
    )

    test('does not throw on an empty response body', () => {
        expect(serverErrorIsExpected(null)).toBe(false)
        expect(serverErrorIsExpected({})).toBe(false)
    })
})

describe('locale files', () => {
    const files = fs.readdirSync(localeDir).filter((f) => f.endsWith('.json'))

    test('every shipped file is declared in supportedLocales and vice versa', () => {
        const onDisk = files.map((f) => f.replace(/\.json$/, '')).sort()

        expect(onDisk).toEqual([...supportedLocales].sort())
    })

    test('covers the languages the project requires', () => {
        // regressions here mean a user facing language silently disappeared
        const required = ['de', 'fr', 'es', 'ja', 'zh-CN', 'zh-TW', 'th', 'ko', 'pt']

        required.forEach((locale) => expect(supportedLocales).toContain(locale))
    })

    test.each(files)('%s parses and has no empty strings', (file) => {
        const data = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'))

        const walk = (node, prefix) => {
            Object.keys(node).forEach((key) => {
                const value = node[key]
                if (value && typeof value === 'object')
                    walk(value, prefix + key + '.')
                else
                    expect(`${prefix}${key}=${String(value).trim()}`)
                        .not.toBe(`${prefix}${key}=`)
            })
        }

        walk(data, '')
    })

    test('every locale carries a translation for each server error code', () => {
        const codes = Object.keys(
            JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf8')).errors.server,
        )

        files.forEach((file) => {
            const server = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8')).errors.server
            expect(Object.keys(server).sort()).toEqual(codes.sort())
        })
    })

    // The codes above are only worth having if they are the ones the server
    // actually sends. Comparing the locales with each other cannot tell: it is
    // the Go source that decides, and a code without an entry reaches the
    // visitor as the English message the API happened to carry.
    test('the server sends no code the locales do not cover', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'pkg', 'server', 'errors.go'), 'utf8')

        const sent = (source.match(/ErrorCode = "[a-z_]+"/g) || [])
            .map((line) => line.replace(/.*"([a-z_]+)"/, '$1'))
        const covered = Object.keys(
            JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf8')).errors.server)

        expect(sent.length).toBeGreaterThan(0)
        expect(sent.filter((code) => covered.indexOf(code) === -1)).toEqual([])
        // and nothing is translated that the server cannot send any more
        expect(covered.filter((code) => sent.indexOf(code) === -1)).toEqual([])
    })
})
