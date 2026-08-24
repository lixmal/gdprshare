import React from 'react'
import Classnames from 'classnames'
import Octicon, {Clippy, CloudUpload, Trashcan, Clock} from '@primer/octicons-react'
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
        formData.append('count', this.refs.count.value)
        formData.append('expiry', this.refs.expiry.value)
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
                totalCount: parseInt(this.refs.count.value, 10) || 1,
            }

            try {
                window.localStorage.setItem('savedFiles', JSON.stringify(files))
            } catch (e) {
                console.log(e)
            }
        }

        this.props.router.navigate('/uploaded', {
            state: {
                location: loc,
                // unencrypted filename
                filename: plainFilename,
                key: b64Key,
                count: this.refs.count.value,
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

    async handleDelete(event) {
        if (this.state.mask)
            return

        this.setState({
            mask: true,
            error: null
        })

        var btn = event.currentTarget
        btn.blur()

        let fileID
        let response
        try {
            fileID = btn.parentNode.nextSibling.textContent
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
            return false
        }
        return true
    }

    handleFile(event) {
        var file = event.currentTarget.files[0]
        if (!this.checkFileSize(file, event))
            return
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

    prolongClasses(fileId) {
        return Classnames({
            'btn': true,
            'btn-sm': true,
            'prolong-open': this.state.prolongFor === fileId,
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
                <div className="row g-1 align-items-end">
                    <div className="col-6">
                        <label htmlFor="prolong-days" className="col-form-label-sm prolong-label">
                            + days (max {file.maxProlongDays})
                        </label>
                        <input className="form-control form-control-sm" id="prolong-days" type="number"
                               min="0" max={file.maxProlongDays} value={days}
                               onChange={this.handleProlongChange}
                               disabled={file.maxProlongDays < 1}/>
                    </div>
                    <div className="col-6">
                        <label htmlFor="prolong-count" className="col-form-label-sm prolong-label">
                            + downloads (max {file.maxProlongCount})
                        </label>
                        <input className="form-control form-control-sm" id="prolong-count" type="number"
                               min="0" max={file.maxProlongCount} value={count}
                               onChange={this.handleProlongChange}
                               disabled={file.maxProlongCount < 1}/>
                    </div>
                </div>
                <div className="d-flex align-items-center gap-2 mt-2">
                    <small className="text-muted prolong-preview">
                        {days || count
                            ? `${file.count + count} DL${file.count + count > 1 ? 's' : ''} or ${newExpiry.toLocaleString()}`
                            : 'Pick days or downloads to add'}
                    </small>
                    <button type="button" className="btn btn-sm btn-outline-secondary ms-auto"
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

    render() {
        var savedFiles = []
        var files = {}

        try {
            files = JSON.parse(window.localStorage.getItem('savedFiles'))
        } catch (e) {
            console.log(e)
        }

        for (var i in files) {
            let expiry
            let canProlong = false
            let file = this.state.fileInfo && this.state.fileInfo[files[i].fileId]
            if (!file)
                continue

            if (file.error) {
                console.log(file.error)
                expiry = (
                    <span className="expiry expiry-error">
                        &lt;error&gt;
                    </span>
                )
            } else {
                let expiryDate = new Date(file.expiryDate)
                // go's time.Time zero value
                let isInitDate = expiryDate.getTime() == new Date('0001-01-01T00:00:00Z').getTime()
                let isExpired = isInitDate || file.count < 1 || Date.now() > expiryDate

                let text
                let classes
                if (isExpired) {
                    classes = 'expiry expiry-expired'
                    text = '<expired>'
                } else {
                    canProlong = file.maxProlongDays > 0 || file.maxProlongCount > 0
                    classes = 'expiry'
                    let expires = isInitDate ? '<no data>' : expiryDate.toLocaleString()
                    let total = files[i].totalCount
                    let countText = total ? `${file.count}/${total}` : `${file.count}`
                    let s = file.count > 1 ? 's' : ''
                    text = `${countText} DL${s} or ${expires}`
                }
                expiry = (
                    <span className={classes}>
                        {text}
                    </span>
                )
            }

            let fileId = files[i].fileId
            savedFiles.push(
                <div className="card" key={fileId}>
                    <div className="card-header">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <button id="copy" className="btn btn-sm" onClick={this.copyHandler} type="button"
                                        data-for="copy-tip" data-tip>
                                    <Octicon icon={Clippy}/>
                                </button>
                                <button id="delete" className="btn btn-sm" onClick={this.handleDelete} type="button"
                                        data-tip data-for="delete-tip">
                                    <Octicon icon={Trashcan}/>
                                </button>
                                <button id="prolong" className={this.prolongClasses(fileId)} type="button"
                                        onClick={function () { this.handleProlongToggle(fileId) }.bind(this)}
                                        disabled={!canProlong} data-tip data-for="prolong-tip"
                                        aria-expanded={this.state.prolongFor === fileId}>
                                    <Octicon icon={Clock}/>
                                </button>
                            </div>
                            <span className="card-header-text long-text">
                                {fileId}
                            </span>
                        </div>
                    </div>
                    <div className="card-body long-text">
                        {files[i].filename}
                        {expiry}
                    </div>
                    {canProlong && this.state.prolongFor === fileId && this.prolongPanel(fileId, file)}
                </div>
            )
        }

        var filesCol = null
        var colWidth = 4
        if (savedFiles.length > 0) {
            colWidth = 8
            filesCol = (
                <div className="col-sm">
                    <h6 className="text-center">Uploaded files</h6>
                    <div className="saved-files overflow-auto">
                        {savedFiles}
                    </div>
                </div>
            )
        }

        let contentInput
        if (this.state.type === 'file') {
            contentInput = (
                <div className="col-sm-9 mb-3">
                    <input className="form-control form-control-sm" id="content" type="file"
                           ref="file" onChange={this.handleFile} required autoFocus/>
                </div>
            )
        } else if (this.state.type === 'image') {
            contentInput = (
                <div className="col-sm-9 mb-3">
                    <input className="form-control form-control-sm" id="image-content" type="file"
                           ref="image" accept="image/*" onChange={this.handleFile} required autoFocus/>
                </div>
            )
        } else {
            contentInput = (
                <div className="col-sm-9">
                    <textarea className="form-control" id="text" ref="text" rows="2" minLength="3"
                              maxLength={gdprshare.config.contentMaxLength} required/>
                </div>
            )
        }

        return (
            <div className={'container-fluid col-sm-' + colWidth}>
                <div className={this.outerClasses()}>
                    <h4 className="text-center">File upload</h4>
                    <div className="row">
                        <div className="col-sm" onDragEnter={this.handleDragOn}>
                            <div className={this.dndClasses()} onDrop={this.handleDrop} onDragEnter={this.handleDragOn}
                                 onDragOver={this.handleDragOn} onDragLeave={this.handleDragOff}
                                 onDragEnd={this.handleDragOff}>
                                <Octicon size="large" icon={CloudUpload}/>
                                <h3>
                                    drop file here
                                </h3>
                            </div>
                            <form ref="form" className={this.innerClasses()} onSubmit={this.handleUpload}>
                                <div className="mb-3 row">
                                    <label htmlFor="type" className="col-sm-3 col-form-label col-form-label-sm">
                                        Type
                                    </label>
                                    <div className="col-sm-9 mb-1">
                                        <select className="form-select form-select-sm" id="type"
                                                value={this.state.type} onChange={this.handleTypeChange}>
                                            <option value="file">File</option>
                                            <option value="text">Text</option>
                                            <option value="image">Image</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="mb-3 row">
                                    <label className="col-sm-3 col-form-label col-form-label-sm">
                                        Content
                                    </label>
                                    {contentInput}
                                </div>

                                <div>
                                    <div className="mb-3 row">
                                        <label htmlFor="email" className="col-sm-3 col-form-label col-form-label-sm">
                                            Notification
                                        </label>
                                        <div className="col-sm-9">
                                            <input className="form-control form-control-sm" id="email" type="email"
                                                   ref="email" placeholder="Enter email (optional)" maxLength="255"
                                                   aria-describedby="emailHelp"
                                                   defaultValue={window.localStorage.getItem('email')} minLength="6"
                                            />
                                            <small id="emailHelp" className="form-text text-muted">Email to receive
                                                download notifications</small>
                                        </div>
                                    </div>

                                    <div className="mb-3 row">
                                        <label htmlFor="count" className="col-sm-3 col-form-label col-form-label-sm">
                                            Count
                                        </label>
                                        <div className="col-sm-9">
                                            <input className="form-control form-control-sm" id="count" type="number"
                                                   ref="count" min="1" max="15" defaultValue="1" required
                                                   aria-describedby="countHelp"/>
                                            <small id="countHelp" className="form-text text-muted">Maximum downloads
                                                before link expires</small>
                                        </div>
                                    </div>

                                    <div className="mb-3 row">
                                        <label htmlFor="expiry" className="col-sm-3 col-form-label col-form-label-sm">
                                            Expiry
                                        </label>
                                        <div className="col-sm-9">
                                            <input className="form-control form-control-sm" id="expiry" type="number"
                                                   ref="expiry" min="1" max="14" defaultValue="7" required
                                                   aria-describedby="expiryHelp"/>
                                            <small id="expiryHelp" className="form-text text-muted">Maximum days before
                                                link expires</small>
                                        </div>
                                    </div>

                                    <div className="mb-3 row">
                                        <label htmlFor="geo-restriction" className="col-sm-3 col-form-label col-form-label-sm">
                                            Region
                                        </label>
                                        <div className="col-sm-9">
                                            <select className="form-select form-select-sm" id="geo-restriction"
                                                    value={this.state.geoRestriction}
                                                    onChange={this.handleGeoRestrictionChange}>
                                                <option value="none">No restriction</option>
                                                <option value="eea">EU/EEA</option>
                                                <option value="gdpr-aligned">EU/EEA + GDPR-aligned</option>
                                                <option value="custom">Custom</option>
                                            </select>
                                        </div>
                                    </div>

                                    {this.state.geoRestriction === 'custom' && (
                                        <div className="mb-3 row">
                                            <label className="col-sm-3 col-form-label col-form-label-sm">
                                                Countries
                                            </label>
                                            <div className="col-sm-9">
                                                <input className="form-control form-control-sm mb-1"
                                                       type="text"
                                                       placeholder="Search countries..."
                                                       value={this.state.countrySearch}
                                                       onChange={this.handleCountrySearch} />
                                                <div className="d-flex gap-1 mb-1">
                                                    <button type="button" className="btn btn-sm btn-outline-secondary"
                                                            onClick={this.handleDeselectAll}>Clear</button>
                                                    <span className="col-form-label-sm ms-auto">
                                                        {this.state.selectedCountries.length} selected
                                                    </span>
                                                </div>
                                                <div className="country-picker">
                                                    {this.state.countryList
                                                        .filter(function (c) {
                                                            if (!this.state.countrySearch) return true
                                                            return c.name.toLowerCase().indexOf(
                                                                this.state.countrySearch.toLowerCase()
                                                            ) !== -1
                                                        }.bind(this))
                                                        .sort(function (a, b) {
                                                            var yours = this.state.yourCountry
                                                            if (a.code === yours) return -1
                                                            if (b.code === yours) return 1
                                                            return 0
                                                        }.bind(this))
                                                        .map(function (c) {
                                                            return (
                                                                <div key={c.code} className="form-check form-check-sm">
                                                                    <input className="form-check-input"
                                                                           type="checkbox"
                                                                           id={'country-' + c.code}
                                                                           checked={this.state.selectedCountries.indexOf(c.code) !== -1}
                                                                           onChange={function () { this.handleCountryToggle(c.code) }.bind(this)} />
                                                                    <label htmlFor={'country-' + c.code}
                                                                           className="form-check-label col-form-label-sm">
                                                                        {c.name}
                                                                    </label>
                                                                </div>
                                                            )
                                                        }.bind(this))
                                                    }
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="mb-3 row">
                                        <label htmlFor="delay" className="col-sm-3 col-form-label col-form-label-sm">
                                            Delay
                                        </label>
                                        <div className="col-sm-9">
                                            <select className="form-select form-select-sm" id="delay"
                                                    value={this.state.delay}
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
                                        </div>
                                    </div>

                                    {this.state.type === 'file' && (
                                        <div className="mb-3 row">
                                            <label htmlFor="strip" className="col-sm-3 col-form-label col-form-label-sm">
                                                Metadata
                                            </label>
                                            <div className="col-sm-9">
                                                <div className="form-check">
                                                    <input className="form-check-input" type="checkbox" id="strip"
                                                           checked={this.state.strip}
                                                           onChange={this.handleStripChange}
                                                           aria-describedby="stripHelp"/>
                                                    <label className="form-check-label col-form-label-sm" htmlFor="strip">
                                                        Strip metadata
                                                    </label>
                                                </div>
                                                <small id="stripHelp" className="form-text text-muted">Removes EXIF, GPS
                                                    and PDF metadata before upload</small>
                                            </div>
                                        </div>
                                    )}

                                    {this.state.type === 'image' && (
                                        <div className="mb-3 row">
                                            <label htmlFor="ephemeral" className="col-sm-3 col-form-label col-form-label-sm">
                                                Disappear
                                            </label>
                                            <div className="col-sm-9">
                                                <select className="form-select form-select-sm" id="ephemeral"
                                                        value={this.state.ephemeral}
                                                        onChange={this.handleEphemeralChange}>
                                                    <option value="0">No</option>
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

                                <div className="text-center col-sm-12">
                                    <input type="submit" ref="submit" className="btn btn-primary" value="Upload"
                                           disabled={this.state.geoRestriction !== 'none' && this.state.selectedCountries.length === 0}/>
                                </div>
                            </form>

                            <br/>
                            <Alert error={this.state.error}/>
                        </div>
                        {filesCol}
                        <Tooltip id="copy-tip" openOnClick={false} render={() => this.state.copy} delayHide={1000}/>
                        <Tooltip id="delete-tip" variant="info" place="bottom" content="Delete file" />
                        <Tooltip id="prolong-tip" variant="info" place="bottom" content="Prolong file" />
                    </div>
                </div>
            </div>
        )
    }
}

export default withRouter(Upload)
