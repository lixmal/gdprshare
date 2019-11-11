import React from 'react'
import Octicon, { Alert as AlertI } from '@primer/octicons-react'

export default class Alert extends React.Component {
    constructor() {
        super()
    }

    render() {
        return this.props.error ? (
            <div className="alert alert-danger alert-dismissible col-sm-12 file-error text-center">
                <Octicon icon={AlertI} />
                <span className="sr-only">
                    Error:
                </span>
                {this.props.error}
            </div>
        ) : null
    }
}
