import React from 'react'
import { withTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from './Icons'

// What this server keeps, told from the configuration it reports rather than
// from what the code could do: an operator who turned client info off should not
// have a footer claiming addresses are stored.
class Footer extends React.Component {
    constructor() {
        super()

        this.toggle = this.toggle.bind(this)
        this.state = {
            open: false,
        }
    }

    toggle(event) {
        event.currentTarget.blur()
        this.setState({ open: !this.state.open })
    }

    facts() {
        const t = this.props.t
        var config = gdprshare.config

        var facts = [
            t('footer.keptFile', { days: config.maxExpiry }),
            t('footer.keptPassword'),
            t('footer.keptEmail'),
            config.saveClientInfo ? t('footer.keptClient') : t('footer.keptClientNone'),
        ]

        if (config.geoIP)
            facts.push(t('footer.keptLocation'))

        // a report carries nothing about the visitor unless client info is kept
        if (config.saveClientInfo)
            facts.push(t('footer.keptReport', { days: config.reportRetention }))

        facts.push(t('footer.operator'))

        return facts
    }

    render() {
        const t = this.props.t
        var config = gdprshare.config

        return (
            <footer className="shell-footer">
                <div className="shell-footer-row">
                    <button type="button" className="btn btn-link-quiet btn-sm px-0"
                            onClick={this.toggle} aria-expanded={this.state.open}>
                        {this.state.open ? <ChevronDown size="14" /> : <ChevronRight size="14" />}
                        {t('footer.kept')}
                    </button>
                    {config.privacyUrl && (
                        <a href={config.privacyUrl}>{t('footer.privacy')}</a>
                    )}
                    {config.imprintUrl && (
                        <a href={config.imprintUrl}>{t('footer.imprint')}</a>
                    )}
                </div>

                {this.state.open && (
                    <React.Fragment>
                        <ul className="shell-footer-facts">
                            {this.facts().map(function (fact) {
                                return <li key={fact}>{fact}</li>
                            })}
                        </ul>
                        <p className="shell-footer-law">{t('footer.law')}</p>
                    </React.Fragment>
                )}
            </footer>
        )
    }
}

export default withTranslation()(Footer)
