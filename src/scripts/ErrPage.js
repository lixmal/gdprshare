import React from 'react'
import Classnames from 'classnames'
import Alert from './Alert'

export default class ErrPage extends React.Component {
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
                <h4>BROWSER ERROR</h4>
                <br />
                <Alert error="Your browser doesn't support required operations. Please try a different browser." />
            </div>
        )
    }
}
