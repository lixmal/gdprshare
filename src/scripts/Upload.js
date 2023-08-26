import React from 'react'
import Classnames from 'classnames'
import Octicon, { Clippy, Trashcan, CloudUpload, Key } from '@primer/octicons-react'
import BsCustomFileInput from 'bs-custom-file-input'
import Alert from './Alert'
import ReactTooltip from 'react-tooltip'

export default class Upload extends React.Component {
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
        this.handleTypeToggle = this.handleTypeToggle.bind(this)
        this.uploadFile = this.uploadFile.bind(this)
        this.updateValidity = this.updateValidity.bind(this)
        this.checkOnlyEEA = this.checkOnlyEEA.bind(this)

        this.state = {
            error: null,
            mask: false,
            copy: null,
            fileInfo: null,
            type: 'file',
            onlyEEAChecked: true,
        }
    }

    componentDidMount() {
        BsCustomFileInput.init()

        this.updateValidity()
    }

    async updateValidity() {
        try {
            var files = JSON.parse(window.localStorage.getItem('savedFiles'))
        }
        catch (e) {
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
            error = 'fetching file validity failed: ' + fetchData.message
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
        formData.append('only-eea', this.refs['only-eea'].checked)
        formData.append('include-other', this.refs['include-other'].checked)

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
        }
        catch (e) {
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
            }

            try {
                window.localStorage.setItem('savedFiles', JSON.stringify(files))
            }
            catch (e) {
                console.log(e)
            }
        }

        this.props.history.push(
            'uploaded',
            {
                location: loc,
                // unencrypted filename
                filename: plainFilename,
                key: b64Key,
                count: this.refs.count.value,
            }
        )
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

        this.refs.file.files = files
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
            file = new File([text], text.slice(0, 21) + '.txt', { type: 'text/plain' })
        }
        else {
            file = this.refs.file.files[0]
        }

        try {
            // encryption of filename
            const cipherText = await gdprshare.encrypt(new TextEncoder().encode(file.name), key)

            var filename = Buffer.from(cipherText).toString('base64')

            var reader = new FileReader()
            reader.onload = async function (event) {
                // encryption of file
                const cipherText = await gdprshare.encrypt(event.target.result, key)

                this.uploadFile(key, cipherText, filename, file.name)
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
        }
        catch (e) {
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
        }
        else {
            try {
                fetchData = await response.clone().json()
                gdprshare.displayErr.call(this, fetchData.message)
            } catch (error) {
                gdprshare.asTextErr.call(this, response, error)
            }
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
            this.refs.file.value = null
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

    handleTypeToggle(event) {
        var cb = event.currentTarget
        this.setState({
            type: cb.checked ? 'text' : 'file'
        })
    }

    checkOnlyEEA(event) {
        var cb = event.currentTarget
        this.setState({
            onlyEEAChecked: cb.checked
        })
    }

    render() {
        var savedFiles = []
        var files = {}

        try {
            files = JSON.parse(window.localStorage.getItem('savedFiles'))
        }
        catch (e) {
            console.log(e)
        }

        for (var i in files) {
            let expiry
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
            }
            else {
                let expiryDate = new Date(file.expiryDate)
                // go's time.Time zero value
                let isInitDate = expiryDate.getTime() == new Date('0001-01-01T00:00:00Z').getTime()
                let isExpired = isInitDate || file.count < 1 || Date.now() > expiryDate

                let text
                let classes
                if (isExpired) {
                    classes = 'expiry expiry-expired'
                    text = '<expired>'
                }
                else {
                    classes = 'expiry'
                    let expires = isInitDate ? '<no data>' : expiryDate.toLocaleString()
                    let s = file.count > 1 ? 's' : ''
                    text = `${file.count} DL${s} or ${expires}`
                }
                expiry = (
                    <span className={classes}>
                        {text}
                    </span>
                )
            }

            savedFiles.push(
                <div className="card" key={files[i].fileId}>
                    <div className="card-header">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <button id="copy" className="btn btn-sm" onClick={this.copyHandler} type="button" data-for="copy-tip" data-tip>
                                    <Octicon icon={Clippy} />
                                </button>
                                <button id="delete" className="btn btn-sm" onClick={this.handleDelete} type="button" data-tip data-for="delete-tip">
                                    <Octicon icon={Trashcan} />
                                </button>
                            </div>
                            <span className="card-header-text long-text">
                                {files[i].fileId}
                            </span>
                        </div>
                    </div>
                    <div className="card-body long-text">
                        {files[i].filename}
                        {expiry}
                    </div>
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
                <div className="col-sm-9">
                    <div className="custom-file">
                        <input className="custom-file-input form-control form-control-sm" id="content" type="file" ref="file" onChange={this.handleFile} required autoFocus />
                        <label className="custom-file-label col-form-label col-form-label-sm" htmlFor="file">
                            Select or drop file
                        </label>
                    </div>
                </div>
            )
        }
        else {
            contentInput = (
                <div className="col-sm-9">
                    <textarea className="form-control" id="text" ref="text" rows="2" minLength="3" maxLength={gdprshare.config.contentMaxLength} required />
                </div>
            )
        }

        return (
            <div className={'container-fluid col-sm-' + colWidth}>
                <div className={this.outerClasses()}>
                    <h4 className="text-center">File upload</h4>
                    <div className="row">
                        <div className="col-sm" onDragEnter={this.handleDragOn}>
                            <div className={this.dndClasses()} onDrop={this.handleDrop} onDragEnter={this.handleDragOn} onDragOver={this.handleDragOn} onDragLeave={this.handleDragOff} onDragEnd={this.handleDragOff}>
                                <Octicon size="large" icon={CloudUpload} />
                                <h3>
                                    drop file here
                                </h3>
                            </div>
                            <form ref="form" className={this.innerClasses()} onSubmit={this.handleUpload}>
                                <div className="form-group row">
                                    <label className="col-sm-3 col-form-label col-form-label-sm toggle">
                                        <input type="checkbox" id="type" ref="type" onChange={this.handleTypeToggle} />
                                        <span className="slider"></span>
                                        <span className="labels" data-on="File" data-off="Text"></span>
                                    </label>
                                    {contentInput}
                                </div>

                                <div>
                                    <div className="form-group row">
                                        <label htmlFor="email" className="col-sm-3 col-form-label col-form-label-sm">
                                            Notification
                                        </label>
                                        <div className="col-sm-9">
                                            <input className="form-control form-control-sm" id="email" type="email" ref="email" placeholder="Enter email (optional)" maxLength="255" aria-describedby="emailHelp"
                                                defaultValue={window.localStorage.getItem('email')} minLength="6"
                                            />
                                            <small id="emailHelp" className="form-text text-muted">Email to receive download notifications</small>
                                        </div>
                                    </div>

                                    <div className="form-group row">
                                        <label htmlFor="count" className="col-sm-3 col-form-label col-form-label-sm">
                                            Count
                                        </label>
                                        <div className="col-sm-9">
                                            <input className="form-control form-control-sm" id="count" type="number" ref="count" min="1" max="15" defaultValue="1" required aria-describedby="countHelp" />
                                            <small id="countHelp" className="form-text text-muted">Maximum downloads before link expires</small>
                                        </div>
                                    </div>

                                    <div className="form-group row">
                                        <label htmlFor="expiry" className="col-sm-3 col-form-label col-form-label-sm">
                                            Expiry
                                        </label>
                                        <div className="col-sm-9">
                                            <input className="form-control form-control-sm" id="expiry" type="number" ref="expiry" min="1" max="14" defaultValue="7" required aria-describedby="expiryHelp" />
                                            <small id="expiryHelp" className="form-text text-muted">Maximum days before link expires</small>
                                        </div>
                                    </div>

                                    <div className="row justify-content-center">
                                        <div className="form-group form-check form-check-inline" data-tip data-for="only-eea-tip">
                                            <input className="form-check-input" id="only-eea" type="checkbox" ref="only-eea" defaultChecked={this.state.onlyEEAChecked} onChange={this.checkOnlyEEA}/>
                                            <label htmlFor="only-eea" className="form-check-label col-form-label-sm">
                                                Only EU/EEA
                                            </label>
                                        </div>
                                        <ReactTooltip id="only-eea-tip" variant="info" place="bottom">
                                            Allows downloads only from EEA countries (European Union + Iceland/Norway/Liechtenstein)
                                        </ReactTooltip>

                                        <div className="form-group form-check form-check-inline" data-tip data-for="include-other-tip">
                                            <input className="form-check-input" id="include-other" type="checkbox" ref="include-other" disabled={!this.state.onlyEEAChecked}/>
                                            <label htmlFor="include-other" className="form-check-label col-form-label-sm">
                                                Include other
                                            </label>
                                        </div>
                                        <ReactTooltip id="include-other-tip" place="bottom">
                                            Allows downloads from EEA countries and additionally from countries with similar GDPR laws. <br/>
                                            Currently: Switzerland, UK, Monaco, Andorra, San Marino, Vatican City
                                        </ReactTooltip>
                                    </div>
                                </div>

                                <div className="text-center col-sm-12">
                                    <input type="submit" ref="submit" className="btn btn-primary" value="Upload" />
                                </div>
                            </form>

                            <br />
                            <Alert error={this.state.error} />
                        </div>
                        {filesCol}
                        <ReactTooltip id="copy-tip" event="none" getContent={this.handleTipContent} delayHide={1000} />
                        <ReactTooltip id="delete-tip" variant="info" place="bottom">
                            Delete file
                        </ReactTooltip>
                    </div>
                </div>
            </div>
        )
    }
}
