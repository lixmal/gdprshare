import React from 'react'
import { Link } from 'react-router-dom'
import * as Clipboard from "clipboard-polyfill/dist/clipboard-polyfill.promise"
import Octicon, { Clippy } from '@primer/octicons-react'

export default class Uploaded extends React.Component {
    constructor() {
        super()

        this.copyHandler = this.copyHandler.bind(this)
    }

    showTooltip(btn, message) {
        // TODO
    }

    copyHandler(event) {
        var btn = event.currentTarget
        btn.blur()
        var input = btn.parentNode.nextSibling
        Clipboard.writeText(input.value).then(
            function () {
                this.showTooltip(btn, 'Copied')
            }.bind(this),
            function () {
                this.showTooltip(btn, 'Failed to copy')
            }.bind(this),
        )
    }

    render() {
        if (!this.props.history.location.state)
            return null

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
                                <input className="form-control form-control-sm" id="filename" type="text" ref="filename" readOnly="readOnly" defaultValue={this.props.history.location.state.filename} />
                            </div>
                        </div>

                        <div className="form-group row">
                            <label htmlFor="password" className="col-sm-3 col-form-label col-form-label-sm">
                                Password
                            </label>
                            <div className="col-sm-9">
                                <div className="input-group">
                                    <div className="input-group-prepend">
                                        <button id="pw-copy" onClick={this.copyHandler} type="button" className="input-group-text">
                                            <Octicon icon={Clippy} />
                                        </button>
                                    </div>
                                    <input className="form-control form-control-sm" id="password" type="text" ref="password" readOnly="readOnly" defaultValue={this.props.history.location.state.password} />
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
                                        <button id="link-copy" onClick={this.copyHandler} type="button" className="input-group-text">
                                            <Octicon icon={Clippy} />
                                        </button>
                                    </div>
                                    <input className="form-control form-control-sm" id="link" type="text" ref="link" placeholder="Link" readOnly="readOnly" aria-describedby="linkHelp"
                                        value={this.props.history.location.state.location}
                                    />
                                </div>
                                <small id="linkHelp" className="form-text text-muted">Send link and password via different channels (e.g. one via email, one via chat or phone call)</small>
                            </div>
                        </div>


                        <div className="form-group row">
                            <label htmlFor="linkpw" className="col-sm-3 col-form-label col-form-label-sm">
                                Link and Password
                            </label>
                            <div className="col-sm-9">
                                <div className="input-group">
                                    <div className="input-group-prepend">
                                        <button id="linkpw-copy" onClick={this.copyHandler} type="button" className="input-group-text">
                                            <Octicon icon={Clippy} />
                                        </button>
                                    </div>
                                    <input className="form-control form-control-sm" id="linkpassword" type="text" ref="linkpassword" placeholder="Link and passwod" readOnly="readOnly" aria-describedby="linkpasswordHelp"
                                        value={ this.props.history.location.state.location + '?p=' + this.props.history.location.state.password }
                                    />
                                </div>
                                <small id="linkpasswordHelp" className="form-text text-muted">Send link and password at once (less secure)</small>
                            </div>
                        </div>
                    </form>

                    <br />

                    <div className="text-center col-sm-12">
                        <Link to="/">Upload another file</Link>
                    </div>
                </div>
            </div>
        )
    }
}
