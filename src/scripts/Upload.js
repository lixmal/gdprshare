import React from 'react'
import Classnames from 'classnames'
import { Copy, Trash, MoreTime, Upload as UploadIcon, FileIcon, TextIcon, ImageIcon,
         Lock, Minus, Plus, X, ChevronDown, ChevronRight, Refresh, ListIcon } from './Icons'
import Alert from './Alert'
import { Tooltip } from 'react-tooltip'
import { withRouter } from './withRouter'
import { withTranslation } from 'react-i18next'
import { stripMetadata, loadPdfLib, canStrip, strippableImageTypes } from './strip'

class Upload extends React.Component {
    constructor() {
        super()

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
        this.forgetFile = this.forgetFile.bind(this)
        this.toggleRecord = this.toggleRecord.bind(this)

        this.state = {
            error: null,
            mask: false,
            filesBusy: false,
            copy: null,
            fileInfo: null,
            type: 'file',
            geoRestriction: 'eea',
            countryList: [],
            countryGroups: {},
            selectedCountries: [],
            yourCountry: '',
            countrySearch: '',
            customCountriesUsed: false,
            delay: '0',
            ephemeral: '0',
            strip: false,
            prolongFor: null,
            prolongDays: 0,
            prolongCount: 0,
            count: 1,
            expiry: 7,
            email: window.localStorage.getItem('email') || '',
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
                    selectedCountries: data.groups.euEEA || [],
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
            'loading-mask': this.state.mask,
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

    async uploadFile(key, data, encFilename, plainFilename) {
        var formData = new FormData()
        var file = new File(
            [data],
            {
                type: 'application/octet-stream'
            },
        )

        var email = this.state.email
        formData.append('type', this.state.type)
        formData.append('file', file, encFilename)
        formData.append('filename', encFilename)
        formData.append('count', this.state.count)
        formData.append('expiry', this.state.expiry)
        formData.append('email', email)
        if (this.state.geoRestriction !== 'none') {
            formData.append('allowed-countries', this.state.selectedCountries.join(','))
        }
        if (this.state.delay !== '0')
            formData.append('delay', this.state.delay)
        if (this.state.type === 'image' && this.state.ephemeral !== '0')
            formData.append('ephemeral', this.state.ephemeral)

        window.localStorage.setItem('email', email)

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

        var files = {}

        try {
            files = JSON.parse(window.localStorage.getItem('savedFiles'))
        } catch (e) {
            console.log(e)
        }

        if (!files) files = {}


        const loc = location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '') + response.headers.get('Location')
        const b64Key = gdprshare.keyToB64(key)
        if (gdprshare.config.saveFiles) {
            files[fetchData.fileId] = {
                filename: plainFilename,
                fileId: fetchData.fileId,
                ownerToken: fetchData.ownerToken,
                location: loc + '#' + b64Key,
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
                key: b64Key,
                count: this.state.count,
                expiry: this.state.expiry,
                region: regionLabels[this.state.geoRestriction],
            }
        })
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

        var ref = this.state.type === 'image' ? this.refs.image : this.refs.file
        if (ref) ref.files = files
        this.setState({picked: {name: files[0].name, size: files[0].size}})
        this.refs.submit.click()
    }


    async handleUpload(event) {
        event.preventDefault()
        if (this.state.mask)
            return

        this.setState({
            error: null,
            mask: true,
        })

        const key = window.crypto.getRandomValues(new Uint8Array(gdprshare.config.keyLength))


        let file
        if (this.state.type === 'text') {
            let text = this.refs.text.value
            // using first few chars as filename for recognizability
            // TODO: sanitize for usage in file names
            file = new File([text], text.slice(0, 21) + '.txt', {type: 'text/plain'})
        } else {
            file = this.state.type === 'image' ? this.refs.image.files[0] : this.refs.file.files[0]

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

            var reader = new FileReader()
            reader.onload = async function (event) {
                // the outer catch cannot see this callback's rejections, and a
                // silent one would leave the form masked forever
                try {
                    // encryption of file
                    const cipherText = await gdprshare.encrypt(event.target.result, key)

                    await this.uploadFile(key, cipherText, filename, file.name)
                } catch (error) {
                    gdprshare.displayErr.call(this, error)
                }
            }.bind(this)
            reader.onerror = function () {
                gdprshare.displayErr.call(this, reader.error || 'could not read the file')
            }.bind(this)
            reader.readAsArrayBuffer(file)
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
                    // from that side rather than from the refused visitor's
                    var reason = null
                    if (record.denied) {
                        if (record.reason === 'download_location_forbidden')
                            reason = t('files.reasonLocation')
                        else if (record.reason === 'file_not_yet_downloadable')
                            reason = t('files.reasonTooEarly')
                        else if (record.reason === 'user_agent_blocked')
                            reason = t('files.reasonBrowser')
                        else
                            // a server newer than this build still says something
                            reason = record.reason
                    }

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
            var ref = this.state.type === 'image' ? this.refs.image : this.refs.file
            if (ref) ref.value = null
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

    handleBrowse(event) {
        // the hidden input sits inside the drop area: a click on it already
        // opens the picker, forwarding it again would open a second dialog
        if (event && event.target && event.target.tagName === 'INPUT')
            return

        var ref = this.state.type === 'image' ? this.refs.image : this.refs.file
        if (ref) ref.click()
    }

    handleClearFile(event) {
        event.stopPropagation()
        var ref = this.state.type === 'image' ? this.refs.image : this.refs.file
        if (ref) ref.value = null
        this.setState({picked: null})
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
        if (strip && this.refs.file && this.refs.file.files[0] &&
            this.refs.file.files[0].type === 'application/pdf')
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
                    <input className="form-control" id={id} type="number" ref={id}
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
                <textarea className="form-control" id="text" ref="text" rows="4" minLength="3"
                          maxLength={gdprshare.config.contentMaxLength} required autoFocus
                          aria-label={t('upload.titleText')} />
            )

        var isImage = this.state.type === 'image'
        var input = isImage
            ? <input className="drop-file" id="image-content" type="file" ref="image"
                     accept={strippableImageTypes.join(',')} onChange={this.handleFile} required />
            : <input className="drop-file" id="content" type="file" ref="file"
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
                    <label htmlFor="email" className="lbl">{t('upload.email')}</label>
                    <input className="form-control" id="email" type="email" ref="email"
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
                <form ref="form" className={this.innerClasses()} onSubmit={this.handleUpload}>
                    <div className="row-between">
                        <h4>{t({file: 'upload.titleFile', text: 'upload.titleText', image: 'upload.titleImage'}[this.state.type])}</h4>
                        {this.typePicker()}
                    </div>

                    {this.contentInput()}
                    {this.summaryChips()}

                    <button type="button" className="btn btn-link-quiet btn-sm align-self-start px-0"
                            onClick={this.toggleOptions} aria-expanded={this.state.optionsOpen}>
                        {this.state.optionsOpen ? <ChevronDown size="15" /> : <ChevronRight size="15" />}
                        {this.state.optionsOpen ? t('upload.fewerOptions') : t('upload.moreOptions')}
                    </button>

                    {this.state.optionsOpen && this.options()}

                    <input type="submit" ref="submit" className="btn btn-primary btn-block"
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
