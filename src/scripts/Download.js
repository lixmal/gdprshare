import React from 'react'
import { Link } from 'react-router-dom'
import Classnames from 'classnames'
import Alert from './Alert'
import Success from './Success'
import Modal from 'react-modal'
import { withTranslation } from 'react-i18next'

// exported unwrapped for tests, the app uses the translated default export
export class Download extends React.Component {
    constructor() {
        super()
        this.handleDownload = this.handleDownload.bind(this)
        this.downloadFile = this.downloadFile.bind(this)
        this.closeModal = this.closeModal.bind(this)
        this.handleViewImage = this.handleViewImage.bind(this)
        this.handleImageZoom = this.handleImageZoom.bind(this)
        this.handleVisibilityChange = this.handleVisibilityChange.bind(this)

        this.state = {
            error: null,
            mask: false,
            disableForm: false,
            successful: false,
            modalContent: null,
            modalOpen: false,
            imageData: null,
            imageReady: false,
            imageZoomed: false,
            imageHidden: false,
            ephemeral: 0,
            countdown: 0,
            phase: null,
            progress: null,
        }
        this.countdownTimer = null
    }

    componentWillUnmount() {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer)
            this.countdownTimer = null
        }
        if (this.unblurTimeout) {
            clearTimeout(this.unblurTimeout)
            this.unblurTimeout = null
        }
        if (this.state.imageData) {
            var URL = window.URL || window.webkitURL
            URL.revokeObjectURL(this.state.imageData)
        }
        document.removeEventListener('visibilitychange', this.handleVisibilityChange)
        window.removeEventListener('blur', this.handleVisibilityChange)
        window.removeEventListener('focus', this.handleVisibilityChange)
    }

    componentDidMount() {
        document.addEventListener('visibilitychange', this.handleVisibilityChange)
        window.addEventListener('blur', this.handleVisibilityChange)
        window.addEventListener('focus', this.handleVisibilityChange)

        let key = window.location.hash.substring(1)

        // don't render password field
        if (key) {
            this.setState({
                disableForm: true,
            })

            this.handleDownload(null, gdprshare.keyFromB64(key))
        }
    }

    classes() {
        return Classnames({
            'app-outer': true,
            'loading-mask': this.state.mask,
        })
    }

    closeModal() {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer)
            this.countdownTimer = null
        }
        if (this.state.imageData) {
            var URL = window.URL || window.webkitURL
            URL.revokeObjectURL(this.state.imageData)
        }
        this.setState({
            modalOpen: false,
            modalContent: null,
            imageData: null,
            imageReady: false,
        })
    }

    handleViewImage() {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer)
            this.countdownTimer = null
        }

        var ephemeral = this.state.ephemeral
        this.setState({
            modalOpen: true,
            countdown: ephemeral > 0 ? ephemeral : 0,
        })

        if (ephemeral > 0) {
            this.countdownTimer = setInterval(function () {
                var next = this.state.countdown - 1
                if (next <= 0) {
                    this.closeModal()
                } else {
                    this.setState({ countdown: next })
                }
            }.bind(this), 1000)
        }
    }

    handleImageZoom() {
        this.setState({ imageZoomed: !this.state.imageZoomed })
    }

    handleVisibilityChange(event) {
        if (this.unblurTimeout) {
            clearTimeout(this.unblurTimeout)
            this.unblurTimeout = null
        }

        var shouldHide = event.type === 'blur' || (event.type === 'visibilitychange' && document.hidden)

        if (shouldHide) {
            this.setState({ imageHidden: true })
        } else {
            this.unblurTimeout = setTimeout(function () {
                this.setState({ imageHidden: false })
            }.bind(this), 1500)
        }
    }

    downloadFile(data, filename) {
        try {
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
        } catch (e) {
            console.log(e)
            return false
        }

        return true
    }

    // Reads the response body in chunks so the visitor sees the transfer move.
    // Falls back to a plain buffer read when the browser has no streaming
    // support, in which case there is nothing to report but the phase.
    async readWithProgress(response) {
        const total = parseInt(response.headers.get('Content-Length') || '0', 10)

        if (!response.body || !response.body.getReader)
            return response.arrayBuffer()

        const reader = response.body.getReader()
        const chunks = []
        var received = 0

        for (;;) {
            const step = await reader.read()
            if (step.done)
                break

            chunks.push(step.value)
            received += step.value.length

            // without a Content-Length there is no percentage to show, the
            // phase label stays indeterminate
            this.setState({
                progress: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
            })
        }

        const body = new Uint8Array(received)
        var offset = 0
        chunks.forEach(function (chunk) {
            body.set(chunk, offset)
            offset += chunk.length
        })

        return body.buffer
    }

    async handleDownload(event, key) {
        if (event)
            event.preventDefault()

        if (this.state.mask)
            return

        if (!key) {
            key = gdprshare.keyFromB64(this.refs.password.value)
        }

        this.setState({
            error: null,
            mask: true,
            phase: 'downloading',
            progress: null,
        })

        let fileId = window.location.pathname.split('/').pop()

        try {
            const response = await window.fetch(gdprshare.config.apiUrl + '/' + fileId, {
                method: 'GET',
            })

            if (!response.ok) {
                let fetchData
                try {
                    fetchData = await response.clone().json()
                } catch (error) {
                    return gdprshare.asTextErr.call(this, response, error)
                }
                return gdprshare.displayErr.call(this, gdprshare.serverErrorText(fetchData))
            }

            let type = response.headers.get('X-Type')
            let ephemeral = parseInt(response.headers.get('X-Ephemeral') || '0', 10)

            var filename = Buffer.from(response.headers.get('X-Filename'), 'base64')

            const file = await this.readWithProgress(response)

            this.setState({ phase: 'decrypting', progress: null })

            // decryption of file
            const fileClearText = await gdprshare.decrypt(file, key)
            if (type === 'text') {
                this.setState({
                    modalContent: new TextDecoder().decode(fileClearText),
                    modalOpen: true,
                    mask: false,
                    phase: null,
                    disableForm: true,
                })

                gdprshare.confirmReceipt(fileId)
            }
            else if (type === 'image') {
                var URL = window.URL || window.webkitURL
                var blob = new Blob([fileClearText])
                var imageUrl = URL.createObjectURL(blob)

                this.setState({
                    imageData: imageUrl,
                    imageReady: true,
                    ephemeral: ephemeral,
                    mask: false,
                    phase: null,
                    disableForm: true,
                })

                gdprshare.confirmReceipt(fileId)
            }
            else {
                // decryption of filename and download
                const filenameClearText = await gdprshare.decrypt(filename, key)

                var filename = new TextDecoder().decode(filenameClearText)
                if (this.downloadFile(fileClearText, filename)) {
                    this.setState({
                        // no second download allowed
                        successful: true,
                        mask: false,
                        phase: null,
                        disableForm: true,
                    })
                    gdprshare.confirmReceipt(fileId)
                }
                else {
                    this.setState({
                        error: this.props.t('errors.downloadCreateFailed'),
                        mask: false,
                        phase: null,
                    })
                }
            }
        } catch (error) {
            gdprshare.displayErr.call(this, error)
        }
    }

    render() {
        const t = this.props.t

        var form = (
            <form className="app-inner" onSubmit={this.handleDownload}>
                <div className="form-group row">
                    <label htmlFor="password" className="col-sm-3 col-form-label">{t('download.password')}</label>
                    <div className="col-sm-9">
                        <input className="form-control" id="password" type="password" ref="password" placeholder={t('download.password')} maxLength="255" autoFocus required />
                    </div>
                </div>
                <div className="text-center col-sm-12">
                    <input type="submit" className="btn btn-primary" value={t('download.submit')} />
                </div>
            </form>
        )

        // shown over the loading mask so the visitor knows the wait is doing
        // something, and roughly how much of it is left
        var status = this.state.mask && this.state.phase ? (
            <div className="download-status" role="status" aria-live="polite">
                <div className="download-status-text">
                    {t('download.status.' + this.state.phase)}
                </div>
                {this.state.progress !== null && (
                    <div className="download-progress"
                         role="progressbar"
                         aria-valuenow={this.state.progress}
                         aria-valuemin="0"
                         aria-valuemax="100">
                        <div className="download-progress-bar" id="download-progress-bar"
                             style={{ width: this.state.progress + '%' }}></div>
                        <span className="download-progress-value">{this.state.progress}%</span>
                    </div>
                )}
            </div>
        ) : null

        var imageModalClass = 'image-modal'
            + (this.state.imageZoomed ? ' image-zoomed' : '')
            + (this.state.imageHidden ? ' image-hidden' : '')

        return (
            <div className="container-fluid col-sm-4">
                <div className={this.classes()}>
                    {status}
                    <h4 className="text-center">{t('download.title')}</h4>
                    {this.state.disableForm ? null : form}

                    <br />
                    {this.state.successful && <Success message={t('download.success')} />}
                    {this.state.imageReady && !this.state.ephemeral && (
                        <div className={imageModalClass}
                             onContextMenu={function(e) { e.preventDefault() }}
                             onDragStart={function(e) { e.preventDefault() }}>
                            <div className="image-container">
                                <img src={this.state.imageData} alt="" id="inline-image" draggable="false" />
                                <div className="image-overlay" onClick={this.handleImageZoom}></div>
                            </div>
                        </div>
                    )}
                    {this.state.imageReady && this.state.ephemeral > 0 && !this.state.modalOpen && (
                        <div className="text-center mb-3">
                            <button className="btn btn-primary" id="view-image" onClick={this.handleViewImage}>
                                {t('download.viewImage')}
                            </button>
                        </div>
                    )}
                    <Alert error={this.state.error} />

                    <div className="text-center col-sm-12">
                        <Link to="/">{t('download.uploadLink')}</Link>
                    </div>
                </div>
                <Modal isOpen={this.state.modalOpen}>
                    {this.state.modalContent && (
                        <div className="card">
                            <div className="card-body">
                                <p className="r-modal">
                                    {this.state.modalContent}
                                </p>
                            </div>
                        </div>
                    )}
                    {this.state.imageData && this.state.ephemeral > 0 && (
                        <div className={imageModalClass}
                             onContextMenu={function(e) { e.preventDefault() }}
                             onDragStart={function(e) { e.preventDefault() }}>
                            <div className="image-container">
                                <img src={this.state.imageData} alt="" id="modal-image" draggable="false" />
                                <div className="image-overlay" onClick={this.handleImageZoom}></div>
                            </div>
                            {gdprshare.config.showCountdown && this.state.countdown > 0 && (
                                <div className="countdown" id="countdown-timer">
                                    {t('download.closingIn', { count: this.state.countdown })}
                                </div>
                            )}
                        </div>
                    )}
                    {this.state.modalContent && (
                        <button className="col-sm-1 btn btn-primary mt-2" onClick={this.closeModal}>
                            {t('download.close')}
                        </button>
                    )}
                </Modal>
            </div >
        )
    }
}

export default withTranslation()(Download)
