import React from 'react'
import Octicon, { Alert as AlertI } from '@primer/octicons-react'
import { withTranslation } from 'react-i18next'

class Alert extends React.Component {
    constructor() {
        super()
    }

    render() {
        return this.props.error ? (
            <div className="alert alert-danger alert-dismissible col-sm-12 file-alert text-center">
                <Octicon icon={AlertI} />
                <span className="sr-only">
                    {this.props.t('alert.errorLabel')}
                </span>
                {this.props.error}
            </div>
        ) : null
    }
}

export default withTranslation()(Alert)
