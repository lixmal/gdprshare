import React from 'react'
import { Check } from './Icons'

export default class Success extends React.Component {
    constructor() {
        super()
    }

    render() {
        return this.props.message ? (
            <div className="alert alert-success file-alert" role="status">
                <Check size="15" />
                <span>{this.props.message}</span>
            </div>
        ) : null
    }
}
