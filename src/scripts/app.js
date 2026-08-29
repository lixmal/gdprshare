import '../style/app.css'
import React from 'react'
import ReactDOM from 'react-dom/client'

// react-router, not react-router-dom: browserify's resolver does not read the
// package exports map v7 uses, and everything this app needs is on this entry
// point anyway
import { BrowserRouter, Routes, Route } from 'react-router'

import ErrPage from './ErrPage'
import Shell, { storedTheme, applyTheme } from './Shell'
import Upload from './Upload'
import Uploaded from './Uploaded'
import Download from './Download'

import './Polyfills'
import i18n, { initI18n, serverErrorText, serverErrorIsExpected } from './i18n'
import * as keys from './keys'
import * as stream from './stream'
import { Tooltip } from 'react-tooltip'
import * as Clipboard from "clipboard-polyfill/dist/clipboard-polyfill.promise"

// global namespace
window.gdprshare = {}

gdprshare.config = {
    maxFileSize: 25,
    maxExpiry: 14,
    maxCount: 15,
    saveClientInfo: false,
    reportRetention: 14,
    geoIP: false,
    privacyUrl: '',
    imprintUrl: '',
    contentMaxLength: 1024,
    keyLength: 32,
    saveFiles: true,
    showCountdown: false,
    apiPrefix: '/api/v1',
    apiUrl: '/api/v1/files',
}

// A config request that never answers must not leave the visitor staring at a
// blank page, the defaults above are good enough to render with.
gdprshare.configTimeoutMs = 5000

gdprshare.loadConfig = async function () {
    const controller = new AbortController()
    const timer = setTimeout(function () { controller.abort() }, gdprshare.configTimeoutMs)

    try {
        const response = await window.fetch(gdprshare.config.apiPrefix + '/config', {
            signal: controller.signal,
        })
        if (!response.ok)
            return
        const serverConfig = await response.json()
        Object.assign(gdprshare.config, serverConfig)
    } catch (error) {
        console.log('load config:', error)
    } finally {
        clearTimeout(timer)
    }
}

gdprshare.serverErrorText = serverErrorText

gdprshare.displayErr = function (error, tone) {
    console.log(error)
    this.setState({
        error: error.toString(),
        errorTone: tone || 'error',
        mask: false,
        filesBusy: false,
        phase: null,
    })
}

// Reports a server error response, calling it a notice when it is one.
gdprshare.displayServerErr = function (data) {
    // A session that ran out mid visit is not an error to read, it is a login
    // to do again. Loading the page hands that to the server, which knows where
    // to send the visitor.
    if (data && data.code === 'not_signed_in') {
        window.location.reload()

        return
    }

    gdprshare.displayErr.call(
        this,
        serverErrorText(data),
        serverErrorIsExpected(data) ? 'notice' : 'error',
    )
    this.setState({ errorCode: data && data.code })
}

gdprshare.asTextErr = async function (response, error) {
    console.log(error)
    try {
        let text = await response.text()
        gdprshare.displayErr.call(this, text)
    } catch (err) {
        gdprshare.displayErr.call(this, err)
    }
}


applyTheme(storedTheme())

var rootEl = document.getElementById('app-content')


var errPage = function () {
    const root = ReactDOM.createRoot(rootEl)
    root.render(<ErrPage />)
    throw 'browser does not support required functions'
}

// IE
if (!window.crypto || !window.TextEncoder || !window.Promise || !window.File || !window.fetch) {
    errPage()
}

gdprshare.encrypt = async function (clearText, key) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12))
    const gcmParams = {
        name: 'aes-gcm',
        iv: iv,
    }

    const cryptoKey = await window.crypto.subtle.importKey('raw', key, 'aes-gcm', true, ['encrypt'])
    const cipherText = await window.crypto.subtle.encrypt(gcmParams, cryptoKey, clearText)

    return Buffer.concat([iv, Buffer.from(cipherText)])
}

gdprshare.encryptBlob = function (file, key, onProgress) {
    return stream.encryptBlob(file, key, onProgress)
}

gdprshare.encryptRecords = function (file, key, onBytes, onProgress) {
    return stream.encryptRecords(file, key, onBytes, onProgress)
}

gdprshare.recordSize = stream.recordSize

// Opens a response body as records arrive, so the file is never held whole. A
// share written before the record format existed is one nonce and one
// ciphertext, which has to be read whole to be opened at all.
gdprshare.decryptResponse = async function (response, key, onProgress, onPlain) {
    const total = parseInt(response.headers.get('Content-Length') || '0', 10)
    const reader = response.body.getReader()

    var prefix = new Uint8Array(0)
    const add = function (chunk) {
        const grown = new Uint8Array(prefix.length + chunk.length)
        grown.set(prefix, 0)
        grown.set(chunk, prefix.length)
        prefix = grown
    }

    // enough of the start to tell the two formats apart
    while (prefix.length < stream.headerLength + stream.tagLength) {
        const step = await reader.read()
        if (step.done)
            break

        add(step.value)
    }

    if (!stream.looksStreamed(prefix)) {
        for (;;) {
            const step = await reader.read()
            if (step.done)
                break

            add(step.value)
            if (onProgress)
                onProgress(prefix.length, total)
        }

        const whole = new Uint8Array(await gdprshare.decrypt(prefix.buffer, key))
        if (onPlain) {
            await onPlain(whole)

            return null
        }

        return new Blob([whole])
    }

    const body = new ReadableStream({
        start: function (controller) {
            controller.enqueue(prefix)
        },
        pull: async function (controller) {
            const step = await reader.read()
            if (step.done)
                controller.close()
            else
                controller.enqueue(step.value)
        },
    })

    try {
        return await stream.decryptStream(body, key, onProgress, total, onPlain)
    } catch (error) {
        throw gdprshare.decryptionError(error)
    }
}

gdprshare.decrypt = async function (data, key) {
    const iv = data.slice(0, 12)
    const cipherText = data.slice(12)
    var gcmParams = {
        name: 'aes-gcm',
        iv: iv,
    }

    try {
        let cryptoKey = await window.crypto.subtle.importKey('raw', key, 'aes-gcm', true, ['decrypt'])

        return await window.crypto.subtle.decrypt(gcmParams, cryptoKey, cipherText)
    } catch (error) {
        throw gdprshare.decryptionError(error)
    }
}

// What to tell someone whose file did not open. A failed tag check is what a
// wrong key or password looks like, so that is the first reading.
gdprshare.decryptionError = function (error) {
    if (error instanceof DOMException)
        return i18n.t('errors.invalidPassword')

    if (error.name === 'OperationError')
        return i18n.t('errors.decryptionFailed')

    return error
}

// The API sends country codes with English names. The browser already knows
// every country in the visitor's language, so the names are looked up here
// rather than translated 249 times in every locale file. Servers or browsers
// without the data fall back to the name the API sent.
var regionNames = {}

gdprshare.regionName = function (code, fallback) {
    var language = i18n.language

    if (!(language in regionNames)) {
        try {
            regionNames[language] = new Intl.DisplayNames([language], {type: 'region'})
        } catch (e) {
            console.log('region names:', e)
            regionNames[language] = null
        }
    }

    if (!regionNames[language])
        return fallback

    try {
        return regionNames[language].of(code) || fallback
    } catch (e) {
        return fallback
    }
}

// Dates follow the language the interface is in, so a German page does not
// print American dates.
gdprshare.formatDate = function (date) {
    return new Date(date).toLocaleDateString(i18n.language)
}

gdprshare.formatDateTime = function (date) {
    return new Date(date).toLocaleString(i18n.language)
}

gdprshare.formatSize = function (bytes) {
    var units = ['B', 'KB', 'MB', 'GB']
    var value = bytes
    var unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
    }
    // a whole number reads better without a nought after the point: 25 MB, not
    // 25.0 MB
    if (unit === 0 || value % 1 === 0)
        return value + ' ' + units[unit]

    return value.toFixed(1) + ' ' + units[unit]
}

// keeps a stepper or a typed value inside what the server accepts
gdprshare.clamp = function (value, min, max) {
    var number = parseInt(value, 10)
    if (isNaN(number))
        return min
    return Math.min(Math.max(number, min), max)
}

gdprshare.keyToB64 = keys.keyToB64
gdprshare.keyFromB64 = keys.keyFromB64
gdprshare.passwordPrefix = keys.passwordPrefix
gdprshare.readFragment = keys.readFragment
gdprshare.withoutSecret = keys.withoutSecret

gdprshare.deriveKey = function (secret, password) {
    return keys.deriveKey(secret, password, gdprshare.config.keyLength)
}

gdprshare.copyHandler = function (event) {
    var btn = event.currentTarget
    var input = btn.closest('.link-group').querySelector('input')

    gdprshare.copyText.call(this, btn, input ? input.value : '')
}

gdprshare.copyText = function (btn, value) {
    this.setState({
        error: null
    })
    btn.blur()

    var me = this
    Clipboard.writeText(value).then(
        function () {
            gdprshare.showTooltip.bind(me)(btn, i18n.t('common.copied'))
        },
        function (err) {
            console.log(err)
            gdprshare.showTooltip.bind(me)(btn, i18n.t('common.copyFailed'))
        },
    )
}


gdprshare.showTooltip = function (btn, message) {
    this.setState({
        copy: message,
    })

    // the tooltip is the button's label the rest of the time
    window.clearTimeout(this.copyTimer)
    this.copyTimer = window.setTimeout(function () {
        this.setState({ copy: null })
    }.bind(this), 1500)
}

gdprshare.confirmReceipt = function (fileId) {
    window.fetch(gdprshare.config.apiUrl + '/' + fileId, {
        method: 'POST',
    }).catch(function (error) {
        console.log(error)
    })
}

const root = ReactDOM.createRoot(rootEl)

Promise.all([gdprshare.loadConfig(), initI18n()]).then(function () {
    root.render(
        <BrowserRouter>
            <Shell>
                <Routes>
                    <Route path="/" element={<Upload />} />
                    <Route path="/uploaded" element={<Uploaded />} />
                    <Route path="/d/:fileId" element={<Download />} />
                </Routes>
            </Shell>
        </BrowserRouter>
    )
})
