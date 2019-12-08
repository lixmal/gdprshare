import React from 'react'
import Classnames from 'classnames'
import Octicon, { CloudUpload, Key } from '@primer/octicons-react'
import BsCustomFileInput from 'bs-custom-file-input'
import Alert from './Alert'

export default class Upload extends React.Component {
    constructor() {
        super()
        this.handleFile = this.handleFile.bind(this)
        this.handleUpload = this.handleUpload.bind(this)
        this.handleDrop = this.handleDrop.bind(this)
        this.handleDragOn = this.handleDragOn.bind(this)
        this.handleDragOff = this.handleDragOff.bind(this)
        this.uploadFile = this.uploadFile.bind(this)
        this.reGenPassword = this.reGenPassword.bind(this)

        this.state = {
            error: null,
            mask: false,
        }
    }

    componentDidMount() {
        BsCustomFileInput.init()
    }

    outerClasses() {
        return Classnames({
            'app-outer': true,
            'drag-outer': this.state.isDragOver,
            'loading-mask': this.state.mask,
        })
    }

    innerClasses() {
        return Classnames({
            'app-inner': true,
            'drag-inner': this.state.isDragOver,
        })
    }


    dndClasses() {
        return Classnames({
            'drag-text-visible': this.state.isDragOver,
            'drag-text': true,
        })
    }

    genPassword(length) {
        function genString() {
            var array = new Uint16Array(length)
            window.crypto.getRandomValues(array)
            var array = Array.apply([], array)
            array = array.filter(function(x) {
                // -.0-9A-Za-z
                return x >= 45 && x <=46 || x >= 48 && x<=57 || x >= 65 && x<= 90 || x >= 97 && x <= 122
            })
            return String.fromCharCode.apply(String, array)
        }
        var randomString = genString()
        while (randomString.length < length) {
            randomString += genString()
        }
        return randomString
    }

    reGenPassword(event) {
        var btn = event.currentTarget
        btn.blur()
        var val = btn.parentNode.nextSibling.value = this.genPassword(gdprshare.config.passwordLength)
    }

    uploadFile(data, filename) {
        var formData = new FormData()
        var file = new File(
            [ data ],
            {
                type: 'application/octet-stream'
            },
        )

        var email = this.refs.email.value
        formData.append('file', file, filename)
        formData.append('filename', filename)
        formData.append('count', this.refs.count.value)
        formData.append('expiry', this.refs.expiry.value)
        formData.append('email', email)

        window.localStorage.setItem('email', email)

        window.fetch(gdprshare.config.apiUrl, {
            method: 'POST',
            body: formData,
        }).then(function (response) {
            if (response.ok)
                this.props.history.push(
                    'uploaded',
                    {
                        location: location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '') + response.headers.get('Location'),
                        // unencrypted filename
                        filename: this.refs.file.files[0].name,
                        password: this.refs.password.value,
                        count: this.refs.count.value,
                    }
                )
            else {
                response.clone().json().then(function(data) {
                    this.setState({
                        error: data.message,
                        mask: false,
                    })
                }.bind(this), gdprshare.fetcherr.bind(this, response))
            }
        }.bind(this), gdprshare.rejecterr.bind(this))
    }

    encrypt(clearText, salt, password, callback) {
        window.crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(password),
            { name: 'PBKDF2' },
            false,
            [ 'deriveBits', 'deriveKey' ]
        ).then(function (keyMaterial) {
            gdprshare.deriveKey(keyMaterial, salt, function (key) {
                var iv = window.crypto.getRandomValues(new Uint8Array(12))
                var gcmParams = {
                    name: 'aes-gcm',
                    iv: iv,
                }
                window.crypto.subtle.encrypt(gcmParams, key, clearText).then(function(cipherText) {
                    callback(Buffer.concat([iv, Buffer.from(cipherText)]))
                }.bind(this), gdprshare.rejecterr.bind(this))
            }.bind(this))
        }.bind(this), gdprshare.rejecterr.bind(this))
    }

    handleDrop(event) {
        event.preventDefault()
        event.stopPropagation()

        this.setState({
            isDragOver: false
        })

        var files = event.dataTransfer.files
        if (!this.checkFileSize(files[0], event))
            return

        this.refs.file.files = files
        //this.handleUpload(event)
        this.refs.submit.click()
    }

    handleUpload(event) {
        event.preventDefault()
        if (this.state.mask)
            return

        this.setState({
            error: null,
            mask: true,
        })

        var password = this.refs.password.value
        var salt = window.crypto.getRandomValues(new Uint8Array(32))
        var file = this.refs.file.files[0]

        // encryption of filename
        this.encrypt(new TextEncoder().encode(file.name), salt, password, function (cipherText) {
            var filename = Buffer.concat([salt, Buffer.from(cipherText)]).toString('base64')

            var reader = new FileReader()
            reader.onload = function () {
                // encryption of file
                this.encrypt(reader.result, salt, password, function (clearText) {
                    this.uploadFile(clearText, filename)
                }.bind(this))
            }.bind(this)
            reader.readAsArrayBuffer(file)
        }.bind(this))
    }

    checkFileSize(file) {
        if (!file)
            return
        var allowedSize = gdprshare.config.maxFileSize
        
        if (file.size > allowedSize * 1024 * 1024) {
            this.setState({
                error: 'File to big, maximum allowed size: ' + allowedSize + ' MiB.',
            })
            this.refs.file.value = null
            return false
        }
        return true
    }

    handleFile(event) {
        var file = event.currentTarget.files[0]
        if (!this.checkFileSize(file, event))
            return
    }

    handleDragOn(event) {
        event.preventDefault()
        event.stopPropagation()
        this.setState({
            isDragOver: true
        })
    }

    handleDragOff(event) {
        event.preventDefault()
        event.stopPropagation()
        this.setState({
            isDragOver: false
        })
    }

    render() {
        return (
            <div className="container-fluid col-sm-4">
                <div className={this.dndClasses()} onDrop={this.handleDrop} onDragEnter={this.handleDragOn} onDragOver={this.handleDragOn} onDragLeave={this.handleDragOff} onDragEnd={this.handleDragOff}>
                    <Octicon size="large" icon={CloudUpload} />
                    <h3>
                        drop file here
                    </h3>
                </div>
                <div className={this.outerClasses()} onDragEnter={this.handleDragOn}>
                    <h4 className="text-center">GDPRShare Upload</h4>
                    <form ref="form" className={this.innerClasses()} onSubmit={this.handleUpload}>
                        <div className="form-group row">
                            <label htmlFor="file" className="col-sm-3 col-form-label col-form-label-sm">
                                File
                            </label>
                            <div className="col-sm-9">
                                <div className="custom-file">
                                    <input className="custom-file-input form-control form-control-sm" id="file" type="file" ref="file" onChange={this.handleFile} required autoFocus />
                                    <label className="custom-file-label col-form-label col-form-label-sm" htmlFor="file">
                                        Select or drop file
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div>
                            <div className="form-group row">
                                <label htmlFor="email" className="col-sm-3 col-form-label col-form-label-sm">
                                    Notification
                                </label>
                                <div className="col-sm-9">
                                    <input className="form-control form-control-sm" id="email" type="email" ref="email" placeholder="Enter email (optional)" maxLength="255" aria-describedby="emailHelp"
                                        defaultValue={window.localStorage.getItem('email')}
                                    />
                                    <small id="emailHelp" className="form-text text-muted">Email address to receive download notifications</small>
                                </div>
                            </div>

                            <div className="form-group row">
                                <label htmlFor="count" className="col-sm-3 col-form-label col-form-label-sm">
                                    Count
                                </label>
                                <div className="col-sm-9">
                                    <input className="form-control form-control-sm" className="form-control form-control-sm" id="count" type="number" ref="count" min="1" max="15" defaultValue="1" required aria-describedby="countHelp" />
                                    <small id="countHelp" className="form-text text-muted">Maximum number of downloads before file is deleted</small>
                                </div>
                            </div>

                            <div className="form-group row">
                                <label htmlFor="expiry" className="col-sm-3 col-form-label col-form-label-sm">
                                    Expiry
                                </label>
                                <div className="col-sm-9">
                                    <input className="form-control form-control-sm" id="expiry" type="number" ref="expiry" min="1" max="14" defaultValue="7" required aria-describedby="expiryHelp" />
                                    <small id="expiryHelp" className="form-text text-muted">Maximum days before file is deleted</small>
                                </div>
                            </div>
                        </div>

                        <div className="form-group row">
                            <label htmlFor="password" className="col-sm-3 col-form-label col-form-label-sm">
                                Password
                            </label>
                            <div className="col-sm-9">
                                <div className="input-group">
                                    <div className="input-group-prepend">
                                        <button onClick={this.reGenPassword} type="button" className="input-group-text">
                                            <Octicon icon={Key} />
                                        </button>
                                    </div>
                                    <input className="form-control form-control-sm" id="password" type="text" ref="password" placeholder="Password" maxLength="255"
                                        defaultValue={this.genPassword(gdprshare.config.passwordLength)} required
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="text-center col-sm-12">
                            <input type="submit" ref="submit" className="btn btn-primary" value="Upload"/>
                        </div>

                    </form>

                    <br />

                    <Alert error={this.state.error} />
                </div>
            </div>
        )
    }
}
