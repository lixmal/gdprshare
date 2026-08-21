/**
 * Metadata stripping tests
 * The image path needs a real canvas, so it is covered by the e2e suite instead.
 */

import * as PDFLib from 'pdf-lib'
import { PDFDocument, PDFName } from 'pdf-lib'
import { stripMetadata, stripPdfMetadata, stripGifMetadata } from '../strip'

// strip.js pulls pdf-lib from a separate bundle that attaches itself to the
// window, so stand in for that bundle here
beforeAll(() => {
    window.PDFLib = PDFLib
})

async function pdfWithMetadata() {
    const doc = await PDFDocument.create()
    doc.addPage().drawText('page content')
    doc.setTitle('Secret Project Plan')
    doc.setAuthor('Jane Doe')
    doc.setSubject('internal')
    doc.setKeywords(['confidential'])
    doc.setProducer('SomeEditor 1.2')
    doc.setCreator('SomeEditor')

    // XMP packet, the other place identifying data hides
    const xmp = doc.context.stream(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>Jane Doe</dc:creator></x:xmpmeta>',
        { Type: 'Metadata', Subtype: 'XML' },
    )
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp))

    const bytes = await doc.save()
    return new File([bytes], 'plan.pdf', { type: 'application/pdf' })
}

async function textOf(file) {
    return Buffer.from(await file.arrayBuffer()).toString('latin1')
}

describe('stripPdfMetadata', () => {
    test('removes the document info dictionary and the XMP packet', async () => {
        const original = await pdfWithMetadata()
        expect(await textOf(original)).toContain('Jane Doe')

        const raw = await textOf(await stripPdfMetadata(original))

        // no leftover values
        expect(raw).not.toContain('Jane Doe')
        expect(raw).not.toContain('Secret Project Plan')
        expect(raw).not.toContain('SomeEditor')
        expect(raw).not.toContain('confidential')
        expect(raw).not.toContain('internal')
        // no leftover unreferenced XMP object
        expect(raw).not.toContain('xmpmeta')
        // no leftover keys
        expect(raw).not.toContain('/Title')
        expect(raw).not.toContain('/Author')
        expect(raw).not.toContain('/Producer')
        expect(raw).not.toContain('/CreationDate')
        expect(raw).not.toContain('/ModDate')
    })

    test('keeps the document readable and its pages intact', async () => {
        const stripped = await stripPdfMetadata(await pdfWithMetadata())
        // updateMetadata: false, otherwise loading itself stamps a Producer
        const doc = await PDFDocument.load(await stripped.arrayBuffer(), { updateMetadata: false })

        expect(doc.getPageCount()).toBe(1)
        expect(doc.getTitle()).toBeUndefined()
        expect(doc.getAuthor()).toBeUndefined()
        expect(doc.getProducer()).toBeUndefined()
    })

    test('keeps the file name and type', async () => {
        const stripped = await stripPdfMetadata(await pdfWithMetadata())

        expect(stripped.name).toBe('plan.pdf')
        expect(stripped.type).toBe('application/pdf')
    })

    test('rejects a file that is not a readable pdf', async () => {
        const broken = new File(['not a pdf at all'], 'broken.pdf', { type: 'application/pdf' })

        await expect(stripPdfMetadata(broken)).rejects.toThrow()
    })
})

// A two frame 1x1 GIF carrying a comment and an XMP application extension,
// plus the NETSCAPE looping block that makes it animate.
function gifWithMetadata() {
    const text = (s) => Array.from(s).map((c) => c.charCodeAt(0))
    const subBlock = (s) => [s.length].concat(text(s))

    const frame = [
        0x21, 0xf9, 0x04, 0x00, 0x32, 0x00, 0x00, 0x00,     // graphic control, 50/100s delay
        0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image descriptor 1x1
        0x02, 0x02, 0x44, 0x01, 0x00,                        // lzw code size, pixel data
    ]

    const bytes = [].concat(
        text('GIF89a'),
        [0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00],          // logical screen descriptor
        [0x00, 0x00, 0x00, 0xff, 0xff, 0xff],                // global colour table
        [0x21, 0xff], subBlock('NETSCAPE2.0'), [0x03, 0x01, 0x00, 0x00, 0x00], // loop forever
        [0x21, 0xfe], subBlock('Shot by Jane Doe'), [0x00],  // comment extension
        [0x21, 0xff], subBlock('XMP DataXMP'), subBlock('<dc:creator>Jane Doe</dc:creator>'), [0x00],
        frame,
        frame,
        [0x3b],                                              // trailer
    )

    return new File([new Uint8Array(bytes)], 'anim.gif', { type: 'image/gif' })
}

describe('stripGifMetadata', () => {
    test('removes comment and third party application extensions', async () => {
        const original = gifWithMetadata()
        expect(await textOf(original)).toContain('Jane Doe')

        const raw = await textOf(await stripGifMetadata(original))

        expect(raw).not.toContain('Jane Doe')
        expect(raw).not.toContain('Shot by')
        expect(raw).not.toContain('XMP Data')
        expect(raw).not.toContain('dc:creator')
    })

    test('keeps the header, the looping block and every frame byte for byte', async () => {
        const stripped = await stripGifMetadata(gifWithMetadata())
        const bytes = new Uint8Array(await stripped.arrayBuffer())
        const raw = Buffer.from(bytes).toString('latin1')

        expect(raw.startsWith('GIF89a')).toBe(true)
        expect(bytes[bytes.length - 1]).toBe(0x3b)
        // animation survives: the loop block and both frames are still there
        expect(raw).toContain('NETSCAPE2.0')
        expect(raw.split('\x21\xf9\x04\x00\x32').length - 1).toBe(2)
        // pixel data untouched
        expect(raw.split('\x02\x02\x44\x01\x00').length - 1).toBe(2)
    })

    test('leaves a gif without metadata completely unchanged', async () => {
        const clean = await stripGifMetadata(gifWithMetadata())
        const again = await stripGifMetadata(clean)

        expect(new Uint8Array(await again.arrayBuffer()))
            .toEqual(new Uint8Array(await clean.arrayBuffer()))
    })

    test('keeps the file name and type', async () => {
        const stripped = await stripGifMetadata(gifWithMetadata())

        expect(stripped.name).toBe('anim.gif')
        expect(stripped.type).toBe('image/gif')
    })

    test('rejects a truncated gif rather than passing it through', async () => {
        const truncated = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01])],
            'broken.gif', { type: 'image/gif' })

        await expect(stripGifMetadata(truncated)).rejects.toThrow('truncated gif')
    })

    test('rejects a file that is not a gif', async () => {
        const fake = new File(['hello'], 'fake.gif', { type: 'image/gif' })

        await expect(stripGifMetadata(fake)).rejects.toThrow('not a gif')
    })
})

describe('stripMetadata', () => {
    test('rejects unsupported types instead of returning the original file', async () => {
        const doc = new File(['contents'], 'notes.docx', {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })

        await expect(stripMetadata(doc)).rejects.toThrow('not supported')
    })

    test('rejects files the browser gave no type for', async () => {
        await expect(stripMetadata(new File(['x'], 'mystery', { type: '' })))
            .rejects.toThrow('unknown type')
    })

    test('rejects images the canvas cannot re-encode', async () => {
        const svg = new File(['<svg/>'], 'drawing.svg', { type: 'image/svg+xml' })

        await expect(stripMetadata(svg)).rejects.toThrow('upload it as a file instead')
    })

    test('routes gifs to the gif stripper instead of rejecting them', async () => {
        const stripped = await stripMetadata(gifWithMetadata())

        expect(await textOf(stripped)).not.toContain('Jane Doe')
    })

    test('routes pdfs to the pdf stripper', async () => {
        const stripped = await stripMetadata(await pdfWithMetadata())

        expect(await textOf(stripped)).not.toContain('Jane Doe')
    })
})
