// pdf-lib lives in a separate bundle, fetched only when a pdf is actually
// stripped. See the build:pdflib script.
const pdfLibUrl = '/assets/scripts/pdf-lib.js'

var pdfLibLoad = null

export function loadPdfLib() {
    if (window.PDFLib)
        return Promise.resolve(window.PDFLib)

    if (!pdfLibLoad)
        pdfLibLoad = new Promise(function (resolve, reject) {
            var script = document.createElement('script')
            script.src = pdfLibUrl
            script.onload = function () {
                if (window.PDFLib) {
                    resolve(window.PDFLib)
                    return
                }
                // let a later attempt retry instead of caching the failure
                pdfLibLoad = null
                reject(new Error('pdf support did not initialise'))
            }
            script.onerror = function () {
                pdfLibLoad = null
                reject(new Error('pdf support could not be loaded'))
            }
            document.head.appendChild(script)
        })

    return pdfLibLoad
}

// Image formats the canvas can re-encode without destroying the content.
// Animated formats are excluded: a canvas only captures the first frame.
const reencodableImages = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/bmp',
    'image/heic',
    'image/heif',
    'image/tiff',
    'image/avif',
]

// Everything stripMetadata() can handle. A format it cannot handle is refused
// rather than uploaded with its metadata still in it.
const strippableTypes = ['application/pdf', 'image/gif'].concat(reencodableImages)

// The image subset, in the form a file input's accept attribute wants.
export const strippableImageTypes = ['image/gif'].concat(reencodableImages)

export function canStrip(file) {
    return !!file && strippableTypes.indexOf(file.type) !== -1
}

// Entries of the document information dictionary that carry identifying data.
const infoKeys = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate']

function replaceExtension(name, mimeType) {
    const extensions = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/webp': '.webp',
    }
    const extension = extensions[mimeType]
    if (!extension)
        return name

    if (name.toLowerCase().endsWith(extension))
        return name

    const dot = name.lastIndexOf('.')
    if (dot < 1)
        return name + extension

    return name.slice(0, dot) + extension
}

// Re-draws the image onto a canvas and re-encodes it, so only pixel data
// survives: EXIF, GPS, XMP and ICC data are dropped along the way.
export function stripImageMetadata(file) {
    if (reencodableImages.indexOf(file.type) === -1)
        return Promise.reject(new Error('cannot strip metadata from ' + (file.type || 'unknown type') +
            ' without destroying the image, upload it as a file instead'))

    return new Promise(function (resolve, reject) {
        var img = new Image()
        var url = (window.URL || window.webkitURL).createObjectURL(file)

        img.onload = function () {
            (window.URL || window.webkitURL).revokeObjectURL(url)

            var canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight

            var ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0)

            // formats the canvas cannot emit are re-encoded as JPEG
            var mimeType = file.type
            if (mimeType !== 'image/png' && mimeType !== 'image/webp')
                mimeType = 'image/jpeg'
            var quality = mimeType === 'image/jpeg' ? 0.92 : undefined

            canvas.toBlob(function (blob) {
                if (!blob) {
                    reject(new Error('re-encoding the image failed'))
                    return
                }
                resolve(new File([blob], replaceExtension(file.name, mimeType), { type: mimeType }))
            }, mimeType, quality)
        }

        img.onerror = function () {
            (window.URL || window.webkitURL).revokeObjectURL(url)
            reject(new Error('image could not be decoded'))
        }

        img.src = url
    })
}

// GIF block labels, see the GIF89a spec, section 15 onwards.
const gifExtensionIntroducer = 0x21
const gifImageDescriptor = 0x2c
const gifTrailer = 0x3b
const gifGraphicControlLabel = 0xf9
const gifApplicationLabel = 0xff

// Application extensions that drive playback rather than describe the file.
// Everything else under that label is third party data such as XMP packets or
// editor watermarks, and gets dropped.
const gifPlaybackExtensions = ['NETSCAPE2.0', 'ANIMEXTS1.0']

// Walks the chain of length-prefixed sub-blocks and returns the offset just
// past its terminator.
function gifSkipSubBlocks(bytes, pos) {
    for (;;) {
        if (pos >= bytes.length)
            throw new Error('truncated gif')

        const size = bytes[pos]
        pos += 1
        if (size === 0)
            return pos

        pos += size
    }
}

function gifSubBlockText(bytes, pos, length) {
    var text = ''
    for (var i = 0; i < length && pos + i < bytes.length; i++)
        text += String.fromCharCode(bytes[pos + i])

    return text
}

// A canvas would flatten an animation to its first frame, so GIFs are edited in
// place instead: comment, plain text and third party application extensions are
// cut out and every other block is copied through byte for byte. Frames, timing
// and pixel data come out unchanged.
export async function stripGifMetadata(file) {
    const bytes = new Uint8Array(await file.arrayBuffer())

    if (gifSubBlockText(bytes, 0, 6).indexOf('GIF8') !== 0)
        throw new Error('not a gif')

    // logical screen descriptor
    if (bytes.length < 13)
        throw new Error('truncated gif')

    var pos = 13
    const screenPacked = bytes[10]
    if (screenPacked & 0x80)
        pos += 3 * (1 << ((screenPacked & 0x07) + 1))

    const kept = []
    var keepFrom = 0

    const drop = function (start, end) {
        if (start > keepFrom)
            kept.push(bytes.subarray(keepFrom, start))
        keepFrom = end
    }

    var stripped = false

    for (;;) {
        if (pos >= bytes.length)
            throw new Error('truncated gif')

        const marker = bytes[pos]

        if (marker === gifTrailer) {
            pos += 1
            break
        }

        if (marker === gifImageDescriptor) {
            if (pos + 10 > bytes.length)
                throw new Error('truncated gif')

            const imagePacked = bytes[pos + 9]
            pos += 10
            if (imagePacked & 0x80)
                pos += 3 * (1 << ((imagePacked & 0x07) + 1))

            // LZW minimum code size, then the compressed pixel data
            pos = gifSkipSubBlocks(bytes, pos + 1)
            continue
        }

        if (marker !== gifExtensionIntroducer)
            throw new Error('unexpected block in gif at offset ' + pos)

        if (pos + 2 > bytes.length)
            throw new Error('truncated gif')

        const start = pos
        const label = bytes[pos + 1]
        var keep = label === gifGraphicControlLabel

        if (label === gifApplicationLabel) {
            // the first sub-block holds an 8 byte identifier and a 3 byte
            // authentication code
            const identifier = gifSubBlockText(bytes, pos + 3, bytes[pos + 2])
            keep = gifPlaybackExtensions.indexOf(identifier) !== -1
        }

        pos = gifSkipSubBlocks(bytes, pos + 2)

        if (!keep) {
            drop(start, pos)
            stripped = true
        }
    }

    if (!stripped)
        // nothing to cut, hand back the bytes as they are
        return new File([bytes], file.name, { type: 'image/gif' })

    kept.push(bytes.subarray(keepFrom, pos))

    return new File(kept, file.name, { type: 'image/gif' })
}

// Removes an entry from a dictionary along with the object it points at.
// Unsetting the entry alone is not enough: the object stays registered in the
// context and gets written out again on save, unreferenced but readable.
function dropEntry(PDFName, PDFRef, context, dict, key) {
    const name = PDFName.of(key)
    const value = dict.get(name)
    dict.delete(name)
    if (value instanceof PDFRef)
        context.delete(value)
}

// Drops the document information dictionary and the XMP metadata streams.
// Metadata inside images embedded in the PDF is not touched.
export async function stripPdfMetadata(file) {
    const { PDFDocument, PDFName, PDFRef } = await loadPdfLib()

    const bytes = await file.arrayBuffer()

    // updateMetadata: false keeps pdf-lib from writing its own Producer and ModDate on save
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })

    const infoRef = doc.context.trailerInfo.Info
    if (infoRef) {
        const info = doc.context.lookup(infoRef)
        if (info)
            infoKeys.forEach(function (key) {
                info.delete(PDFName.of(key))
            })
    }

    dropEntry(PDFName, PDFRef, doc.context, doc.catalog, 'Metadata')

    doc.getPages().forEach(function (page) {
        dropEntry(PDFName, PDFRef, doc.context, page.node, 'Metadata')
        // application-specific data left behind by editors
        dropEntry(PDFName, PDFRef, doc.context, page.node, 'PieceInfo')
    })

    // saving rewrites the file from the object graph, dropping any earlier
    // incremental-update revisions that could still hold the old content
    const stripped = await doc.save({ useObjectStreams: false })

    return new File([stripped], file.name, { type: 'application/pdf' })
}

// Returns a copy of the file without its metadata, or rejects if the format
// is not supported. It never resolves with the original file: a caller asking
// for stripping must not silently get an unstripped file back.
export function stripMetadata(file) {
    if (file.type === 'application/pdf')
        return stripPdfMetadata(file)

    if (file.type === 'image/gif')
        return stripGifMetadata(file)

    if (file.type.indexOf('image/') === 0)
        return stripImageMetadata(file)

    return Promise.reject(new Error('metadata stripping is not supported for ' + (file.type || 'unknown type')))
}
