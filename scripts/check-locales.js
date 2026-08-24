#!/usr/bin/env node
/**
 * Verifies every locale in public/locales carries exactly the keys English has,
 * that no value was left as the English source string, and that the placeholders
 * in each string survived translation.
 *
 * Run with `npm run check:locales`. CI runs it on every push, so a new string
 * added to en.json fails the build until all languages have it.
 */

const fs = require('fs')
const path = require('path')

const localeDir = path.join(__dirname, '..', 'public', 'locales')
const baseLocale = 'en'

// Values that are legitimately identical to English, usually loan words. Keep
// this list short and justify additions: it is the one hole in the untranslated
// check.
const sharedWithEnglish = {
    'download.submit': ['nl'],
    'download.password': ['it'],
    'alert.errorLabel': ['es'],
    // loan words and spellings that are genuinely the same in these languages
    'upload.downloads': ['de', 'nl', 'pt-BR'],
    'upload.chipDownloads': ['de', 'nl', 'pt-BR'],
    'upload.region': ['de', 'pl', 'sv'],
    'upload.regionEea': ['hi', 'ja', 'ko', 'th', 'vi'],
    'upload.typeText': ['de', 'sv'],
    'upload.typeFile': ['it'],
    'upload.typeImage': ['fr'],
    'uploaded.mailSubject': ['de', 'nl'],
    'duration.m1': ['fr'],
    'duration.m2': ['fr'],
    'duration.m5': ['fr'],
    'duration.m15': ['fr'],
    'duration.m30': ['fr'],
    'footer.privacy': ['it', 'nl'],
}

function flatten(value, prefix, out) {
    Object.keys(value).forEach(function (key) {
        const full = prefix ? prefix + '.' + key : key
        if (value[key] !== null && typeof value[key] === 'object')
            flatten(value[key], full, out)
        else
            out[full] = value[key]
    })
    return out
}

function placeholders(text) {
    return (String(text).match(/\{\{\s*\w+\s*\}\}/g) || [])
        .map(function (p) { return p.replace(/\s/g, '') })
        .sort()
}

function readLocale(file) {
    const raw = fs.readFileSync(path.join(localeDir, file), 'utf8')
    try {
        return flatten(JSON.parse(raw), '', {})
    } catch (error) {
        throw new Error(file + ' is not valid JSON: ' + error.message)
    }
}

const files = fs.readdirSync(localeDir).filter(function (f) {
    return f.endsWith('.json')
}).sort()

const base = readLocale(baseLocale + '.json')
const baseKeys = Object.keys(base).sort()
const problems = []

files.forEach(function (file) {
    const locale = file.replace(/\.json$/, '')
    if (locale === baseLocale)
        return

    const entries = readLocale(file)
    const keys = Object.keys(entries).sort()

    baseKeys.filter(function (k) { return keys.indexOf(k) === -1 })
        .forEach(function (k) { problems.push(locale + ': missing key ' + k) })

    keys.filter(function (k) { return baseKeys.indexOf(k) === -1 })
        .forEach(function (k) { problems.push(locale + ': unknown key ' + k + ' (not in ' + baseLocale + ')') })

    keys.forEach(function (k) {
        if (baseKeys.indexOf(k) === -1)
            return

        const value = entries[k]

        if (typeof value !== 'string' || value.trim() === '') {
            problems.push(locale + ': empty value for ' + k)
            return
        }

        const allowed = sharedWithEnglish[k] || []
        if (value === base[k] && allowed.indexOf(locale) === -1)
            problems.push(locale + ': ' + k + ' is still the English string')

        const want = placeholders(base[k])
        const got = placeholders(value)
        if (want.join(',') !== got.join(','))
            problems.push(locale + ': ' + k + ' placeholders ' + JSON.stringify(got) +
                ' do not match ' + baseLocale + ' ' + JSON.stringify(want))
    })
})

// the locale list the app ships must match what is on disk
const i18nSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'scripts', 'i18n.js'), 'utf8')
const declared = (/export const supportedLocales = \[([\s\S]*?)\]/.exec(i18nSource) || [])[1]
if (!declared) {
    problems.push('could not read supportedLocales from src/scripts/i18n.js')
} else {
    const listed = (declared.match(/'([\w-]+)'/g) || []).map(function (s) { return s.replace(/'/g, '') }).sort()
    const onDisk = files.map(function (f) { return f.replace(/\.json$/, '') }).sort()

    onDisk.filter(function (l) { return listed.indexOf(l) === -1 })
        .forEach(function (l) { problems.push(l + ': locale file exists but is not in supportedLocales') })

    listed.filter(function (l) { return onDisk.indexOf(l) === -1 })
        .forEach(function (l) { problems.push(l + ': in supportedLocales but public/locales/' + l + '.json is missing') })
}

// Every t('some.key') in the app has to exist in en.json, so a typo or a
// string that was never added to the locale files fails here rather than
// rendering the raw key to a visitor. Keys built at runtime (t('duration.' +
// key)) cannot be checked statically; their prefixes are listed instead, and
// every key under such a prefix has to be reachable from somewhere.
const dynamicPrefixes = ['duration.', 'download.status.', 'errors.server.', 'upload.title']

const sourceDir = path.join(__dirname, '..', 'src', 'scripts')
const sourceFiles = []
;(function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            if (entry.name !== '__tests__')
                walk(full)
        } else if (entry.name.endsWith('.js')) {
            sourceFiles.push(full)
        }
    })
})(sourceDir)

const usedKeys = new Set()
sourceFiles.forEach(function (file) {
    const source = fs.readFileSync(file, 'utf8')
    const pattern = /\bt\(\s*'([A-Za-z][\w.]*)'/g
    let match
    while ((match = pattern.exec(source)) !== null) {
        // a literal ending in a dot is the prefix of a key built at runtime
        if (match[1].endsWith('.'))
            continue
        usedKeys.add(match[1] + '\u0000' + path.basename(file))
    }
})

usedKeys.forEach(function (entry) {
    const parts = entry.split('\u0000')
    const key = parts[0]
    if (base[key] === undefined)
        problems.push(parts[1] + ': t(\'' + key + '\') is not a key in ' + baseLocale + '.json')
})

baseKeys.filter(function (k) {
    if (usedKeys.size === 0)
        return false
    const used = Array.from(usedKeys).some(function (e) { return e.split('\u0000')[0] === k })
    const dynamic = dynamicPrefixes.some(function (prefix) { return k.indexOf(prefix) === 0 })
    return !used && !dynamic
}).forEach(function (k) {
    problems.push(baseLocale + ': ' + k + ' is translated but never used in src/scripts')
})

if (problems.length) {
    console.error('Locale check failed:\n')
    problems.forEach(function (p) { console.error('  ' + p) })
    console.error('\n' + problems.length + ' problem(s) across ' + files.length + ' locale files')
    process.exit(1)
}

console.log('Locale check passed: ' + files.length + ' locales, ' + baseKeys.length + ' keys each')
