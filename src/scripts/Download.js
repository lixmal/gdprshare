import React from 'react'
import { Link } from 'react-router'
import Classnames from 'classnames'
import Alert from './Alert'
import { Lock, ImageIcon, Timer, Check } from './Icons'
import Success from './Success'
import Modal from 'react-modal'
import { withTranslation } from 'react-i18next'

// Server codes that mean the link itself is finished, as opposed to one that
// works but not from here or not yet.
const GONE_CODES = [
    'file_not_found',
    'file_not_found_or_limit_exceeded',
    'download_count_expired',
    'file_expired',
]

// exported unwrapped for tests, the app uses the translated default export
export class Download extends React.Component {
    constructor() {
        super()
        this.passwordInput = React.createRef()

        this.handleDownload = this.handleDownload.bind(this)
        this.downloadFile = this.downloadFile.bind(this)
        this.closeModal = this.closeModal.bind(this)
        this.handleViewImage = this.handleViewImage.bind(this)
        this.handleImageZoom = this.handleImageZoom.bind(this)
        this.handleVisibilityChange = this.handleVisibilityChange.bind(this)
        this.reportProgress = this.reportProgress.bind(this)

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
            // the link carried a secret that only opens the file together with
            // a password the sender passed on some other way
            needsPassword: false,
            secret: null,
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

        const link = gdprshare.readFragment(window.location.hash.substring(1))

        // half of what is needed: ask for the password before spending a
        // download on a key that cannot open the file
        if (link.needsPassword) {
            this.setState({
                needsPassword: true,
                secret: link.secret,
            })

            return
        }

        // don't render password field
        if (link.secret) {
            this.setState({
                disableForm: true,
            })

            this.handleDownload(null, link.secret)
        }
    }

    classes() {
        return Classnames({
            'app-outer': true,
            // a phase draws its own progress block, so the overlay would just
            // dim the numbers the visitor is reading
            'loading-mask': this.state.mask && !this.state.phase,
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

    // Without a Content-Length there is no percentage to show and the phase
    // label stays indeterminate.
    reportProgress(received, total) {
        this.setState({
            progress: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
        })
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
            const typed = this.passwordInput.current.value

            if (this.state.needsPassword) {
                // deriving takes long enough to be felt on a phone
                this.setState({error: null, mask: true, phase: 'unlocking', progress: null})
                key = await gdprshare.deriveKey(this.state.secret, typed)
            } else {
                const link = gdprshare.readFragment(typed)

                // a secret pasted by hand says just as well that a password
                // belongs with it
                if (link.needsPassword) {
                    this.passwordInput.current.value = ''
                    this.setState({
                        needsPassword: true,
                        secret: link.secret,
                    })

                    return
                }

                key = link.secret
            }
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
                return gdprshare.displayServerErr.call(this, fetchData)
            }

            let type = response.headers.get('X-Type')
            let ephemeral = parseInt(response.headers.get('X-Ephemeral') || '0', 10)

            var filename = Buffer.from(response.headers.get('X-Filename'), 'base64')

            // Records are opened as they arrive, so the file is never held
            // whole. A browser without streaming reads it in one piece, which
            // is all it can do.
            var fileClearText
            if (response.body && response.body.getReader) {
                fileClearText = await gdprshare.decryptResponse(response, key, this.reportProgress)
            } else {
                const whole = await this.readWithProgress(response)
                fileClearText = new Blob([await gdprshare.decrypt(whole, key)])
            }

            this.setState({ phase: 'decrypting', progress: null })

            if (type === 'text') {
                this.setState({
                    modalContent: await fileClearText.text(),
                    modalOpen: true,
                    mask: false,
                    phase: null,
                    disableForm: true,
                })

                gdprshare.confirmReceipt(fileId)
            }
            else if (type === 'image') {
                var URL = window.URL || window.webkitURL
                var imageUrl = URL.createObjectURL(fileClearText)

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
        const done = this.state.successful || this.state.imageReady
        // the link ran out or was deleted: promising a shared file would be a lie
        const gone = GONE_CODES.indexOf(this.state.errorCode) !== -1

        // one field, two things it can hold: the secret from the link when the
        // link was split, or the password the sender set on top of it
        const asking = this.state.needsPassword
            ? {label: t('download.senderPassword'), hint: t('download.senderPasswordHint')}
            : {label: t('download.password'), hint: t('download.passwordHint')}

        var form = (
            <form className="app-inner" onSubmit={this.handleDownload}>
                <div className="field">
                    <label htmlFor="password" className="lbl">{asking.label}</label>
                    <input className="form-control mono-input" id="password" type="password" ref={this.passwordInput}
                           placeholder={asking.label} maxLength="255" autoFocus required />
                    <span className="hint">{asking.hint}</span>
                </div>
                <input type="submit" className="btn btn-primary btn-block" value={t('download.submit')} />
            </form>
        )

        // tells the visitor the wait is doing something, and roughly how much of
        // it is left
        var status = this.state.mask && this.state.phase ? (
            <div className="download-status" role="status" aria-live="polite">
                <div className="download-status-head">
                    <span className="download-status-text">
                        {t('download.status.' + this.state.phase)}
                    </span>
                    {this.state.progress !== null && (
                        <span className="download-status-value">{this.state.progress}%</span>
                    )}
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
            <div className="container-fluid">
                <div className={this.classes()}>
                    <div className="app-inner">
                        <div className="d-flex align-items-center gap-3">
                            <span className={done ? 'check-badge' : 'btn btn-icon'}
                                  style={{pointerEvents: 'none'}}>
                                {done ? <Check size="16" /> : <Lock size="15" />}
                            </span>
                            <div className="d-flex flex-column">
                                <h4>{gone ? t('download.goneTitle') : t('download.title')}</h4>
                                {!gone && <span className="hint">{t('download.subtitle')}</span>}
                            </div>
                        </div>

                        {status}
                        {this.state.disableForm ? null : form}

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
                            <button className="btn btn-primary btn-block" id="view-image" onClick={this.handleViewImage}>
                                <ImageIcon size="15" />
                                {t('download.viewImage')}
                            </button>
                        )}

                        <Alert error={this.state.error} tone={this.state.errorTone} />
                    </div>
                </div>

                <div className="text-center" style={{marginTop: '16px'}}>
                    <Link to="/">{t('download.uploadLink')}</Link>
                </div>

                <Modal isOpen={this.state.modalOpen}>
                    {this.state.modalContent && (
                        <div className="app-outer">
                            <p className="r-modal">
                                {this.state.modalContent}
                            </p>
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
                                    <Timer size="13" />
                                    {t('download.closingIn', { count: this.state.countdown })}
                                </div>
                            )}
                        </div>
                    )}
                    {this.state.modalContent && (
                        <div className="text-center" style={{marginTop: '10px'}}>
                            <button className="btn btn-primary" onClick={this.closeModal}>
                                {t('download.close')}
                            </button>
                        </div>
                    )}
                </Modal>
            </div>
        )
    }
}

export default withTranslation()(Download)
