import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// English is bundled so there is never a flash of untranslated text or a
// broken page when the locale fetch fails. Every other locale is fetched from
// /assets/locales/<code>.json only when it is the one actually needed.
import en from '../../public/locales/en.json'

// Locales shipped in public/locales. Adding a language means dropping a new
// file in there and adding its code here, nothing else.
export const supportedLocales = [
    'ar',
    'de',
    'en',
    'es',
    'fr',
    'hi',
    'id',
    'it',
    'ja',
    'ko',
    'nl',
    'pl',
    'pt',
    'pt-BR',
    'ru',
    'sv',
    'th',
    'tr',
    'uk',
    'vi',
    'zh-CN',
    'zh-TW',
]

// Languages written right to left, so the document direction can follow.
const rtlLanguages = ['ar', 'fa', 'he', 'ur']

const localeUrl = '/assets/locales/'

const fallbackLocale = 'en'

// Regional tags the browser may report that should land on a specific file
// rather than on the bare language. Chinese and Portuguese differ enough
// between regions to be worth keeping apart.
const regionAliases = {
    'zh': 'zh-CN',
    'zh-hans': 'zh-CN',
    'zh-sg': 'zh-CN',
    'zh-hant': 'zh-TW',
    'zh-hk': 'zh-TW',
    'zh-mo': 'zh-TW',
    'pt-pt': 'pt',
}

const lookup = {}
supportedLocales.forEach(function (locale) {
    lookup[locale.toLowerCase()] = locale
})

// Resolves one browser language tag to a shipped locale, preferring an exact
// regional match and falling back to the base language.
function matchLocale(tag) {
    if (!tag)
        return null

    const wanted = tag.toLowerCase()

    if (regionAliases[wanted])
        return regionAliases[wanted]

    if (lookup[wanted])
        return lookup[wanted]

    const base = wanted.split('-')[0]

    if (regionAliases[base])
        return regionAliases[base]

    return lookup[base] || null
}

// Picks the locale from the ?lang= override first, then the browser
// preferences in the order the user set them.
export function detectLocale(search, languages) {
    const override = /[?&]lang=([\w-]+)/.exec(search || '')
    if (override) {
        const forced = matchLocale(override[1])
        if (forced)
            return forced
    }

    const preferences = languages && languages.length ? languages : []
    for (var i = 0; i < preferences.length; i++) {
        const match = matchLocale(preferences[i])
        if (match)
            return match
    }

    return fallbackLocale
}

export function isRtl(locale) {
    return rtlLanguages.indexOf(String(locale).split('-')[0]) !== -1
}

function applyDocumentLocale(locale) {
    const html = document.documentElement
    html.setAttribute('lang', locale)
    html.setAttribute('dir', isRtl(locale) ? 'rtl' : 'ltr')
}

async function fetchLocale(locale) {
    const response = await window.fetch(localeUrl + locale + '.json')
    if (!response.ok)
        throw new Error('locale request returned ' + response.status)

    return response.json()
}

// Looks up the message for a server error response. Falls back to the English
// message the API sent whenever the code is missing or not translated yet, so
// a new backend error is always readable even before its locale entry exists.
export function serverErrorText(data) {
    if (!data)
        return ''

    const key = 'errors.server.' + data.code
    if (data.code && i18n.exists(key))
        return i18n.t(key)

    return data.message || ''
}

// Initialised at import time with the bundled English resources. This has no
// async work in it, so t() is usable from the very first render, including the
// unsupported browser page that renders before initI18n() has a chance to run.
i18n.use(initReactI18next).init({
    lng: fallbackLocale,
    fallbackLng: fallbackLocale,
    resources: {
        en: { translation: en },
    },
    interpolation: {
        // react already escapes what it renders
        escapeValue: false,
    },
})

// Detects the visitor's language and loads its bundle. Resolves once the page
// can render in that language, or in English if it could not be loaded.
export async function initI18n() {
    const locale = detectLocale(window.location.search, window.navigator.languages ||
        [window.navigator.language])

    applyDocumentLocale(locale)

    if (locale === fallbackLocale)
        return i18n

    try {
        i18n.addResourceBundle(locale, 'translation', await fetchLocale(locale), true, true)
        // the bundle arrived after init, so ask i18next to re-read it
        await i18n.changeLanguage(locale)
    } catch (error) {
        // an unreachable locale file must not take the page down, English is
        // already loaded and readable
        console.log('load locale ' + locale + ':', error)
        applyDocumentLocale(fallbackLocale)
    }

    return i18n
}

export default i18n
