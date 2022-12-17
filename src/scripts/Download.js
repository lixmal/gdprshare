import React from 'react'
import { Link } from 'react-router-dom'
import Classnames from 'classnames'
import Alert from './Alert'
import Success from './Success'
import Modal from 'react-modal'

export default class Download extends React.Component {
    constructor() {
        super()
        this.handleDownload = this.handleDownload.bind(this)
        this.downloadFile = this.downloadFile.bind(this)
        this.closeModal = this.closeModal.bind(this)

        this.state = {
            error: null,
            mask: false,
            direct: false,
            finished: false,
            modalContent: null,
            modalOpen: false,
        }
    }

    componentDidMount() {
        var password = window.location.hash.substring(1)

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

    closeModal() {
        this.setState({
            modalOpen: false,
            modalContent: null,
        })
    }

    downloadFile(data, filename) {
        var blob = new File([data], filename)

        if (typeof window.navigator.msSaveBlob !== 'undefined') {
            // IE workaround for "HTML7007: One or more blob URLs were revoked by closing the blob for which they were created.
            // These URLs will no longer resolve as the data backing the URL has been freed."
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
            ['deriveBits', 'deriveKey']
        ).then(function (keyMaterial) {
            gdprshare.deriveKey(keyMaterial, salt, function (key) {
                var iv = cipherText.slice(0, 12)
                var cipherT = cipherText.slice(12)
                var gcmParams = {
                    name: 'aes-gcm',
                    iv: iv,
                }

                window.crypto.subtle.decrypt(gcmParams, key, cipherT).then(callback, function (error) {
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

        window.fetch(gdprshare.config.apiUrl + '/' + fileId, {
            method: 'GET',
        }).then(function (response) {
            if (response.ok) {
                let type = response.headers.get('X-Type')

                var buf = Buffer.from(response.headers.get('X-Filename'), 'base64')
                var salt = buf.slice(0, 32)
                var filename = buf.slice(32)

                response.arrayBuffer().then(function (file) {
                    // decryption of file
                    this.decrypt(file, salt, password, function (fileClearText) {
                        if (type === 'text') {
                            this.setState({
                                modalContent: new TextDecoder().decode(fileClearText),
                                modalOpen: true,
                            })
                            gdprshare.confirmReceipt(fileId)
                        }
                        else {
                            // decryption of filename and download
                            this.decrypt(filename, salt, password, function (clearText) {
                                var filename = new TextDecoder().decode(clearText)
                                this.downloadFile(fileClearText, filename)

                                gdprshare.confirmReceipt(fileId)
                            }.bind(this), gdprshare.rejecterr.bind(this))
                        }
                    }.bind(this), gdprshare.rejecterr.bind(this))
                }.bind(this), gdprshare.rejecterr.bind(this))
            }
            else {
                response.clone().json().then(function (data) {
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
                        <input className="form-control" id="password" type="password" ref="password" placeholder="Password" maxLength="255" autoFocus required />
                    </div>
                </div>
                <div className="text-center col-sm-12">
                    <input type="submit" className="btn btn-primary" value="Download" />
                </div>
            </form>
        )

        return (
            <div className="container-fluid col-sm-4">
                <div className={this.classes()}>
                    <h4 className="text-center">GDPRShare Download</h4>
                    {this.state.direct || this.state.finished ? null : form}

                    <br />
                    {this.state.finished && <Success message="Successfully downloaded, check your download folder" />}
                    <Alert error={this.state.error} />

                    <div className="text-center col-sm-12">
                        <Link to="/">Upload new file</Link>
                    </div>
                </div>
                <Modal isOpen={this.state.modalOpen}>
                    <div className="card">
                        <div className="card-body">
                            <p className="r-modal">
                                {this.state.modalContent}
                            </p>
                        </div>
                    </div>
                    <button className="col-sm-1 btn btn-primary" onClick={this.closeModal}>
                        Close
                    </button>
                </Modal>
            </div >
        )
    }
}
