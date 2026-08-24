import React from 'react'
import { Link } from 'react-router-dom'
import { withTranslation } from 'react-i18next'
import { Shield, Moon, Sun } from './Icons'
import Footer from './Footer'

const STORAGE_KEY = 'theme'

// The header sits above every route and owns the light/dark choice. An explicit
// choice is written to the document element and remembered; without one the
// stylesheet follows the system preference.
export function storedTheme() {
    try {
        var stored = window.localStorage.getItem(STORAGE_KEY)
        return stored === 'light' || stored === 'dark' ? stored : null
    } catch (e) {
        console.log(e)
        return null
    }
}

export function applyTheme(theme) {
    if (theme)
        window.document.documentElement.setAttribute('data-theme', theme)
    else
        window.document.documentElement.removeAttribute('data-theme')
}

function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

class Shell extends React.Component {
    constructor() {
        super()

        this.toggleTheme = this.toggleTheme.bind(this)
        this.state = {
            theme: storedTheme(),
        }
    }

    toggleTheme(event) {
        event.currentTarget.blur()

        var dark = this.state.theme ? this.state.theme === 'dark' : systemPrefersDark()
        var theme = dark ? 'light' : 'dark'

        applyTheme(theme)
        try {
            window.localStorage.setItem(STORAGE_KEY, theme)
        } catch (e) {
            console.log(e)
        }
        this.setState({ theme: theme })
    }

    render() {
        const t = this.props.t
        var dark = this.state.theme ? this.state.theme === 'dark' : systemPrefersDark()

        return (
            <div>
                <header className="shell-hdr">
                    <Link to="/" className="shell-mark">
                        <Shield size="18" />
                        gdprshare
                    </Link>
                    <span className="shell-note">{t('shell.tagline')}</span>
                    <div style={{ flexGrow: 1 }}></div>
                    <button type="button" className="btn btn-icon" onClick={this.toggleTheme}
                            aria-label={dark ? t('shell.light') : t('shell.dark')}>
                        {dark ? <Sun size="15" /> : <Moon size="15" />}
                    </button>
                </header>
                <main className="shell-main">
                    {this.props.children}
                </main>
                <Footer />
            </div>
        )
    }
}

export default withTranslation()(Shell)
