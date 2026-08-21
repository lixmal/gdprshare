import React from 'react'
import Classnames from 'classnames'
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
        XHR.send(JSON.stringify({
            url: window.document.location.toString(),
        }))
    }

    render() {
        return (
            <div className="container-fluid text-center col-sm-4">
                <h4>{this.props.t('browser.title')}</h4>
                <br />
                <Alert error={this.props.t('browser.message')} />
            </div>
        )
    }
}

export default withTranslation()(ErrPage)
