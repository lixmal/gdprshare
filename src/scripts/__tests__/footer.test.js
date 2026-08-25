/**
 * The footer's account of stored data follows the configuration the server
 * reports, so a claim can never outrun the setup. The e2e suite covers the
 * configuration the test server runs with; this covers the others.
 */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../i18n'
import en from '../../../public/locales/en.json'
import Footer from '../Footer'

// Footer reads the runtime configuration off the global namespace
function withConfig(overrides) {
    window.gdprshare = {
        config: Object.assign(
            {
                maxExpiry: 14,
                saveClientInfo: false,
                reportRetention: 14,
                geoIP: false,
                privacyUrl: '',
                imprintUrl: '',
            },
            overrides,
        ),
    }
}

// renders the footer with its notice opened, which is how a visitor reads it,
// and returns the facts it states
function openFooter(config) {
    cleanup()
    withConfig(config)
    render(<Footer />)
    fireEvent.click(screen.getByRole('button'))

    return screen.getAllByRole('listitem').map(function (item) {
        return item.textContent
    })
}

beforeAll(async () => {
    await i18n.init({
        lng: 'en',
        fallbackLng: 'en',
        resources: { en: { translation: en } },
        interpolation: { escapeValue: false },
    })
})

describe('Footer', () => {
    test('states the retention of the error reports when client info is kept', () => {
        const facts = openFooter({ saveClientInfo: true })

        expect(facts).toContain(en.footer.keptReport.replace('{{days}}', '14'))
        expect(facts).toContain(en.footer.keptClient)
    })

    test('leaves the error reports out when nothing about the visitor is kept', () => {
        const facts = openFooter({ saveClientInfo: false })

        expect(facts.join(' ')).not.toContain('faults on this server')
        expect(facts).toContain(en.footer.keptClientNone)
    })

    test('names the location database only where one is configured', () => {
        expect(openFooter({ geoIP: true })).toContain(en.footer.keptLocation)
        expect(openFooter({ geoIP: false })).not.toContain(en.footer.keptLocation)
    })
})
