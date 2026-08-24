import '../style/app.css'
import React from 'react'
import ReactDOM from 'react-dom/client'

import { BrowserRouter, Routes, Route } from 'react-router-dom'

import ErrPage from './ErrPage'
import Shell, { storedTheme, applyTheme } from './Shell'
import Upload from './Upload'
import Uploaded from './Uploaded'
import Download from './Download'

import './Polyfills'
import i18n, { initI18n, serverErrorText, serverErrorIsExpected } from './i18n'
import { Tooltip } from 'react-tooltip'
import * as Clipboard from "clipboard-polyfill/dist/clipboard-polyfill.promise"

// global namespace
window.gdprshare = {}

gdprshare.config = {
    maxFileSize: 25,
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
        if (error instanceof DOMException)
            error = i18n.t('errors.invalidPassword')
        else if (error.name === 'OperationError')
            error = i18n.t('errors.decryptionFailed')

        throw error
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
    return (unit === 0 ? value : value.toFixed(1)) + ' ' + units[unit]
}

// keeps a stepper or a typed value inside what the server accepts
gdprshare.clamp = function (value, min, max) {
    var number = parseInt(value, 10)
    if (isNaN(number))
        return min
    return Math.min(Math.max(number, min), max)
}

gdprshare.keyToB64 = function (key) {
    const b64 = Buffer.from(key).toString('base64')
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

gdprshare.keyFromB64 = function (b64) {
    const key = b64.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(key, 'base64')
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
