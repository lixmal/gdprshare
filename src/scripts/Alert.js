import React from 'react'
import { AlertIcon, Info } from './Icons'
import { withTranslation } from 'react-i18next'

class Alert extends React.Component {
    constructor() {
        super()
    }

    render() {
        if (!this.props.error)
            return null

        // an expected end state, like a link that ran out, is not a failure
        if (this.props.tone === 'notice')
            return (
                <div className="alert alert-notice file-alert" role="status">
                    <Info size="15" />
                    <span>{this.props.error}</span>
                </div>
            )

        return (
            <div className="alert alert-danger file-alert" role="alert">
                <AlertIcon size="15" />
                <span className="sr-only">
                    {this.props.t('alert.errorLabel')}
                </span>
                <span>{this.props.error}</span>
            </div>
        )
    }
}

export default withTranslation()(Alert)
