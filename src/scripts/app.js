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

const history = createBrowserHistory()

// global namespace
window.gdprshare = {}

// TODO: get config from server
gdprshare.config = {
    maxFileSize: 25,
    passwordLength: 12,
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

// IE
if (!window.crypto || !window.TextEncoder || !window.Promise || !window.File) {
    ReactDOM.render(
        <ErrPage />,
        rootEl
    )
    throw 'browser does not support required functions'
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
