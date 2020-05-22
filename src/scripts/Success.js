import React from 'react'

export default class Success extends React.Component {
    constructor() {
        super()
    }

    render() {
        return this.props.message ? (
            <div className="alert alert-success alert-dismissible col-sm-12 file-alert text-center">
                {this.props.message}
            </div>
        ) : null
    }
}
