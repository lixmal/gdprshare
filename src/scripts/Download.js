import React from 'react'
import { Link } from 'react-router-dom'
import Classnames from 'classnames'
import Alert from './Alert'

export default class Download extends React.Component {
    constructor() {
        super()
        this.url = '/api/v1/download'

        this.handleDownload = this.handleDownload.bind(this)
        this.downloadFile = this.downloadFile.bind(this)

        this.state = {
            error: null,
            mask: false,
            direct: false,
            finished: false,
        }
    }

    componentDidMount() {
        var url = new URL(window.location.href)
        var password = url.searchParams.get('p')

        // don't render password field
        if (password) {
            this.setState({
                direct: true,
            })

            this.handleDownload(null, password)
        }
    }

    classes() {
        return Classnames({
            'app-outer': true,
            'loading-mask': this.state.mask,
        })
    }

    downloadFile(data, filename) {
        var blob
        if (typeof File === 'function') {
            try {
                blob = new File([data], filename)
            } catch (e) { /* Edge */ }
        }
        if (typeof blob === 'undefined') {
            blob = new Blob([this.response], { type: type })
        }

        if (typeof window.navigator.msSaveBlob !== 'undefined') {
            // IE workaround for "HTML7007: One or more blob URLs were revoked by closing the blob for which they were created. These URLs will no longer resolve as the data backing the URL has been freed."
            window.navigator.msSaveBlob(blob, filename)
        } else {
            var URL = window.URL || window.webkitURL
            var downloadUrl = URL.createObjectURL(blob)

            if (filename) {
                // use HTML5 a[download] attribute to specify filename
                var a = document.createElement('a')
                // safari doesn't support this yet
                if (typeof a.download === 'undefined') {
                    window.location = downloadUrl
                } else {
                    a.href = downloadUrl
                    a.download = filename
                    document.body.appendChild(a)
                    a.click()
                }
            } else {
                window.location = downloadUrl
            }

            setTimeout(function () { URL.revokeObjectURL(downloadUrl) }, 100)
        }
        this.setState({
            mask: false,
            // no second download allowed
            finished: true,
        })
    }

    decrypt(cipherText, salt, password, callback) {
        window.crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(password),
            { name: 'PBKDF2' },
            false,
            [ 'deriveBits', 'deriveKey' ]
        ).then(function (keyMaterial) {
            gdprshare.deriveKey(keyMaterial, salt, function (key) {
                var iv = cipherText.slice(0,12)
                var cipherT  = cipherText.slice(12)
                var gcmParams = {
                    name: 'aes-gcm',
                    iv: iv,
                }

                window.crypto.subtle.decrypt(gcmParams, key, cipherT).then(callback, function(error) {
                    console.log(error)
                    var err = error.toString()
                    if (err === 'OperationError')
                        err = 'Decryption error. Wrong password?'
                    this.setState({
                        error: err,
                        mask: false,
                    })
                }.bind(this))
            }.bind(this))
        }.bind(this), gdprshare.rejecterr.bind(this))
    }

    handleDownload(event, password) {
        if (event)
            event.preventDefault()

        if (this.state.mask)
            return

        if (!password)
            password = this.refs.password.value

        this.setState({
            error: null,
            mask: true
        })

        let fileId = window.location.pathname.split('/').pop()

        window.fetch(this.url + '/' + fileId, {
            method: 'GET',
        }).then(function (response) {
            if (response.ok) {
                var buf = Buffer.from(response.headers.get('X-Filename'), 'base64')
                var salt = buf.slice(0,32)
                var filename  = buf.slice(32)

                // decryption of filename
                this.decrypt(filename, salt, password, function (clearText) {
                    var filename = new TextDecoder().decode(clearText)

                    response.arrayBuffer().then(function (file) {
                        this.decrypt(file, salt, password, function(clearText) {
                            this.downloadFile(clearText, filename)
                        }.bind(this), gdprshare.rejecterr.bind(this))
                    }.bind(this), gdprshare.rejecterr.bind(this))
                }.bind(this), gdprshare.rejecterr.bind(this))
            }
            else {
                response.clone().json().then(function(data) {
                    this.setState({
                        error: data.message,
                    })
                }.bind(this), gdprshare.fetcherr.bind(this, response))
            }

            this.setState({
                mask: false
            })
        }.bind(this), gdprshare.rejecterr.bind(this))
    }

    render() {
        var form = (
            <form className="app-inner" onSubmit={this.handleDownload}>
                <div className="form-group row">
                    <label htmlFor="password" className="col-sm-3 col-form-label">Password</label>
                    <div className="col-sm-9">
                        <input className="form-control" id="password" type="password" ref="password" placeholder="Password" maxLength="255" autoFocus="autoFocus" required="required"/>
                    </div>
                </div>
                <div className="text-center col-sm-12">
                    <input type="submit" className="btn btn-primary" value="Download"/>
                </div>
            </form>
        )
        return (
            <div className="container-fluid col-sm-4">
                <div className={this.classes()}>
                    <h4 className="text-center">GDPRShare Download</h4>
                    { this.state.direct || this.state.finished ? null : form }
                    <br />
                    <Alert error={this.state.error} />

                    <div className="text-center col-sm-12">
                        <Link to="/">Upload new file</Link>
                    </div>
                </div>
            </div>
        )
    }
}
