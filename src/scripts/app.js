import '../style/app.css'
import React from 'react'
import ReactDOM from 'react-dom'

import { Switch, Router, Route } from 'react-router'
import { createBrowserHistory } from 'history'

import ErrPage from './ErrPage'
import Upload from './Upload'
import Uploaded from './Uploaded'
import Download from './Download'

import './Polyfills'
import ReactTooltip from 'react-tooltip'
import * as Clipboard from "clipboard-polyfill/dist/clipboard-polyfill.promise"

const history = createBrowserHistory()

// global namespace
window.gdprshare = {}

// TODO: get config from server
gdprshare.config = {
    maxFileSize: 25,
    contentMaxLength: 1024,
    keyLength: 32,
    saveFiles: true,
    apiPrefix: '/api/v1',
    apiUrl: '/api/v1/files',
}

gdprshare.displayErr = function (error) {
    console.log(error)
    this.setState({
        error: error.toString(),
        mask: false,
    })
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


var rootEl = document.getElementById('app-content')


var errPage = function () {
    ReactDOM.render(
        <ErrPage />,
        rootEl
    )
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
            error = "Invalid password"
        else if (error.name === 'OperationError')
            error = 'Decryption error. Wrong password?'

        throw error
    }
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
    this.setState({
        error: null
    })

    var btn = event.currentTarget
    btn.blur()
    var element = btn.parentNode.nextSibling
    var value
    if (element.tagName === 'INPUT') {
        value = element.value
    }
    else {
        try {
            var files = JSON.parse(window.localStorage.getItem('savedFiles'))
            value = files[element.textContent].location
        }
        catch (e) {
            console.log(e)
            gdprshare.showTooltip.bind(this)(btn, 'Failed to get file URL')
            return
        }
    }


    var me = this
    Clipboard.writeText(value).then(
        function () {
            gdprshare.showTooltip.bind(me)(btn, 'Copied')
        },
        function (err) {
            console.log(err)
            gdprshare.showTooltip.bind(me)(btn, 'Failed to copy')
        },
    )
}


gdprshare.showTooltip = function (btn, message) {
    this.setState({
        copy: message,
    })
    ReactTooltip.show(btn)
    ReactTooltip.hide(btn)
}

gdprshare.handleTipContent = function () {
    return this.state.copy
}

gdprshare.confirmReceipt = function (fileId) {
    window.fetch(gdprshare.config.apiUrl + '/' + fileId, {
        method: 'POST',
    }).catch(function (error) {
        console.log(error)
    })
}

ReactDOM.render(
    <Router history={history}>
        <Switch>
            <Route path="/" exact    component={Upload} />
            <Route path="/uploaded"  component={Uploaded} />
            <Route path="/d/:fileId" component={Download} />
        </Switch>
    </Router>,
    rootEl
)
