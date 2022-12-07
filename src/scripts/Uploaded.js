import React from 'react'
import { Link } from 'react-router-dom'
import Octicon, { LinkExternal, Clippy, ScreenFull } from '@primer/octicons-react'
import Alert from './Alert'
import ReactTooltip from 'react-tooltip'
import { QRCodeSVG } from 'qrcode.react'

export default class Uploaded extends React.Component {
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
        var state = this.props.history.location.state
        var downloadLink = state.location + '#' + state.password

        if (window.navigator.share) {
            var shr = {
                title: state.filename,
                text: 'Sharing ' + state.filename,
                url: downloadLink,
            }
            navigator.share(shr)
        }
        else {
            var subject = '?subject=Sharing%20' + window.encodeURIComponent(state.filename)
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

    render() {
        if (!this.props.history.location.state) {
            this.props.history.replace('/')
            return null
        }

        let dialog

        if (this.state.dialogOpen) {
            dialog = (
                <dialog className="dialog" open onClick={this.handleShowDialog}>
                    <QRCodeSVG value={ this.props.history.location.state.location + '#' + this.props.history.location.state.password } onClick={this.qrHandler} />
                </dialog>
            )
        }

        return (
            <div className="container-fluid col-sm-4">
                <div className="app-outer">
                    <h4 className="text-center">File was uploaded</h4>
                    <form className="app-inner">
                        <div className="form-group row">
                            <label htmlFor="filename" className="col-sm-3 col-form-label col-form-label-sm">
                                Filename
                            </label>
                            <div className="col-sm-9">
                                <input className="form-control form-control-sm" id="filename" type="text" ref="filename" readOnly defaultValue={this.props.history.location.state.filename} />
                            </div>
                        </div>

                        <div className="form-group row">
                            <label htmlFor="password" className="col-sm-3 col-form-label col-form-label-sm">
                                Password
                            </label>
                            <div className="col-sm-9">
                                <div className="input-group">
                                    <div className="input-group-prepend">
                                        <button id="pw-copy" onClick={this.copyHandler} type="button" className="btn input-group-text" data-for="copy-tip" data-tip>
                                            <Octicon icon={Clippy} />
                                        </button>
                                    </div>
                                    <input className="form-control form-control-sm" id="password" type="text" ref="password" readOnly defaultValue={this.props.history.location.state.password} />
                                </div>
                            </div>
                        </div>

                        <br/>

                        <div className="form-group row">
                            <label htmlFor="link" className="col-sm-3 col-form-label col-form-label-sm">
                                Link
                            </label>
                            <div className="col-sm-9">
                                <div className="input-group">
                                    <div className="input-group-prepend">
                                        <button id="link-copy" onClick={this.copyHandler} type="button" className="btn input-group-text" data-for="copy-tip" data-tip>
                                            <Octicon icon={Clippy} />
                                        </button>
                                    </div>
                                    <input className="form-control form-control-sm" id="link" type="text" ref="link" placeholder="Link" readOnly aria-describedby="linkHelp"
                                        value={this.props.history.location.state.location}
                                    />
                                </div>
                                <small id="linkHelp" className="form-text text-muted">Send link and password via different channels (e.g. one via email, one via chat or phone call)</small>
                            </div>
                        </div>

                        {dialog}
                        <div className="form-group row">
                            <label htmlFor="linkpw" className="col-sm-3 col-form-label col-form-label-sm">
                                Link and Password
                            </label>
                            <div className="col-sm-9">
                                <div className="input-group">
                                    <div className="input-group-prepend">
                                        <button id="linkpw-copy" onClick={this.copyHandler} type="button" className="btn input-group-text" data-for="copy-tip" data-tip>
                                            <Octicon icon={Clippy} />
                                        </button>
                                        <button id="linkpw-qr" onClick={this.qrHandler} type="button" className="btn input-group-text">
                                            <Octicon icon={ScreenFull} />
                                        </button>
                                        <button id="linkpw-share" onClick={this.shareHandler} type="button" className="btn input-group-text">
                                            <Octicon icon={LinkExternal} />
                                        </button>
                                    </div>
                                    <input className="form-control form-control-sm" id="linkpassword" type="text" ref="linkpassword" placeholder="Link and passwod" readOnly aria-describedby="linkpasswordHelp"
                                        value={ this.props.history.location.state.location + '#' + this.props.history.location.state.password }
                                    />
                                </div>
                                <small id="linkpasswordHelp" className="form-text text-muted">Send link and password at once (less secure)</small>
                            </div>
                        </div>
                    </form>

                    <br />
                    <Alert error={this.state.error} />

                    <div className="text-center col-sm-12">
                        <Link to="/">Upload another file</Link>
                    </div>
                    <ReactTooltip id="copy-tip" event="none" getContent={this.handleTipContent} delayHide={1000} />
                </div>
            </div>
        )
    }
}
