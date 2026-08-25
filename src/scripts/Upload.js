import React from 'react'
import Classnames from 'classnames'
import { Copy, Trash, MoreTime, Upload as UploadIcon, FileIcon, TextIcon, ImageIcon,
         Lock, Minus, Plus, X, ChevronDown, ChevronRight, Refresh, ListIcon } from './Icons'
import Alert from './Alert'
import { Tooltip } from 'react-tooltip'
import { withRouter } from './withRouter'
import { withTranslation } from 'react-i18next'
import { stripMetadata, loadPdfLib, canStrip, strippableImageTypes } from './strip'

// Why a refused attempt did not go through, worded for the owner reading their
// own record rather than for the visitor who was turned away.
const REASON_KEYS = {
    download_location_forbidden: 'files.reasonLocation',
    file_not_yet_downloadable: 'files.reasonTooEarly',
    user_agent_blocked: 'files.reasonBrowser',
    download_count_expired: 'files.reasonSpent',
    file_expired: 'files.reasonExpired',
    file_not_found: 'files.reasonMissing',
}

// The options an upload was last sent with, so the next one starts where the
// last one left off. Everything read back is checked against what the form
// offers: a stored value that no longer exists would leave a select blank.
const DELAYS = ['0', '1', '5', '15', '30', '60', '120', '1440']
const EPHEMERALS = ['0', '5', '10', '30', '60', '120', '300']
const REGIONS = ['none', 'eea', 'gdpr-aligned', 'custom']

// The password is deliberately not among them: it belongs to one share, and a
// remembered one would be applied to the next file without being asked for.
function rememberedOptions() {
    var stored = {}
    try {
        stored = JSON.parse(window.localStorage.getItem('options')) || {}
    } catch (e) {
        stored = {}
    }

    const oneOf = function (value, allowed, fallback) {
        return allowed.indexOf(String(value)) !== -1 ? String(value) : fallback
    }

    return {
        count: gdprshare.clamp(stored.count, 1, gdprshare.config.maxCount),
        expiry: gdprshare.clamp(stored.expiry, 1, gdprshare.config.maxExpiry),
        geoRestriction: oneOf(stored.geoRestriction, REGIONS, 'eea'),
        delay: oneOf(stored.delay, DELAYS, '0'),
        ephemeral: oneOf(stored.ephemeral, EPHEMERALS, '0'),
        strip: stored.strip === true,
        selectedCountries: Array.isArray(stored.selectedCountries)
            ? stored.selectedCountries.filter(function (code) {
                return typeof code === 'string' && /^[A-Z]{2}$/.test(code)
            })
            : [],
        // written under its own key before the rest was remembered
        email: String(stored.email || window.localStorage.getItem('email') || '').slice(0, 255),
    }
}

class Upload extends React.Component {
    constructor() {
        super()

        // the file and image inputs are rendered one at a time, so only the one
        // matching the picked type ever holds a node
        this.fileInput = React.createRef()
        this.imageInput = React.createRef()
        this.textInput = React.createRef()
        this.submitButton = React.createRef()

        this.copyHandler = gdprshare.copyHandler.bind(this)
        this.encrypt = gdprshare.encrypt.bind(this)
        this.handleFile = this.handleFile.bind(this)
        this.handleUpload = this.handleUpload.bind(this)
        this.handleDelete = this.handleDelete.bind(this)
        this.handleDrop = this.handleDrop.bind(this)
        this.handleDragOn = this.handleDragOn.bind(this)
        this.handleDragOff = this.handleDragOff.bind(this)
        this.handleTypeChange = this.handleTypeChange.bind(this)
        this.handleEphemeralChange = this.handleEphemeralChange.bind(this)
        this.handleStripChange = this.handleStripChange.bind(this)
        this.uploadFile = this.uploadFile.bind(this)
        this.updateValidity = this.updateValidity.bind(this)
        this.handleGeoRestrictionChange = this.handleGeoRestrictionChange.bind(this)
        this.handleCountryToggle = this.handleCountryToggle.bind(this)
        this.handleCountrySearch = this.handleCountrySearch.bind(this)
        this.handleDeselectAll = this.handleDeselectAll.bind(this)
        this.handleDelayChange = this.handleDelayChange.bind(this)
        this.handleProlongToggle = this.handleProlongToggle.bind(this)
        this.handleProlongChange = this.handleProlongChange.bind(this)
        this.handleProlong = this.handleProlong.bind(this)
        this.handleCountChange = this.handleCountChange.bind(this)
        this.handleExpiryChange = this.handleExpiryChange.bind(this)
        this.toggleOptions = this.toggleOptions.bind(this)
        this.handleBrowse = this.handleBrowse.bind(this)
        this.handleClearFile = this.handleClearFile.bind(this)
        this.handleEmailChange = this.handleEmailChange.bind(this)
        this.handlePasswordChange = this.handlePasswordChange.bind(this)
        this.reportProgress = this.reportProgress.bind(this)
        this.forgetFile = this.forgetFile.bind(this)
        this.toggleRecord = this.toggleRecord.bind(this)

        // the last upload's options, so the next one starts where it left off
        this.remembered = rememberedOptions()

        this.state = {
            error: null,
            mask: false,
            filesBusy: false,
            password: '',
            progress: null,
            copy: null,
            fileInfo: null,
            type: 'file',
            geoRestriction: this.remembered.geoRestriction,
            countryList: [],
            countryGroups: {},
            selectedCountries: this.remembered.selectedCountries,
            yourCountry: '',
            countrySearch: '',
            customCountriesUsed: this.remembered.selectedCountries.length > 0,
            delay: this.remembered.delay,
            ephemeral: this.remembered.ephemeral,
            strip: this.remembered.strip,
            prolongFor: null,
            prolongDays: 0,
            prolongCount: 0,
            count: this.remembered.count,
            expiry: this.remembered.expiry,
            email: this.remembered.email,
            optionsOpen: false,
            picked: null,
            recordFor: null,
            records: {},
        }
    }

    componentWillUnmount() {
        window.clearTimeout(this.copyTimer)
    }

    async componentDidMount() {
        this.updateValidity()
        try {
            var response = await window.fetch(gdprshare.config.apiPrefix + '/countries')
            if (response.ok) {
                var data = await response.json()
                this.setState({
                    countryList: data.countries,
                    countryGroups: data.groups,
                    yourCountry: data.yourCountry || '',
                    selectedCountries: this.remembered.selectedCountries.length
                        ? this.remembered.selectedCountries
                        : (data.groups.euEEA || []),
                })
            } else {
                this.setState({ geoRestriction: 'none' })
            }
        } catch (e) {
            console.log('fetch countries:', e)
            this.setState({ geoRestriction: 'none' })
        }
    }

    async updateValidity() {
        try {
            var files = JSON.parse(window.localStorage.getItem('savedFiles'))
        } catch (e) {
            console.log(e)
            return
        }

        var fileIds = []
        for (var i in files) {
            fileIds.push(
                {
                    fileId: files[i].fileId,
                    ownerToken: files[i].ownerToken,
                }
            )
        }

        this.setState({
            error: null,
            filesBusy: true,
        })

        let response
        try {
            response = await window.fetch(gdprshare.config.apiUrl + '/' + 'validate', {
                method: 'POST',
                body: JSON.stringify(fileIds),
            })
        } catch (error) {
            return gdprshare.displayErr.call(this, error)
        }

        let fetchData
        try {
            fetchData = await response.clone().json()
        } catch (error) {
            return gdprshare.asTextErr.call(this, response, error)
        }

        if (!response.ok) {
            let error = this.props.t('files.checkFailed', {message: fetchData.message})
            // TODO: mask removal could be a race with something else
            return gdprshare.displayErr.call(this, error)
        }

        this.setState({
            fileInfo: fetchData.fileInfo,
            filesBusy: false,
        })
    }

    outerClasses() {
        return Classnames({
            'app-outer': true,
            'drag-outer': this.state.isDragOver,
            // the progress block draws its own wait, so the overlay would just
            // dim the numbers the sender is reading
            'loading-mask': this.state.mask && this.state.progress === null,
        })
    }

    filesClasses() {
        return Classnames({
            'app-outer': true,
            'files-card': true,
            'loading-mask': this.state.filesBusy,
        })
    }

    innerClasses() {
        return Classnames({
            'app-inner': true,
            'drag-inner': this.state.isDragOver,
        })
    }


    dndClasses() {
        return Classnames({
            'drag-text-visible': this.state.isDragOver,
            'drag-text': true,
        })
    }

    // What the share is, apart from its bytes. The same set opens an upload that
    // arrives in pieces and accompanies one that arrives in a single request.
    shareFields(encFilename) {
        var fields = {
            type: this.state.type,
            filename: encFilename,
            count: this.state.count,
            expiry: this.state.expiry,
            email: this.state.email,
        }

        if (this.state.geoRestriction !== 'none')
            fields['allowed-countries'] = this.state.selectedCountries.join(',')
        if (this.state.delay !== '0')
            fields.delay = this.state.delay
        if (this.state.type === 'image' && this.state.ephemeral !== '0')
            fields.ephemeral = this.state.ephemeral

        return fields
    }

    // Tells the sender the wait is doing something, and roughly how much of it
    // is left. Wears the download page's progress markup, since it is the same
    // kind of wait.
    sendingStatus() {
        if (!this.state.mask || this.state.progress === null)
            return null

        return (
            <div className="download-status" role="status" aria-live="polite">
                <div className="download-status-head">
                    <span className="download-status-text">{this.props.t('upload.sending')}</span>
                    <span className="download-status-value">{this.state.progress}%</span>
                </div>
                <div className="download-progress"
                     role="progressbar"
                     aria-valuenow={this.state.progress}
                     aria-valuemin="0"
                     aria-valuemax="100">
                    <div className="download-progress-bar" id="upload-progress-bar"
                         style={{ width: this.state.progress + '%' }}></div>
                    <span className="download-progress-value">{this.state.progress}%</span>
                </div>
            </div>
        )
    }

    // Without a size there is nothing to divide by, and the label stays
    // indeterminate.
    reportProgress(done, total) {
        this.setState({
            progress: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null,
        })
    }

    rememberOptions() {
        // the password deliberately excluded: it belongs to one share
        try {
            window.localStorage.setItem('options', JSON.stringify({
                count: this.state.count,
                expiry: this.state.expiry,
                geoRestriction: this.state.geoRestriction,
                selectedCountries: this.state.selectedCountries,
                delay: this.state.delay,
                ephemeral: this.state.ephemeral,
                strip: this.state.strip,
                email: this.state.email,
            }))
        } catch (e) {
            console.log(e)
        }
    }

    async uploadFile(fragment, data, encFilename, plainFilename) {
        var formData = new FormData()
        var file = new File(
            [data],
            {
                type: 'application/octet-stream'
            },
        )

        var fields = this.shareFields(encFilename)
        Object.keys(fields).forEach(function (name) {
            formData.append(name, fields[name])
        })
        formData.append('file', file, encFilename)

        this.rememberOptions()

        let response
        try {
            response = await window.fetch(gdprshare.config.apiUrl, {
                method: 'POST',
                body: formData,
            })
        } catch (error) {
            return gdprshare.displayErr.call(this, error)
        }

        let fetchData
        try {
            fetchData = await response.clone().json()
        } catch (error) {
            return gdprshare.asTextErr.call(this, response, error)
        }

        if (!response.ok)
            return gdprshare.displayErr.call(this, fetchData.message)

        this.shareCreated(fragment, fetchData, response.headers.get('Location'), plainFilename)
    }

    // Where an upload ends up, however its bytes got here: remembered among the
    // sender's own shares, and shown with its link.
    shareCreated(fragment, fetchData, locationPath, plainFilename) {
        var files = {}

        try {
            files = JSON.parse(window.localStorage.getItem('savedFiles'))
        } catch (e) {
            console.log(e)
        }

        if (!files) files = {}

        const loc = location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '') + locationPath
        if (gdprshare.config.saveFiles) {
            files[fetchData.fileId] = {
                filename: plainFilename,
                fileId: fetchData.fileId,
                ownerToken: fetchData.ownerToken,
                location: loc + '#' + fragment,
                totalCount: parseInt(this.state.count, 10) || 1,
            }

            try {
                window.localStorage.setItem('savedFiles', JSON.stringify(files))
            } catch (e) {
                console.log(e)
            }
        }

        var regionLabels = {
            none: '',
            eea: this.props.t('upload.regionEea'),
            'gdpr-aligned': this.props.t('upload.regionAligned'),
            custom: this.props.t('upload.chipCountries', {count: this.state.selectedCountries.length}),
        }

        this.props.router.navigate('/uploaded', {
            state: {
                location: loc,
                // unencrypted filename
                filename: plainFilename,
                key: fragment,
                count: this.state.count,
                expiry: this.state.expiry,
                region: regionLabels[this.state.geoRestriction],
            }
        })
    }

    // Sends a file as it is encrypted, a record at a time, so neither the
    // plaintext nor the ciphertext is ever held whole. The share exists on the
    // server from the first byte and is not downloadable until it is finished.
    async uploadInPieces(fragment, file, key, encFilename, plainFilename) {
        const api = gdprshare.config.apiPrefix + '/uploads'

        const opened = await this.post(api, {
            body: new URLSearchParams(this.shareFields(encFilename)),
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        })
        if (!opened)
            return

        this.rememberOptions()

        const chunkTo = api + '/' + opened.fileId
        var pending = []
        var pendingSize = 0
        var offset = 0

        const flush = async function () {
            if (!pendingSize)
                return true

            const chunk = new Blob(pending)
            pending = []
            pendingSize = 0

            const stored = await this.post(chunkTo, {
                body: chunk,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Owner-Token': opened.ownerToken,
                    'X-Upload-Offset': String(offset),
                },
            })
            if (!stored)
                return false

            offset += chunk.size

            return true
        }.bind(this)

        var failed = false
        await gdprshare.encryptRecords(file, key, async function (bytes, last) {
            if (failed)
                return

            pending.push(bytes)
            pendingSize += bytes.length

            // one record at a time is what the server takes, and the header
            // rides along with the first one
            if (pendingSize >= gdprshare.recordSize || last) {
                if (!await flush())
                    failed = true
            }
        }, this.reportProgress)

        if (failed)
            return

        if (!await flush())
            return

        const finished = await this.post(chunkTo + '/finish', {
            headers: {'X-Owner-Token': opened.ownerToken},
        })
        if (!finished)
            return

        this.shareCreated(fragment, finished.data, finished.location, plainFilename)
    }

    // One request of the upload, with the server's answer read the same way
    // everywhere. Reports the failure itself and answers null, so a caller only
    // has to stop.
    async post(url, options) {
        let response
        try {
            response = await window.fetch(url, Object.assign({method: 'POST'}, options))
        } catch (error) {
            gdprshare.displayErr.call(this, error)
            return null
        }

        let data
        try {
            data = await response.clone().json()
        } catch (error) {
            gdprshare.asTextErr.call(this, response, error)
            return null
        }

        if (!response.ok) {
            gdprshare.displayServerErr.call(this, data)
            return null
        }

        return {
            fileId: data.fileId,
            ownerToken: data.ownerToken,
            location: response.headers.get('Location'),
            data: data,
        }
    }

    handleDrop(event) {
        event.preventDefault()
        event.stopPropagation()

        this.setState({
            isDragOver: false
        })

        var files = event.dataTransfer.files
        if (!this.checkFileSize(files[0], event))
            return

        var input = this.pickedFileInput()
        if (input) input.files = files
        this.setState({picked: {name: files[0].name, size: files[0].size}})
        this.submitButton.current.click()
    }


    async handleUpload(event) {
        event.preventDefault()
        if (this.state.mask)
            return

        this.setState({
            error: null,
            mask: true,
            progress: null,
        })

        // The link carries the secret. With a password the file is encrypted
        // under both, so a link that goes astray on its own opens nothing.
        const secret = window.crypto.getRandomValues(new Uint8Array(gdprshare.config.keyLength))
        const password = this.state.password
        const key = password ? await gdprshare.deriveKey(secret, password) : secret
        const fragment = password
            ? gdprshare.passwordPrefix + gdprshare.keyToB64(secret)
            : gdprshare.keyToB64(secret)


        let file
        if (this.state.type === 'text') {
            let text = this.textInput.current.value
            // using first few chars as filename for recognizability
            // TODO: sanitize for usage in file names
            file = new File([text], text.slice(0, 21) + '.txt', {type: 'text/plain'})
        } else {
            file = this.pickedFileInput().files[0]

            // images are always stripped, other files only on request
            if (this.state.type === 'image' || this.state.strip) {
                try {
                    file = await stripMetadata(file)
                } catch (err) {
                    // never fall back to the original: the upload would leak
                    // the metadata the user asked to have removed
                    gdprshare.displayErr.call(this, this.props.t('upload.stripFailed', {message: err.message}))
                    return
                }
            }
        }

        try {
            // encryption of filename
            const cipherText = await gdprshare.encrypt(new TextEncoder().encode(file.name), key)

            var filename = Buffer.from(cipherText).toString('base64')

            // A file that spans more than one record is sent as it is
            // encrypted, so nothing is held whole. A small one goes in a single
            // request, which is one round trip instead of three.
            if (file.size > gdprshare.recordSize) {
                await this.uploadInPieces(fragment, file, key, filename, file.name)
            } else {
                const sealed = await gdprshare.encryptBlob(file, key)

                await this.uploadFile(fragment, sealed, filename, file.name)
            }
        } catch (error) {
            gdprshare.displayErr.call(this, error)
        }
    }

    deleteFileId(fileId) {
        try {
            var files = JSON.parse(window.localStorage.getItem('savedFiles'))
            delete files[fileId]
            window.localStorage.setItem('savedFiles', JSON.stringify(files))
        } catch (e) {
            console.log(e)
            this.setState({
                error: e,
            })
        }
    }

    // The download record is fetched when it is asked for: most of the time
    // nobody opens it, and it is one request per file.
    async toggleRecord(fileId, event) {
        event.currentTarget.blur()

        if (this.state.recordFor === fileId) {
            this.setState({recordFor: null})
            return
        }

        this.setState({recordFor: fileId, error: null})

        if (this.state.records[fileId])
            return

        let response
        try {
            let files = JSON.parse(window.localStorage.getItem('savedFiles'))
            let formData = new FormData()
            formData.append('ownerToken', files[fileId].ownerToken)

            response = await window.fetch(gdprshare.config.apiUrl + '/' + fileId + '/downloads', {
                method: 'POST',
                body: formData,
            })
        } catch (error) {
            this.setState({recordFor: null})
            return gdprshare.displayErr.call(this, error)
        }

        let fetchData
        try {
            fetchData = await response.clone().json()
        } catch (error) {
            this.setState({recordFor: null})
            return gdprshare.asTextErr.call(this, response, error)
        }

        if (!response.ok) {
            // closing it again beats leaving the panel on its loading dots
            this.setState({recordFor: null})

            // the share was confirmed or swept between the list and this click:
            // the record went with it, which is not a failure to report as one
            if (fetchData.code === 'file_not_found')
                return gdprshare.displayErr.call(this, this.props.t('files.recordGone'), 'notice')

            return gdprshare.displayErr.call(this, this.props.t('files.recordFailed', {message: fetchData.message}))
        }

        var records = Object.assign({}, this.state.records)
        records[fileId] = fetchData.downloads || []
        this.setState({records: records})
    }

    recordPanel(fileId) {
        const t = this.props.t
        var records = this.state.records[fileId]

        // nothing is drawn while it is being read: it is one small request, and
        // an ellipsis that lingers reads like a fault
        if (!records)
            return null

        if (records.length < 1)
            return <div className="record-panel"><span className="hint">{t('files.recordEmpty')}</span></div>

        return (
            <div className="record-panel">
                {records.map(function (record, index) {
                    var parts = [
                        record.address || t('files.recordNoAddress'),
                        record.location,
                        record.client || record.userAgent,
                        record.tlsVersion,
                        record.tlsCipher,
                    ].filter(function (part) { return part && part !== 'none' })

                    // the record is read by the owner, so a refusal is worded
                    // from that side rather than from the refused visitor's. a
                    // server newer than this build still says something, even
                    // if only its own code
                    var reason = null
                    if (record.denied)
                        reason = REASON_KEYS[record.reason]
                            ? t(REASON_KEYS[record.reason])
                            : record.reason

                    return (
                        <div className="record-line" key={index}>
                            <span className="record-time">
                                {gdprshare.formatDateTime(record.time)}
                            </span>
                            {record.denied && (
                                <span className="chip chip-refused">{t('files.recordRefused')}</span>
                            )}
                            <span className="record-detail long-text" title={record.userAgent}>
                                {parts.concat(reason ? [reason] : []).join(' · ')}
                            </span>
                        </div>
                    )
                })}
            </div>
        )
    }

    // The server has nothing to delete for an entry it disowns or never heard
    // of, and DELETE would answer 401 for the first, leaving the row stuck in
    // the list forever. Dropping the local record is the whole job.
    forgetFile(fileId, event) {
        event.currentTarget.blur()

        this.deleteFileId(fileId)

        var fileInfo = Object.assign({}, this.state.fileInfo)
        delete fileInfo[fileId]
        this.setState({fileInfo: fileInfo})
    }

    async handleDelete(fileID, event) {
        if (this.state.filesBusy)
            return

        this.setState({
            filesBusy: true,
            error: null
        })

        event.currentTarget.blur()

        let response
        try {
            let files = JSON.parse(window.localStorage.getItem('savedFiles'))
            let ownerToken = files[fileID].ownerToken

            let formData = new FormData()
            formData.append('ownerToken', ownerToken)

            response = await window.fetch(gdprshare.config.apiUrl + '/' + fileID, {
                method: 'DELETE',
                body: formData,
            })
        } catch (error) {
            return gdprshare.displayErr.call(this, error)
        }

        if (response.ok || response.status === 404) {
            this.deleteFileId(fileID)
            this.setState({
                filesBusy: false,
            })
        } else {
            try {
                let fetchData = await response.clone().json()
                gdprshare.displayErr.call(this, fetchData.message)
            } catch (error) {
                gdprshare.asTextErr.call(this, response, error)
            }
        }
    }

    handleProlongToggle(fileId) {
        if (this.state.prolongFor === fileId) {
            this.setState({
                prolongFor: null,
            })
            return
        }

        var info = this.state.fileInfo && this.state.fileInfo[fileId]
        if (!info)
            return

        this.setState({
            error: null,
            prolongFor: fileId,
            // preselect a sensible default within what the server still allows
            prolongDays: Math.min(7, info.maxProlongDays),
            prolongCount: Math.min(1, info.maxProlongCount),
        })
    }

    handleProlongChange(event) {
        var info = this.state.fileInfo[this.state.prolongFor]
        var value = parseInt(event.target.value, 10)
        if (isNaN(value) || value < 0)
            value = 0

        if (event.target.id === 'prolong-days')
            this.setState({prolongDays: Math.min(value, info.maxProlongDays)})
        else
            this.setState({prolongCount: Math.min(value, info.maxProlongCount)})
    }

    async handleProlong(fileId) {
        if (this.state.filesBusy)
            return

        var days = this.state.prolongDays
        var count = this.state.prolongCount
        if (!days && !count)
            return

        this.setState({
            filesBusy: true,
            error: null,
        })

        let response
        try {
            let files = JSON.parse(window.localStorage.getItem('savedFiles'))
            let formData = new FormData()
            formData.append('ownerToken', files[fileId].ownerToken)
            formData.append('days', days)
            formData.append('count', count)

            response = await window.fetch(gdprshare.config.apiUrl + '/' + fileId + '/prolong', {
                method: 'POST',
                body: formData,
            })
        } catch (error) {
            return gdprshare.displayErr.call(this, error)
        }

        let fetchData
        try {
            fetchData = await response.clone().json()
        } catch (error) {
            return gdprshare.asTextErr.call(this, response, error)
        }

        if (!response.ok)
            return gdprshare.displayErr.call(this, fetchData.message)

        // the total is only kept locally, keep it in sync with the new maximum
        this.addTotalCount(fileId, count)

        var fileInfo = Object.assign({}, this.state.fileInfo)
        fileInfo[fileId] = fetchData.fileInfo

        this.setState({
            filesBusy: false,
            fileInfo: fileInfo,
            prolongFor: null,
        })
    }

    addTotalCount(fileId, count) {
        try {
            var files = JSON.parse(window.localStorage.getItem('savedFiles'))
            if (!files || !files[fileId])
                return
            files[fileId].totalCount = (files[fileId].totalCount || 0) + count
            window.localStorage.setItem('savedFiles', JSON.stringify(files))
        } catch (e) {
            console.log(e)
        }
    }

    checkFileSize(file) {
        if (!file)
            return
        var allowedSize = gdprshare.config.maxFileSize

        if (file.size > allowedSize * 1024 * 1024) {
            this.setState({
                error: this.props.t('upload.tooBig', {size: allowedSize}),
            })
            var input = this.pickedFileInput()
            if (input) input.value = null
            this.setState({picked: null})
            return false
        }
        return true
    }

    handleFile(event) {
        var file = event.currentTarget.files[0]
        if (!this.checkFileSize(file, event)) {
            this.setState({picked: null})
            return
        }
        // stripping is not optional for the image type, so a format it cannot
        // handle is refused here rather than at submit time
        if (file && this.state.type === 'image' && !canStrip(file)) {
            event.currentTarget.value = null
            this.setState({
                picked: null,
                error: this.props.t('upload.notStrippable', {
                    type: file.type || this.props.t('upload.unknownType'),
                }),
            })
            return
        }
        this.setState({
            error: null,
            picked: file ? {name: file.name, size: file.size} : null,
        })
    }

    // The file and image inputs are rendered one at a time, so the node belongs
    // to whichever one the picked type put there.
    pickedFileInput() {
        return this.state.type === 'image'
            ? this.imageInput.current
            : this.fileInput.current
    }

    handleBrowse(event) {
        // the hidden input sits inside the drop area: a click on it already
        // opens the picker, forwarding it again would open a second dialog
        if (event && event.target && event.target.tagName === 'INPUT')
            return

        var input = this.pickedFileInput()
        if (input) input.click()
    }

    handleClearFile(event) {
        event.stopPropagation()
        var input = this.pickedFileInput()
        if (input) input.value = null
        this.setState({picked: null})
    }

    handlePasswordChange(event) {
        this.setState({password: event.target.value})
    }

    handleEmailChange(event) {
        this.setState({email: event.target.value})
    }

    handleCountChange(value) {
        this.setState({count: gdprshare.clamp(value, 1, gdprshare.config.maxCount)})
    }

    handleExpiryChange(value) {
        this.setState({expiry: gdprshare.clamp(value, 1, gdprshare.config.maxExpiry)})
    }

    toggleOptions() {
        this.setState({optionsOpen: !this.state.optionsOpen})
    }

    handleDragOn(event) {
        event.preventDefault()
        event.stopPropagation()
        this.setState({
            isDragOver: true
        })
    }

    handleDragOff(event) {
        event.preventDefault()
        event.stopPropagation()
        this.setState({
            isDragOver: false
        })
    }

    handleTypeChange(event) {
        this.setState({
            type: event.target.value,
            ephemeral: '0',
            strip: false,
            picked: null,
        })
    }

    handleStripChange(event) {
        const strip = event.target.checked
        this.setState({
            strip: strip,
        })

        // fetch the pdf bundle now so the upload does not have to wait for it,
        // failures are reported when stripping actually runs
        var picked = this.fileInput.current && this.fileInput.current.files[0]
        if (strip && picked && picked.type === 'application/pdf')
            loadPdfLib().catch(function (err) {
                console.log('preloading pdf support:', err)
            })
    }

    handleEphemeralChange(event) {
        this.setState({
            ephemeral: event.target.value,
        })
    }

    handleGeoRestrictionChange(event) {
        var value = event.target.value
        var selectedCountries = []
        var updates = { geoRestriction: value, countrySearch: '' }
        if (value === 'eea') {
            selectedCountries = (this.state.countryGroups.euEEA || []).slice()
        } else if (value === 'gdpr-aligned') {
            selectedCountries = (this.state.countryGroups.gdprAligned || []).slice()
        } else if (value === 'custom') {
            if (!this.state.customCountriesUsed) {
                selectedCountries = this.state.yourCountry ? [this.state.yourCountry] : []
                updates.customCountriesUsed = true
            } else {
                selectedCountries = this.state.customCountries || []
            }
        }
        updates.selectedCountries = selectedCountries
        this.setState(updates)
    }

    handleCountryToggle(code) {
        this.setState(function (prevState) {
            var selected = prevState.selectedCountries.slice()
            var idx = selected.indexOf(code)
            if (idx === -1) {
                selected.push(code)
            } else {
                selected.splice(idx, 1)
            }
            var updates = { selectedCountries: selected }
            if (prevState.geoRestriction === 'custom') {
                updates.customCountries = selected.slice()
            }
            return updates
        })
    }

    handleCountrySearch(event) {
        this.setState({ countrySearch: event.target.value })
    }

    handleDeselectAll() {
        var search = this.state.countrySearch.toLowerCase()
        if (!search) {
            var updates = { selectedCountries: [] }
            if (this.state.geoRestriction === 'custom') {
                updates.customCountries = []
            }
            this.setState(updates)
            return
        }
        var filtered = this.localizedCountries().filter(function (c) {
            return c.name.toLowerCase().indexOf(search) !== -1
        })
        var removeCodes = filtered.map(function (c) { return c.code })
        this.setState(function (prevState) {
            var selected = prevState.selectedCountries.filter(function (c) {
                return removeCodes.indexOf(c) === -1
            })
            var updates = { selectedCountries: selected }
            if (prevState.geoRestriction === 'custom') {
                updates.customCountries = selected.slice()
            }
            return updates
        })
    }

    handleDelayChange(event) {
        this.setState({
            delay: event.target.value
        })
    }

    stepper(id, value, min, max, onChange, unit) {
        var step = function (delta) {
            return function () { onChange(parseInt(value, 10) + delta) }
        }

        return (
            <div className="d-flex align-items-center gap-2">
                <div className="step">
                    <button type="button" className="step-btn" onClick={step(-1)}
                            disabled={value <= min} aria-label={this.props.t('files.less')}>
                        <Minus size="14" />
                    </button>
                    <input className="form-control" id={id} type="number"
                           min={min} max={max} value={value} required
                           onChange={function (e) { onChange(e.target.value) }} />
                    <button type="button" className="step-btn" onClick={step(1)}
                            disabled={value >= max} aria-label={this.props.t('files.more')}>
                        <Plus size="14" />
                    </button>
                </div>
                {unit && <span className="step-unit">{unit}</span>}
            </div>
        )
    }

    summaryChips() {
        const t = this.props.t

        var region = {
            none: t('upload.chipRegionAny'),
            eea: t('upload.regionEea'),
            'gdpr-aligned': t('upload.regionAligned'),
            custom: t('upload.chipCountries', {count: this.state.selectedCountries.length}),
        }[this.state.geoRestriction]

        var expires = new Date()
        expires.setDate(expires.getDate() + parseInt(this.state.expiry, 10))

        var chips = [
            t('upload.chipDownloads', {count: this.state.count}),
            t('upload.chipUntil', {date: gdprshare.formatDate(expires)}),
            region,
            this.state.delay === '0'
                ? t('upload.delayNone')
                : t('upload.chipStartsIn', {delay: this.delayLabel(this.state.delay)}),
        ]

        if (this.state.password)
            chips.push(t('upload.chipPassword'))
        if (this.state.type === 'image' || this.state.strip)
            chips.push(t('upload.chipMetadata'))
        if (this.state.type === 'image' && this.state.ephemeral !== '0')
            chips.push(t('upload.chipDisappears', {duration: this.ephemeralLabel(this.state.ephemeral)}))

        return (
            <div className="chip-row">
                {chips.map(function (text) {
                    return <span className="chip" key={text}>{text}</span>
                })}
            </div>
        )
    }

    // both selects and the summary chips read their labels from the same keys
    delayLabel(minutes) {
        var keys = {1: 'm1', 5: 'm5', 15: 'm15', 30: 'm30', 60: 'h1', 120: 'h2', 1440: 'd1'}
        var key = keys[parseInt(minutes, 10)]
        return key ? this.props.t('duration.' + key) : String(minutes)
    }

    ephemeralLabel(seconds) {
        var keys = {5: 's5', 10: 's10', 30: 's30', 60: 'm1', 120: 'm2', 300: 'm5'}
        var key = keys[parseInt(seconds, 10)]
        return key ? this.props.t('duration.' + key) : String(seconds)
    }

    // the API's English names, replaced by what the browser calls each country
    localizedCountries() {
        return this.state.countryList.map(function (c) {
            return {code: c.code, name: gdprshare.regionName(c.code, c.name)}
        })
    }

    // The copy button's tooltip doubles as the feedback for the copy itself, so
    // it falls back to the label when there is nothing to report.
    tooltips() {
        return (
            <React.Fragment>
                <Tooltip id="tip" place="bottom" />
                <Tooltip id="copy-tip" place="bottom" delayHide={800}
                         render={() => this.state.copy || this.props.t('common.copyLink')} />
            </React.Fragment>
        )
    }

    recordClasses(fileId) {
        return Classnames({
            'btn': true,
            'btn-icon': true,
            'btn-icon-on': this.state.recordFor === fileId,
        })
    }

    prolongClasses(fileId) {
        return Classnames({
            'btn': true,
            'btn-icon': true,
            'btn-icon-on': this.state.prolongFor === fileId,
        })
    }

    prolongPanel(fileId, file) {
        const t = this.props.t
        var days = this.state.prolongDays
        var count = this.state.prolongCount
        // calendar days, same as the server adds them
        var newExpiry = new Date(file.expiryDate)
        newExpiry.setDate(newExpiry.getDate() + days)

        return (
            <div className="prolong-panel">
                <div className="row g-2">
                    <div className="col-6 field">
                        <label htmlFor="prolong-days" className="prolong-label">
                            {t('files.moreDays')} <span className="hint">{t('files.left', {count: file.maxProlongDays})}</span>
                        </label>
                        {this.stepper('prolong-days', days, 0, file.maxProlongDays,
                            function (value) {
                                this.setState({prolongDays: gdprshare.clamp(value, 0, file.maxProlongDays)})
                            }.bind(this))}
                    </div>
                    <div className="col-6 field">
                        <label htmlFor="prolong-count" className="prolong-label">
                            {t('files.moreDownloads')} <span className="hint">{t('files.left', {count: file.maxProlongCount})}</span>
                        </label>
                        {this.stepper('prolong-count', count, 0, file.maxProlongCount,
                            function (value) {
                                this.setState({prolongCount: gdprshare.clamp(value, 0, file.maxProlongCount)})
                            }.bind(this))}
                    </div>
                </div>
                <div className="prolong-actions">
                    <span className="prolong-preview">
                        {days || count ? (
                            <React.Fragment>
                                <span className="hint">{t('files.prolongNew')}</span>
                                <span className="chip chip-accent">
                                    {t('upload.chipDownloads', {count: file.count + count})}
                                </span>
                                <span className="chip chip-accent">
                                    {t('files.until', {date: gdprshare.formatDate(newExpiry)})}
                                </span>
                            </React.Fragment>
                        ) : (
                            <span className="hint">{t('files.prolongEmpty')}</span>
                        )}
                    </span>
                    <button type="button" className="btn btn-sm"
                            onClick={function () { this.handleProlongToggle(fileId) }.bind(this)}>
                        {t('common.cancel')}
                    </button>
                    <button type="button" className="btn btn-sm btn-primary"
                            onClick={function () { this.handleProlong(fileId) }.bind(this)}
                            disabled={!days && !count}>
                        {t('files.prolongSubmit')}
                    </button>
                </div>
            </div>
        )
    }

    fileItem(saved) {
        const t = this.props.t
        let fileId = saved.fileId
        let file = this.state.fileInfo && this.state.fileInfo[fileId]
        if (!file)
            return null

        let state
        let canProlong = false
        let ended = false
        // the server has no copy to delete: either it disowns the entry or it
        // never heard of the file
        let onlyLocal = !!file.error

        if (file.error) {
            console.log(file.error)
            state = <span className="expiry expiry-error">{t('files.notYours')}</span>
        } else {
            let expiryDate = new Date(file.expiryDate)
            // go's time.Time zero value
            let isInitDate = expiryDate.getTime() == new Date('0001-01-01T00:00:00Z').getTime()
            let isExpired = isInitDate || file.count < 1 || Date.now() > expiryDate

            ended = isExpired
            onlyLocal = isInitDate
            if (isExpired) {
                state = (
                    <span className="expiry expiry-expired">
                        {isInitDate ? t('files.gone') : t('files.noneLeft')}
                    </span>
                )
            } else {
                canProlong = file.maxProlongDays > 0 || file.maxProlongCount > 0
                let total = saved.totalCount
                state = (
                    <span className="expiry">
                        {total ? t('files.downloadsLeftOf', {count: file.count, total: total})
                               : t('files.downloadsLeft', {count: file.count})}
                    </span>
                )
            }

            if (!isExpired && !isInitDate)
                state = (
                    <React.Fragment>
                        {state}
                        <span className="chip">{t('files.until', {date: gdprshare.formatDateTime(expiryDate)})}</span>
                    </React.Fragment>
                )
        }

        return (
            <div className={ended ? 'file-item card file-item-ended' : 'file-item card'} key={fileId}>
                <div className="file-item-top">
                    <div className="d-flex flex-column" style={{minWidth: 0, flexGrow: 1}}>
                        <span className="file-name long-text">{saved.filename}</span>
                        <span className="file-id long-text">{fileId}</span>
                    </div>
                    <div className="file-actions">
                        <button id="copy" className="btn btn-icon" type="button"
                                onClick={function (e) { gdprshare.copyText.call(this, e.currentTarget, saved.location) }.bind(this)}
                                data-tooltip-id="copy-tip" aria-label={t('common.copyLink')}>
                            <Copy size="15" />
                        </button>
                        {!onlyLocal && (
                            <button id="record" className={this.recordClasses(fileId)} type="button"
                                    onClick={function (e) { this.toggleRecord(fileId, e) }.bind(this)}
                                    data-tooltip-id="tip" data-tooltip-content={t('files.record')}
                                    aria-expanded={this.state.recordFor === fileId}
                                    aria-label={t('files.record')}>
                                <ListIcon size="15" />
                            </button>
                        )}
                        <button id="prolong" className={this.prolongClasses(fileId)} type="button"
                                onClick={function () { this.handleProlongToggle(fileId) }.bind(this)}
                                disabled={!canProlong}
                                data-tooltip-id="tip" data-tooltip-content={t('files.prolong')}
                                aria-expanded={this.state.prolongFor === fileId}
                                aria-label={t('files.prolong')}>
                            <MoreTime size="15" />
                        </button>
                        <button id="delete" className="btn btn-icon" type="button"
                                onClick={function (e) {
                                    if (onlyLocal)
                                        this.forgetFile(fileId, e)
                                    else
                                        this.handleDelete(fileId, e)
                                }.bind(this)}
                                data-tooltip-id="tip"
                                data-tooltip-content={onlyLocal ? t('files.forget') : t('files.delete')}
                                aria-label={onlyLocal ? t('files.forget') : t('files.delete')}>
                            <Trash size="15" />
                        </button>
                    </div>
                </div>
                <div className="chip-row" style={{marginTop: '9px'}}>
                    {state}
                </div>
                {this.state.recordFor === fileId && this.recordPanel(fileId)}
                {canProlong && this.state.prolongFor === fileId && this.prolongPanel(fileId, file)}
            </div>
        )
    }

    typePicker() {
        const t = this.props.t
        var types = [
            {value: 'file', label: t('upload.typeFile'), icon: <FileIcon size="14" />},
            {value: 'text', label: t('upload.typeText'), icon: <TextIcon size="14" />},
            {value: 'image', label: t('upload.typeImage'), icon: <ImageIcon size="14" />},
        ]

        return (
            <div className="seg" role="radiogroup" aria-label={t('upload.typeFile')}>
                {types.map(function (type) {
                    return (
                        <React.Fragment key={type.value}>
                            <input type="radio" name="type" id={'type-' + type.value}
                                   value={type.value} checked={this.state.type === type.value}
                                   onChange={this.handleTypeChange} />
                            <label htmlFor={'type-' + type.value}>
                                {type.icon}{type.label}
                            </label>
                        </React.Fragment>
                    )
                }.bind(this))}
            </div>
        )
    }

    contentInput() {
        const t = this.props.t

        if (this.state.type === 'text')
            return (
                <textarea className="form-control" id="text" ref={this.textInput} rows="4" minLength="3"
                          maxLength={gdprshare.config.contentMaxLength} required autoFocus
                          aria-label={t('upload.titleText')} />
            )

        var isImage = this.state.type === 'image'
        var input = isImage
            ? <input className="drop-file" id="image-content" type="file" ref={this.imageInput}
                     accept={strippableImageTypes.join(',')} onChange={this.handleFile} required />
            : <input className="drop-file" id="content" type="file" ref={this.fileInput}
                     onChange={this.handleFile} required />

        if (this.state.picked)
            return (
                <div className="picked">
                    {input}
                    {isImage ? <ImageIcon size="16" /> : <FileIcon size="16" />}
                    <div className="d-flex flex-column" style={{minWidth: 0, flexGrow: 1}}>
                        <span className="long-text" style={{fontSize: '13px'}}>{this.state.picked.name}</span>
                        <span className="hint">
                            {gdprshare.formatSize(this.state.picked.size)} · {t('upload.encrypted')}
                        </span>
                    </div>
                    <button type="button" className="btn btn-icon" onClick={this.handleClearFile}
                            data-tooltip-id="tip" data-tooltip-content={t('upload.removeFile')}
                            aria-label={t('upload.removeFile')}>
                        <X size="14" />
                    </button>
                </div>
            )

        return (
            <div className="drop" onClick={this.handleBrowse}>
                {input}
                <UploadIcon size="26" stroke="1.3" />
                <span className="drop-title">
                    {isImage ? t('upload.dropImage') : t('upload.dropFile')}
                </span>
                <span className="hint">
                    <span className="drop-browse">{t('upload.browse')}</span>
                    &nbsp;·&nbsp; {t('upload.sizeLimit', {size: gdprshare.config.maxFileSize})}
                </span>
            </div>
        )
    }

    options() {
        const t = this.props.t
        var search = this.state.countrySearch.toLowerCase()
        var countries = this.localizedCountries()
            .filter(function (c) {
                if (!search) return true
                return c.name.toLowerCase().indexOf(search) !== -1
            })
            .sort(function (a, b) {
                var yours = this.state.yourCountry
                if (a.code === yours) return -1
                if (b.code === yours) return 1
                return a.name.localeCompare(b.name, this.props.i18n.language)
            }.bind(this))

        return (
            <div className="stack">
                <div className="rule"></div>

                <div className="row g-3">
                    <div className="col-6 field">
                        <label htmlFor="count" className="lbl">{t('upload.downloads')}</label>
                        {this.stepper('count', this.state.count, 1, gdprshare.config.maxCount, this.handleCountChange)}
                    </div>
                    <div className="col-6 field">
                        <label htmlFor="expiry" className="lbl">{t('upload.expiry')}</label>
                        {this.stepper('expiry', this.state.expiry, 1, gdprshare.config.maxExpiry, this.handleExpiryChange, t('upload.days'))}
                    </div>
                </div>

                <div className="field">
                    <label htmlFor="geo-restriction" className="lbl">{t('upload.region')}</label>
                    <select className="form-select" id="geo-restriction"
                            value={this.state.geoRestriction}
                            onChange={this.handleGeoRestrictionChange}>
                        <option value="none">{t('upload.regionNone')}</option>
                        <option value="eea">{t('upload.regionEea')}</option>
                        <option value="gdpr-aligned">{t('upload.regionAligned')}</option>
                        <option value="custom">{t('upload.regionCustom')}</option>
                    </select>
                    <span className="hint">{t('upload.regionHint')}</span>
                </div>

                {this.state.geoRestriction === 'custom' && (
                    <div className="panel stack" style={{gap: '8px'}}>
                        <div className="d-flex gap-2">
                            <input className="form-control" type="text" placeholder={t('upload.searchCountries')}
                                   value={this.state.countrySearch} onChange={this.handleCountrySearch} />
                            <button type="button" className="btn" onClick={this.handleDeselectAll}>
                                {t('common.clear')}
                            </button>
                        </div>
                        <div className="country-picker">
                            {countries.map(function (c) {
                                return (
                                    <div key={c.code} className="form-check">
                                        <input className="form-check-input" type="checkbox"
                                               id={'country-' + c.code}
                                               checked={this.state.selectedCountries.indexOf(c.code) !== -1}
                                               onChange={function () { this.handleCountryToggle(c.code) }.bind(this)} />
                                        <label htmlFor={'country-' + c.code} className="form-check-label">
                                            {c.name}
                                        </label>
                                    </div>
                                )
                            }.bind(this))}
                        </div>
                        <span className="hint">
                            {t('upload.selectedCountries', {
                                count: this.state.selectedCountries.length,
                                total: this.state.countryList.length,
                            })}
                        </span>
                    </div>
                )}

                <div className="field">
                    <label htmlFor="delay" className="lbl">{t('upload.delay')}</label>
                    <select className="form-select" id="delay" value={this.state.delay}
                            onChange={this.handleDelayChange}>
                        <option value="0">{t('upload.delayNone')}</option>
                        {[1, 5, 15, 30, 60, 120, 1440].map(function (minutes) {
                            return (
                                <option key={minutes} value={minutes}>
                                    {this.delayLabel(minutes)}
                                </option>
                            )
                        }.bind(this))}
                    </select>
                    <span className="hint">{t('upload.delayHint')}</span>
                </div>

                <div className="field">
                    <label htmlFor="password" className="lbl">{t('upload.password')}</label>
                    <input className="form-control" id="password" type="password"
                           placeholder={t('upload.password')} maxLength="255"
                           autoComplete="new-password"
                           value={this.state.password} onChange={this.handlePasswordChange} />
                    <span className="hint">{t('upload.passwordHint')}</span>
                </div>

                <div className="field">
                    <label htmlFor="email" className="lbl">{t('upload.email')}</label>
                    <input className="form-control" id="email" type="email"
                           placeholder={t('upload.emailPlaceholder')} maxLength="255" minLength="6"
                           value={this.state.email} onChange={this.handleEmailChange} />
                    <span className="hint">{t('upload.emailHint')}</span>
                </div>

                {this.state.type === 'file' && (
                    <div className="switch-row">
                        <span className="switch">
                            <input type="checkbox" id="strip" checked={this.state.strip}
                                   onChange={this.handleStripChange} />
                            <span className="slider"></span>
                        </span>
                        <label htmlFor="strip" className="d-flex flex-column" style={{cursor: 'pointer'}}>
                            <span style={{fontSize: '13px'}}>{t('upload.strip')}</span>
                            <span className="hint">{t('upload.stripHint')}</span>
                        </label>
                    </div>
                )}

                {this.state.type === 'image' && (
                    <div className="panel">
                        <div className="d-flex align-items-center gap-3">
                            <label htmlFor="ephemeral" className="d-flex flex-column" style={{flexGrow: 1, cursor: 'pointer'}}>
                                <span style={{fontSize: '13px'}}>{t('upload.ephemeral')}</span>
                                <span className="hint">{t('upload.ephemeralHint')}</span>
                            </label>
                            <select className="form-select" id="ephemeral" style={{width: '150px'}}
                                    value={this.state.ephemeral} onChange={this.handleEphemeralChange}>
                                <option value="0">{t('upload.ephemeralNone')}</option>
                                {[5, 10, 30, 60, 120, 300].map(function (seconds) {
                                    return (
                                        <option key={seconds} value={seconds}>
                                            {this.ephemeralLabel(seconds)}
                                        </option>
                                    )
                                }.bind(this))}
                            </select>
                        </div>
                    </div>
                )}
            </div>
        )
    }

    render() {
        const t = this.props.t
        var savedFiles = []
        var files = {}

        try {
            files = JSON.parse(window.localStorage.getItem('savedFiles'))
        } catch (e) {
            console.log(e)
        }

        for (var i in files) {
            var item = this.fileItem(files[i])
            if (item)
                savedFiles.push(item)
        }

        var uploadCard = (
            <div className={this.outerClasses()} onDragEnter={this.handleDragOn}>
                <div className={this.dndClasses()} onDrop={this.handleDrop} onDragEnter={this.handleDragOn}
                     onDragOver={this.handleDragOn} onDragLeave={this.handleDragOff}
                     onDragEnd={this.handleDragOff}>
                    <UploadIcon size="26" stroke="1.3" />
                    <span className="drop-title">{t('upload.dropAnywhere')}</span>
                </div>
                <form className={this.innerClasses()} onSubmit={this.handleUpload}>
                    <div className="row-between">
                        <h4>{t({file: 'upload.titleFile', text: 'upload.titleText', image: 'upload.titleImage'}[this.state.type])}</h4>
                        {this.typePicker()}
                    </div>

                    {this.contentInput()}
                    {this.summaryChips()}
                    {this.sendingStatus()}

                    <button type="button" className="btn btn-link-quiet btn-sm align-self-start px-0"
                            onClick={this.toggleOptions} aria-expanded={this.state.optionsOpen}>
                        {this.state.optionsOpen ? <ChevronDown size="15" /> : <ChevronRight size="15" />}
                        {this.state.optionsOpen ? t('upload.fewerOptions') : t('upload.moreOptions')}
                    </button>

                    {this.state.optionsOpen && this.options()}

                    <input type="submit" ref={this.submitButton} className="btn btn-primary btn-block"
                           value={t('upload.submit')}
                           disabled={this.state.geoRestriction !== 'none' && this.state.selectedCountries.length === 0} />
                    <span className="hint text-center">{t('upload.submitHint')}</span>
                    <Alert error={this.state.error} tone={this.state.errorTone} />
                </form>
            </div>
        )

        if (savedFiles.length < 1)
            return (
                <div className="container-fluid">
                    {uploadCard}
                    {this.tooltips()}
                </div>
            )

        return (
            <div className="container-fluid" style={{maxWidth: '1040px'}}>
                <div className="row g-4">
                    <div className="col-lg-5">
                        {uploadCard}
                    </div>
                    <div className="col-lg-7">
                        <div className={this.filesClasses()}>
                            <div className="files-hdr">
                                <h4>{t('files.title')}</h4>
                                <span className="chip mono">{savedFiles.length}</span>
                                <div style={{flexGrow: 1}}></div>
                                <button type="button" className="btn btn-icon" onClick={this.updateValidity}
                                        data-tooltip-id="tip" data-tooltip-content={t('files.refresh')}
                                        aria-label={t('files.refresh')}>
                                    <Refresh size="15" />
                                </button>
                            </div>
                            <div className="saved-files">
                                {savedFiles}
                            </div>
                        </div>
                    </div>
                </div>
                {this.tooltips()}
            </div>
        )
    }
}

export default withTranslation()(withRouter(Upload))
