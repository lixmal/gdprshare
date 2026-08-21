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
    'download.title': ['de', 'it', 'pt-BR'],
    'download.submit': ['nl'],
    'download.password': ['it'],
    'alert.errorLabel': ['es'],
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

if (problems.length) {
    console.error('Locale check failed:\n')
    problems.forEach(function (p) { console.error('  ' + p) })
    console.error('\n' + problems.length + ' problem(s) across ' + files.length + ' locale files')
    process.exit(1)
}

console.log('Locale check passed: ' + files.length + ' locales, ' + baseKeys.length + ' keys each')
