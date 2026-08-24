import React from 'react'
import { AlertIcon } from './Icons'
import { withTranslation } from 'react-i18next'

class Alert extends React.Component {
    constructor() {
        super()
    }

    render() {
        return this.props.error ? (
            <div className="alert alert-danger file-alert" role="alert">
                <AlertIcon size="15" />
                <span className="sr-only">
                    {this.props.t('alert.errorLabel')}
                </span>
                <span>{this.props.error}</span>
            </div>
        ) : null
    }
}

export default withTranslation()(Alert)
