import React from 'react'
import Alert from './Alert'
import { withTranslation } from 'react-i18next'

class ErrPage extends React.Component {
    constructor() {
        super()
        this.url = gdprshare.config.apiPrefix + '/stats'
    }

    componentDidMount() {
        var XHR = new XMLHttpRequest()
        XHR.open("POST", this.url)
        // The address, minus the fragment: that is the key to the file, and it
        // is the one thing this server must never be told.
        XHR.send(JSON.stringify({
            url: gdprshare.withoutSecret(window.document.location.toString()),
        }))
    }

    render() {
        return (
            <div className="container-fluid">
                <div className="app-outer">
                    <div className="app-inner">
                        <h4>{this.props.t('browser.title')}</h4>
                        <Alert error={this.props.t('browser.message')} />
                    </div>
                </div>
            </div>
        )
    }
}

export default withTranslation()(ErrPage)
