import React from 'react'
import { Link } from 'react-router'
import Alert from './Alert'
import { Tooltip } from 'react-tooltip'
import { QRCodeSVG } from 'qrcode.react'
import { withRouter } from './withRouter'
import { withTranslation } from 'react-i18next'
import { Copy, Qr, Share, Check, Lock } from './Icons'

class Uploaded extends React.Component {
    constructor() {
        super()

        this.copyHandler = gdprshare.copyHandler.bind(this)
        this.shareHandler = this.shareHandler.bind(this)
        this.qrHandler = this.qrHandler.bind(this)
        this.state = {
            error: null,
            copy: null,
            dialogOpen: false,
        }
    }

    componentWillUnmount() {
        window.clearTimeout(this.copyTimer)
    }

    shareHandler(event) {
        this.setState({
            error: null
        })

        var btn = event.currentTarget
        btn.blur()
        var state = this.props.router.location.state
        var downloadLink = state.location + '#' + state.key

        const t = this.props.t
        var subjectText = t('uploaded.mailSubject', {filename: state.filename})

        if (window.navigator.share) {
            var shr = {
                title: state.filename,
                text: subjectText,
                url: downloadLink,
            }
            window.navigator.share(shr)
        }
        else {
            var subject = '?subject=' + window.encodeURIComponent(subjectText)
            var body = '&body=' + window.encodeURIComponent(t('uploaded.mailLink') + ': ' + downloadLink) +
                '%0a' + window.encodeURIComponent(t('uploaded.mailCount') + ': ' + state.count)

            var mailto = 'mailto:' + subject + body

            window.location.href = mailto
        }
    }

    qrHandler(event) {
        var btn = event.currentTarget
        btn.blur()
        this.setState({
            error: null,
            dialogOpen: !this.state.dialogOpen,
        })
    }

    chips(state) {
        const t = this.props.t
        var chips = [
            t('upload.chipDownloads', {count: state.count}),
        ]

        if (state.expiry) {
            var expires = new Date()
            expires.setDate(expires.getDate() + parseInt(state.expiry, 10))
            chips.push(t('upload.chipUntil', {date: gdprshare.formatDateTime(expires)}))
        }
        if (state.region)
            chips.push(state.region)

        return chips.map(function (text) {
            return <span className="chip" key={text}>{text}</span>
        })
    }

    render() {
        if (!this.props.router.location.state) {
            this.props.router.navigate('/', { replace: true })
            return null
        }

        const t = this.props.t
        const state = this.props.router.location.state
        const link = state.location + '#' + state.key

        return (
            <div className="container-fluid">
                <div className="app-outer">
                    <div className="app-inner">
                        <div className="d-flex align-items-center gap-3">
                            <span className="check-badge"><Check size="16" /></span>
                            <div className="d-flex flex-column" style={{minWidth: 0}}>
                                <h4>{t('uploaded.title')}</h4>
                                <span className="hint long-text">{state.filename}</span>
                            </div>
                        </div>

                        <div className="field">
                            <label htmlFor="link-key" className="lbl">{t('uploaded.linkLabel')}</label>
                            <div className="link-group">
                                <input className="form-control mono-input" id="link-key" type="text"
                                       readOnly value={link}
                                       aria-describedby="link-key-help" />
                                <button id="link-copy" onClick={this.copyHandler} type="button"
                                        className="btn btn-icon" data-tooltip-id="copy-tip"
                                        aria-label={t('common.copyLink')}>
                                    <Copy size="15" />
                                </button>
                                <button id="link-qr" onClick={this.qrHandler} type="button"
                                        className="btn btn-icon" data-tooltip-id="tip"
                                        data-tooltip-content={t('uploaded.qr')}
                                        aria-label={t('uploaded.qr')}>
                                    <Qr size="15" />
                                </button>
                                <button id="link-share" onClick={this.shareHandler} type="button"
                                        className="btn btn-icon" data-tooltip-id="tip"
                                        data-tooltip-content={t('uploaded.share')}
                                        aria-label={t('uploaded.share')}>
                                    <Share size="15" />
                                </button>
                            </div>
                            <span id="link-key-help" className="hint">
                                {state.key.indexOf(gdprshare.passwordPrefix) === 0
                                    ? t('uploaded.passwordNotice')
                                    : t('uploaded.linkHint')}
                            </span>
                        </div>

                        {this.state.dialogOpen && (
                            <dialog className="dialog" open onClick={this.qrHandler}>
                                <QRCodeSVG value={link} onClick={this.qrHandler} />
                            </dialog>
                        )}

                        <div className="chip-row">
                            {this.chips(state)}
                        </div>

                        <div className="note">
                            <Lock size="15" />
                            <span>{t('uploaded.note')}</span>
                        </div>

                        <Alert error={this.state.error} />
                    </div>
                </div>

                <div className="text-center" style={{marginTop: '16px'}}>
                    <Link to="/">{t('uploaded.another')}</Link>
                </div>

                <Tooltip id="tip" place="bottom" />
                <Tooltip id="copy-tip" place="bottom" delayHide={800}
                         render={() => this.state.copy || t('common.copyLink')} />
            </div>
        )
    }
}

export default withTranslation()(withRouter(Uploaded))
