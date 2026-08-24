import React from 'react'
import Classnames from 'classnames'
import { Copy, Trash, MoreTime, Upload as UploadIcon, FileIcon, TextIcon, ImageIcon,
         Lock, Minus, Plus, Search, X, ChevronDown, ChevronRight, Refresh } from './Icons'
import Alert from './Alert'
import { Tooltip } from 'react-tooltip'
import { withRouter } from './withRouter'
import { stripMetadata, loadPdfLib } from './strip'

class Upload extends React.Component {
    constructor() {
        super()

        this.copyHandler = gdprshare.copyHandler.bind(this)
        this.handleTipContent = gdprshare.handleTipContent.bind(this)
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

        this.state = {
            error: null,
            mask: false,
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
            optionsOpen: false,
            picked: null,
        }
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
            let error = 'fetching file validity failed: ' + fetchData.message
            // TODO: mask removal could be a race with something else
            return gdprshare.displayErr.call(this, error)
        }

        this.setState({
            fileInfo: fetchData.fileInfo
        })
    }

    outerClasses() {
        return Classnames({
            'app-outer': true,
            'drag-outer': this.state.isDragOver,
            'loading-mask': this.state.mask,
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

        var email = this.refs.email.value
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
            eea: 'EU / EEA only',
            'gdpr-aligned': 'EU / EEA and aligned countries only',
            custom: this.state.selectedCountries.length + ' countries only',
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
                    gdprshare.displayErr.call(this, 'Could not strip metadata: ' + err.message)
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
                // encryption of file
                const cipherText = await gdprshare.encrypt(event.target.result, key)

                await this.uploadFile(key, cipherText, filename, file.name)
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

    async handleDelete(fileID, event) {
        if (this.state.mask)
            return

        this.setState({
            mask: true,
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
                mask: false,
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
        if (this.state.mask)
            return

        var days = this.state.prolongDays
        var count = this.state.prolongCount
        if (!days && !count)
            return

        this.setState({
            mask: true,
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
            mask: false,
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
                error: 'File too big, maximum allowed size: ' + allowedSize + ' MiB.',
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
        this.setState({
            picked: file ? {name: file.name, size: file.size} : null,
        })
    }

    handleBrowse() {
        var ref = this.state.type === 'image' ? this.refs.image : this.refs.file
        if (ref) ref.click()
    }

    handleClearFile(event) {
        event.stopPropagation()
        var ref = this.state.type === 'image' ? this.refs.image : this.refs.file
        if (ref) ref.value = null
        this.setState({picked: null})
    }

    handleCountChange(value) {
        this.setState({count: gdprshare.clamp(value, 1, 15)})
    }

    handleExpiryChange(value) {
        this.setState({expiry: gdprshare.clamp(value, 1, 14)})
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
        var filtered = this.state.countryList.filter(function (c) {
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
                            disabled={value <= min} aria-label={'One less'}>
                        <Minus size="14" />
                    </button>
                    <input className="form-control" id={id} type="number" ref={id}
                           min={min} max={max} value={value} required
                           onChange={function (e) { onChange(e.target.value) }} />
                    <button type="button" className="step-btn" onClick={step(1)}
                            disabled={value >= max} aria-label={'One more'}>
                        <Plus size="14" />
                    </button>
                </div>
                {unit && <span className="step-unit">{unit}</span>}
            </div>
        )
    }

    summaryChips() {
        var region = {
            none: 'Any region',
            eea: 'EU / EEA',
            'gdpr-aligned': 'EU / EEA + aligned',
            custom: this.state.selectedCountries.length + ' countries',
        }[this.state.geoRestriction]

        var delay = this.state.delay === '0'
            ? 'No delay'
            : 'Starts in ' + this.delayLabel(this.state.delay)

        var chips = [
            this.state.count + (this.state.count > 1 ? ' downloads' : ' download'),
            this.state.expiry + (this.state.expiry > 1 ? ' days' : ' day'),
            region,
            delay,
        ]

        if (this.state.type === 'image' || this.state.strip)
            chips.push('Hidden data removed')
        if (this.state.type === 'image' && this.state.ephemeral !== '0')
            chips.push('Disappears after ' + this.state.ephemeral + 's')

        return (
            <div className="chip-row">
                {chips.map(function (text) {
                    return <span className="chip" key={text}>{text}</span>
                })}
            </div>
        )
    }

    delayLabel(minutes) {
        var value = parseInt(minutes, 10)
        if (value >= 1440)
            return '1 day'
        if (value >= 60)
            return (value / 60) + (value === 60 ? ' hour' : ' hours')
        return value + ' min'
    }

    prolongClasses(fileId) {
        return Classnames({
            'btn': true,
            'btn-icon': true,
            'btn-icon-on': this.state.prolongFor === fileId,
        })
    }

    prolongPanel(fileId, file) {
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
                            More days <span className="hint">({file.maxProlongDays} left)</span>
                        </label>
                        {this.stepper('prolong-days', days, 0, file.maxProlongDays,
                            function (value) {
                                this.setState({prolongDays: gdprshare.clamp(value, 0, file.maxProlongDays)})
                            }.bind(this))}
                    </div>
                    <div className="col-6 field">
                        <label htmlFor="prolong-count" className="prolong-label">
                            More downloads <span className="hint">({file.maxProlongCount} left)</span>
                        </label>
                        {this.stepper('prolong-count', count, 0, file.maxProlongCount,
                            function (value) {
                                this.setState({prolongCount: gdprshare.clamp(value, 0, file.maxProlongCount)})
                            }.bind(this))}
                    </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                    <span className="chip chip-accent prolong-preview">
                        {days || count
                            ? 'New: ' + (file.count + count) + (file.count + count > 1 ? ' downloads' : ' download') +
                              ', until ' + newExpiry.toLocaleString()
                            : 'Pick days or downloads to add'}
                    </span>
                    <div style={{flexGrow: 1}}></div>
                    <button type="button" className="btn btn-sm"
                            onClick={function () { this.handleProlongToggle(fileId) }.bind(this)}>
                        Cancel
                    </button>
                    <button type="button" className="btn btn-sm btn-primary"
                            onClick={function () { this.handleProlong(fileId) }.bind(this)}
                            disabled={!days && !count}>
                        Prolong
                    </button>
                </div>
            </div>
        )
    }

    fileItem(saved) {
        let fileId = saved.fileId
        let file = this.state.fileInfo && this.state.fileInfo[fileId]
        if (!file)
            return null

        let state
        let canProlong = false

        if (file.error) {
            console.log(file.error)
            state = <span className="expiry expiry-error">Not yours any more</span>
        } else {
            let expiryDate = new Date(file.expiryDate)
            // go's time.Time zero value
            let isInitDate = expiryDate.getTime() == new Date('0001-01-01T00:00:00Z').getTime()
            let isExpired = isInitDate || file.count < 1 || Date.now() > expiryDate

            if (isExpired) {
                state = (
                    <span className="expiry expiry-expired">
                        {isInitDate ? 'Gone from the server' : 'No downloads left'}
                    </span>
                )
            } else {
                canProlong = file.maxProlongDays > 0 || file.maxProlongCount > 0
                let total = saved.totalCount
                state = (
                    <span className="expiry">
                        {total ? file.count + ' of ' + total + ' downloads left'
                               : file.count + (file.count > 1 ? ' downloads left' : ' download left')}
                    </span>
                )
            }

            if (!isExpired && !isInitDate)
                state = (
                    <React.Fragment>
                        {state}
                        <span className="chip">Until {expiryDate.toLocaleString()}</span>
                    </React.Fragment>
                )
        }

        return (
            <div className="file-item card" key={fileId}>
                <div className="file-item-top">
                    <div className="d-flex flex-column" style={{minWidth: 0, flexGrow: 1}}>
                        <span className="file-name long-text">{saved.filename}</span>
                        <span className="file-id long-text">{fileId}</span>
                    </div>
                    <div className="file-actions">
                        <button id="copy" className="btn btn-icon" type="button"
                                onClick={function (e) { gdprshare.copyText.call(this, e.currentTarget, saved.location) }.bind(this)}
                                data-for="copy-tip" data-tip aria-label="Copy the link">
                            <Copy size="15" />
                        </button>
                        <button id="prolong" className={this.prolongClasses(fileId)} type="button"
                                onClick={function () { this.handleProlongToggle(fileId) }.bind(this)}
                                disabled={!canProlong} data-tip data-for="prolong-tip"
                                aria-expanded={this.state.prolongFor === fileId}
                                aria-label="Give it more time">
                            <MoreTime size="15" />
                        </button>
                        <button id="delete" className="btn btn-icon" type="button"
                                onClick={function (e) { this.handleDelete(fileId, e) }.bind(this)}
                                data-tip data-for="delete-tip" aria-label="Delete from the server">
                            <Trash size="15" />
                        </button>
                    </div>
                </div>
                <div className="chip-row" style={{marginTop: '9px'}}>
                    {state}
                </div>
                {canProlong && this.state.prolongFor === fileId && this.prolongPanel(fileId, file)}
            </div>
        )
    }

    typePicker() {
        var types = [
            {value: 'file', label: 'File', icon: <FileIcon size="14" />},
            {value: 'text', label: 'Text', icon: <TextIcon size="14" />},
            {value: 'image', label: 'Image', icon: <ImageIcon size="14" />},
        ]

        return (
            <div className="seg" role="radiogroup" aria-label="Type">
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
        if (this.state.type === 'text')
            return (
                <textarea className="form-control" id="text" ref="text" rows="4" minLength="3"
                          maxLength={gdprshare.config.contentMaxLength} required autoFocus />
            )

        var isImage = this.state.type === 'image'
        var input = isImage
            ? <input className="drop-file" id="image-content" type="file" ref="image"
                     accept="image/*" onChange={this.handleFile} required />
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
                            {gdprshare.formatSize(this.state.picked.size)} · locked before it leaves your device
                        </span>
                    </div>
                    <button type="button" className="btn btn-icon" onClick={this.handleClearFile}
                            aria-label="Remove the file">
                        <X size="14" />
                    </button>
                </div>
            )

        return (
            <div className="drop" onClick={this.handleBrowse}>
                {input}
                <UploadIcon size="26" stroke="1.3" />
                <span className="drop-title">
                    {isImage ? 'Drop a picture here' : 'Drop a file here'}
                </span>
                <span className="hint">
                    or <span className="drop-browse">browse</span> &nbsp;·&nbsp; up to {gdprshare.config.maxFileSize} MB
                </span>
            </div>
        )
    }

    options() {
        var countries = this.state.countryList
            .filter(function (c) {
                if (!this.state.countrySearch) return true
                return c.name.toLowerCase().indexOf(this.state.countrySearch.toLowerCase()) !== -1
            }.bind(this))
            .sort(function (a, b) {
                var yours = this.state.yourCountry
                if (a.code === yours) return -1
                if (b.code === yours) return 1
                return 0
            }.bind(this))

        return (
            <div className="stack">
                <div className="rule"></div>

                <div className="row g-3">
                    <div className="col-6 field">
                        <label htmlFor="count" className="lbl">Downloads</label>
                        {this.stepper('count', this.state.count, 1, 15, this.handleCountChange, 'up to 15')}
                    </div>
                    <div className="col-6 field">
                        <label htmlFor="expiry" className="lbl">Expires after</label>
                        {this.stepper('expiry', this.state.expiry, 1, 14, this.handleExpiryChange, 'days')}
                    </div>
                </div>

                <div className="field">
                    <label htmlFor="geo-restriction" className="lbl">Region</label>
                    <select className="form-select" id="geo-restriction"
                            value={this.state.geoRestriction}
                            onChange={this.handleGeoRestrictionChange}>
                        <option value="none">Anywhere</option>
                        <option value="eea">EU / EEA</option>
                        <option value="gdpr-aligned">EU / EEA and countries with the same rules</option>
                        <option value="custom">Countries I pick</option>
                    </select>
                    <span className="hint">Only people in these countries can open the link</span>
                </div>

                {this.state.geoRestriction === 'custom' && (
                    <div className="panel stack" style={{gap: '8px'}}>
                        <div className="d-flex gap-2">
                            <input className="form-control" type="text" placeholder="Search countries"
                                   value={this.state.countrySearch} onChange={this.handleCountrySearch} />
                            <button type="button" className="btn" onClick={this.handleDeselectAll}>Clear</button>
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
                            {this.state.selectedCountries.length} of {this.state.countryList.length} selected
                        </span>
                    </div>
                )}

                <div className="field">
                    <label htmlFor="delay" className="lbl">Delay</label>
                    <select className="form-select" id="delay" value={this.state.delay}
                            onChange={this.handleDelayChange}>
                        <option value="0">No delay</option>
                        <option value="1">1 minute</option>
                        <option value="5">5 minutes</option>
                        <option value="15">15 minutes</option>
                        <option value="30">30 minutes</option>
                        <option value="60">1 hour</option>
                        <option value="120">2 hours</option>
                        <option value="1440">1 day</option>
                    </select>
                    <span className="hint">How long before the link starts working</span>
                </div>

                <div className="field">
                    <label htmlFor="email" className="lbl">Notify by email</label>
                    <input className="form-control" id="email" type="email" ref="email"
                           placeholder="you@example.org (optional)" maxLength="255" minLength="6"
                           defaultValue={window.localStorage.getItem('email')} />
                    <span className="hint">One email each time someone opens the link</span>
                </div>

                {this.state.type === 'file' && (
                    <div className="switch-row">
                        <span className="switch">
                            <input type="checkbox" id="strip" checked={this.state.strip}
                                   onChange={this.handleStripChange} />
                            <span className="slider"></span>
                        </span>
                        <label htmlFor="strip" className="d-flex flex-column" style={{cursor: 'pointer'}}>
                            <span style={{fontSize: '13px'}}>Remove hidden data</span>
                            <span className="hint">
                                Location, camera and author details are taken out first. Pictures other
                                than GIFs are re-encoded, other file types are refused.
                            </span>
                        </label>
                    </div>
                )}

                {this.state.type === 'image' && (
                    <div className="panel">
                        <div className="d-flex align-items-center gap-3">
                            <label htmlFor="ephemeral" className="d-flex flex-column" style={{flexGrow: 1, cursor: 'pointer'}}>
                                <span style={{fontSize: '13px'}}>Disappears after</span>
                                <span className="hint">How long the picture stays on screen</span>
                            </label>
                            <select className="form-select" id="ephemeral" style={{width: '150px'}}
                                    value={this.state.ephemeral} onChange={this.handleEphemeralChange}>
                                <option value="0">Stays open</option>
                                <option value="5">5 seconds</option>
                                <option value="10">10 seconds</option>
                                <option value="30">30 seconds</option>
                                <option value="60">1 minute</option>
                                <option value="120">2 minutes</option>
                                <option value="300">5 minutes</option>
                            </select>
                        </div>
                    </div>
                )}
            </div>
        )
    }

    render() {
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
                    <span className="drop-title">Drop it anywhere</span>
                </div>
                <form ref="form" className={this.innerClasses()} onSubmit={this.handleUpload}>
                    <div className="row-between">
                        <h4>{ {file: 'Send a file', text: 'Send a message', image: 'Send a picture'}[this.state.type] }</h4>
                        {this.typePicker()}
                    </div>

                    {this.contentInput()}
                    {this.summaryChips()}

                    <button type="button" className="btn btn-link-quiet btn-sm align-self-start px-0"
                            onClick={this.toggleOptions} aria-expanded={this.state.optionsOpen}>
                        {this.state.optionsOpen ? <ChevronDown size="15" /> : <ChevronRight size="15" />}
                        {this.state.optionsOpen ? 'Fewer options' : 'More options'}
                    </button>

                    {this.state.optionsOpen && this.options()}

                    <input type="submit" ref="submit" className="btn btn-primary btn-block"
                           value="Encrypt and upload"
                           disabled={this.state.geoRestriction !== 'none' && this.state.selectedCountries.length === 0} />
                    <span className="hint text-center">
                        Anyone who has the link can open the file, so pass it on carefully.
                    </span>
                    <Alert error={this.state.error} />
                </form>
            </div>
        )

        if (savedFiles.length < 1)
            return (
                <div className="container-fluid">
                    {uploadCard}
                    <Tooltip id="copy-tip" openOnClick={false} render={() => this.state.copy} delayHide={1000} />
                </div>
            )

        return (
            <div className="container-fluid" style={{maxWidth: '1040px'}}>
                <div className="row g-4">
                    <div className="col-lg-5">
                        {uploadCard}
                    </div>
                    <div className="col-lg-7">
                        <div className="app-outer files-card">
                            <div className="files-hdr">
                                <h4>Your uploads</h4>
                                <span className="chip mono">{savedFiles.length}</span>
                                <div style={{flexGrow: 1}}></div>
                                <button type="button" className="btn btn-icon" onClick={this.updateValidity}
                                        aria-label="Check with the server">
                                    <Refresh size="15" />
                                </button>
                            </div>
                            <div className="saved-files">
                                {savedFiles}
                            </div>
                        </div>
                    </div>
                </div>
                <Tooltip id="copy-tip" openOnClick={false} render={() => this.state.copy} delayHide={1000} />
            </div>
        )
    }
}

export default withRouter(Upload)
