import React from 'react'
import { Link } from 'react-router-dom'
import Alert from './Alert'
import { Tooltip } from 'react-tooltip'
import { QRCodeSVG } from 'qrcode.react'
import { withRouter } from './withRouter'
import { Copy, Qr, Share, Check, Lock } from './Icons'

class Uploaded extends React.Component {
    constructor() {
        super()

        this.copyHandler = gdprshare.copyHandler.bind(this)
        this.shareHandler = this.shareHandler.bind(this)
        this.qrHandler = this.qrHandler.bind(this)
        this.handleTipContent = gdprshare.handleTipContent.bind(this)
        this.state = {
            error: null,
            copy: null,
            dialogOpen: false,
        }
    }

    shareHandler(event) {
        this.setState({
            error: null
        })

        var btn = event.currentTarget
        btn.blur()
        var state = this.props.router.location.state
        var downloadLink = state.location + '#' + state.key

        if (window.navigator.share) {
            var shr = {
                title: state.filename,
                text: 'Download ' + state.filename,
                url: downloadLink,
            }
            window.navigator.share(shr)
        }
        else {
            var subject = '?subject=Download %20' + window.encodeURIComponent(state.filename)
            var body = '&body=Download link' + window.encodeURIComponent(': ' + downloadLink) +
                '%0aMax downloads' + window.encodeURIComponent(': ' + state.count)

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
        var chips = [
            state.count + (state.count > 1 ? ' downloads' : ' download'),
        ]

        if (state.expiry) {
            var expires = new Date()
            expires.setDate(expires.getDate() + parseInt(state.expiry, 10))
            chips.push('Until ' + expires.toLocaleString())
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

        const state = this.props.router.location.state
        const link = state.location + '#' + state.key

        return (
            <div className="container-fluid">
                <div className="app-outer">
                    <div className="app-inner">
                        <div className="d-flex align-items-center gap-3">
                            <span className="check-badge"><Check size="16" /></span>
                            <div className="d-flex flex-column" style={{minWidth: 0}}>
                                <h4>Uploaded</h4>
                                <span className="hint long-text">{state.filename}</span>
                            </div>
                        </div>

                        <div className="field">
                            <label htmlFor="link-key" className="lbl">Download link</label>
                            <div className="link-group">
                                <input className="form-control mono-input" id="link-key" type="text"
                                       ref="link-key" readOnly value={link}
                                       aria-describedby="link-key-help" />
                                <button id="link-copy" onClick={this.copyHandler} type="button"
                                        className="btn btn-icon" data-for="copy-tip" data-tip
                                        aria-label="Copy the link">
                                    <Copy size="15" />
                                </button>
                                <button id="link-qr" onClick={this.qrHandler} type="button"
                                        className="btn btn-icon" data-tip data-for="qrcode-tip"
                                        aria-label="Show the QR code">
                                    <Qr size="15" />
                                </button>
                                <button id="link-share" onClick={this.shareHandler} type="button"
                                        className="btn btn-icon" data-tip data-for="share-tip"
                                        aria-label="Share the link">
                                    <Share size="15" />
                                </button>
                            </div>
                            <span id="link-key-help" className="hint">
                                The password is built into the link, so send it exactly as it is.
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
                            <span>
                                Anyone who gets this link can open the file, so send it somewhere only
                                the recipient can read.
                            </span>
                        </div>

                        <Alert error={this.state.error} />
                    </div>
                </div>

                <div className="text-center" style={{marginTop: '16px'}}>
                    <Link to="/">Upload another file</Link>
                </div>

                <Tooltip id="copy-tip" openOnClick={false} render={() => this.state.copy} delayHide={1000} />
                <Tooltip id="qrcode-tip" variant="info" place="bottom" content="Show the QR code" />
                <Tooltip id="share-tip" variant="info" place="bottom" content="Share" />
            </div>
        )
    }
}

export default withRouter(Uploaded)
