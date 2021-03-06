import Css from '../style/app.css'
import React from 'react'
import ReactDOM from 'react-dom'

import { Switch, Router, Route } from 'react-router'
import { createBrowserHistory } from 'history'
import Classnames from 'classnames'

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
    passwordLength: 12,
    saveFiles: true,
    apiPrefix: '/api/v1',
    apiUrl: '/api/v1/files',
}

gdprshare.rejecterr = function (error) {
    console.log(error)
    this.setState({
        error: error.toString(),
        mask: false,
    })
}

gdprshare.fetcherr = function (response, error) {
    console.log(error)
    response.text().then(function(data) {
        this.setState({
            error: data,
            mask: false,
        })
    }.bind(this), gdprshare.rejecterr.bind(this))
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
// Edge/IE, doesn't support PBKDF2
try {
    window.crypto.subtle.importKey(
        'raw',
        new ArrayBuffer(),
        { name: 'PBKDF2' },
        false,
        [ 'deriveBits', 'deriveKey' ]
    ).catch(errPage)
}
catch (e) {
    errPage()
}

gdprshare.deriveKey = function (keyMaterial, salt, callback) {
    window.crypto.subtle.deriveKey(
        {
            'name': 'PBKDF2',
            salt: salt,
            'iterations': 100000,
            'hash': 'SHA-256'
        },
        keyMaterial,
        { 'name': 'AES-GCM', 'length': 256 },
        true,
        [ 'encrypt', 'decrypt' ]
    ).then(callback, gdprshare.rejecterr.bind(this))
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
