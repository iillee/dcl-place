/**
 * pngEncoder.ts \u2014 minimal pure-TypeScript PNG encoder.
 *
 * Produces an uncompressed (deflate "stored" blocks + zlib wrapper) PNG
 * suitable for embedding in a `data:image/png;base64,...` URL. No native
 * deps, no compression math \u2014 works inside the QuickJS sandbox that
 * Decentraland scenes run in.
 *
 * Trade-off: images are larger than a real deflate-compressed PNG, but for
 * a small canvas (a few hundred pixels per side) the total data URL stays
 * comfortably under browser limits (\u22482 MB).
 */


// MARK: crc32Table
const CRC32_TABLE = (() => {
	const t = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) {
			c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
		}
		t[n] = c >>> 0
	}
	return t
})()


// MARK: crc32
function crc32(bytes: Uint8Array, start: number, end: number): number {
	let c = 0xFFFFFFFF
	for (let i = start; i < end; i++) {
		c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
	}
	return (c ^ 0xFFFFFFFF) >>> 0
}


// MARK: adler32
function adler32(bytes: Uint8Array, start: number, end: number): number {
	let a = 1, b = 0
	for (let i = start; i < end; i++) {
		a = (a + bytes[i]) % 65521
		b = (b + a) % 65521
	}
	return ((b << 16) | a) >>> 0
}


// MARK: writeUint32BE
function writeUint32BE(buf: Uint8Array, off: number, v: number): void {
	buf[off]     = (v >>> 24) & 0xFF
	buf[off + 1] = (v >>> 16) & 0xFF
	buf[off + 2] = (v >>> 8)  & 0xFF
	buf[off + 3] =  v         & 0xFF
}


// MARK: encodePngRgb
/**
 * Encode raw RGB pixels (row-major, top-to-bottom) into an uncompressed
 * PNG byte stream.
 *
 * @param width   image width in pixels
 * @param height  image height in pixels
 * @param rgb     width * height * 3 bytes; each pixel = R, G, B
 * @returns       PNG file bytes (signature + IHDR + IDAT + IEND)
 */
export function encodePngRgb(width: number, height: number, rgb: Uint8Array): Uint8Array {
	if (rgb.length !== width * height * 3) {
		throw new Error(`pngEncoder: encodePngRgb: expected ${width * height * 3} bytes, got ${rgb.length}`)
	}

	// PNG scanlines: 1 filter byte (0 = None) + width*3 pixel bytes.
	const scanlineLen = 1 + width * 3
	const rawLen      = scanlineLen * height
	const raw         = new Uint8Array(rawLen)
	let   rIn         = 0
	let   rOut        = 0
	for (let y = 0; y < height; y++) {
		raw[rOut++] = 0 // filter: None
		for (let x = 0; x < width; x++) {
			raw[rOut++] = rgb[rIn++]
			raw[rOut++] = rgb[rIn++]
			raw[rOut++] = rgb[rIn++]
		}
	}

	// zlib wrapper: 2-byte header + deflate payload + 4-byte adler32.
	// Deflate payload: N stored blocks (each \u2264 65535 bytes) = 5-byte header
	// per block + block bytes. Last block sets the BFINAL bit.
	const MAX_BLOCK = 0xFFFF
	const blockCount = Math.max(1, Math.ceil(rawLen / MAX_BLOCK))
	const deflateLen = rawLen + 5 * blockCount
	const zlibLen    = 2 + deflateLen + 4
	const zlib       = new Uint8Array(zlibLen)
	let   zOut       = 0
	// zlib header: CMF=0x78 (deflate, 32K window), FLG=0x01 (no dict, level 0, FCHECK)
	zlib[zOut++] = 0x78
	zlib[zOut++] = 0x01
	for (let b = 0; b < blockCount; b++) {
		const off  = b * MAX_BLOCK
		const size = Math.min(MAX_BLOCK, rawLen - off)
		const last = (b === blockCount - 1) ? 1 : 0
		zlib[zOut++] =  last                       // BFINAL, BTYPE=00 (stored)
		zlib[zOut++] =  size        & 0xFF        // LEN lo
		zlib[zOut++] = (size >>> 8) & 0xFF        // LEN hi
		zlib[zOut++] = (~size)      & 0xFF        // NLEN lo
		zlib[zOut++] = ((~size) >>> 8) & 0xFF     // NLEN hi
		zlib.set(raw.subarray(off, off + size), zOut)
		zOut += size
	}
	const ad = adler32(raw, 0, rawLen)
	writeUint32BE(zlib, zOut, ad)

	// Assemble the PNG file: signature + IHDR + IDAT + IEND.
	// IHDR data (13 bytes): width, height, bit depth (8), color type (2=RGB),
	//   compression (0), filter (0), interlace (0).
	const SIGNATURE_LEN = 8
	const CHUNK_OVERHEAD = 12 // length(4) + type(4) + crc(4)
	const png = new Uint8Array(
		SIGNATURE_LEN
		+ CHUNK_OVERHEAD + 13         // IHDR
		+ CHUNK_OVERHEAD + zlibLen    // IDAT
		+ CHUNK_OVERHEAD              // IEND
	)
	let pOff = 0

	// Signature
	png.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], pOff); pOff += 8

	// IHDR
	writeUint32BE(png, pOff, 13); pOff += 4
	png.set([0x49, 0x48, 0x44, 0x52], pOff); pOff += 4 // "IHDR"
	writeUint32BE(png, pOff, width);  pOff += 4
	writeUint32BE(png, pOff, height); pOff += 4
	png[pOff++] = 8   // bit depth
	png[pOff++] = 2   // color type: RGB
	png[pOff++] = 0   // compression: deflate
	png[pOff++] = 0   // filter: default
	png[pOff++] = 0   // interlace: none
	writeUint32BE(png, pOff, crc32(png, pOff - 17, pOff)); pOff += 4

	// IDAT
	writeUint32BE(png, pOff, zlibLen); pOff += 4
	png.set([0x49, 0x44, 0x41, 0x54], pOff); pOff += 4 // "IDAT"
	png.set(zlib, pOff); pOff += zlibLen
	writeUint32BE(png, pOff, crc32(png, pOff - (4 + zlibLen), pOff)); pOff += 4

	// IEND
	writeUint32BE(png, pOff, 0); pOff += 4
	png.set([0x49, 0x45, 0x4E, 0x44], pOff); pOff += 4 // "IEND"
	writeUint32BE(png, pOff, crc32(png, pOff - 4, pOff)); pOff += 4

	return png
}


// MARK: bytesToBase64
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Encode a byte buffer as a standard base64 string (no line breaks). */
export function bytesToBase64(bytes: Uint8Array): string {
	let out = ''
	const len = bytes.length
	let i = 0
	while (i + 3 <= len) {
		const b0 = bytes[i++], b1 = bytes[i++], b2 = bytes[i++]
		out += B64_ALPHABET[b0 >>> 2]
		out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >>> 4)]
		out += B64_ALPHABET[((b1 & 0x0F) << 2) | (b2 >>> 6)]
		out += B64_ALPHABET[b2 & 0x3F]
	}
	const rem = len - i
	if (rem === 1) {
		const b0 = bytes[i]
		out += B64_ALPHABET[b0 >>> 2]
		out += B64_ALPHABET[(b0 & 0x03) << 4]
		out += '=='
	} else if (rem === 2) {
		const b0 = bytes[i], b1 = bytes[i + 1]
		out += B64_ALPHABET[b0 >>> 2]
		out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >>> 4)]
		out += B64_ALPHABET[(b1 & 0x0F) << 2]
		out += '='
	}
	return out
}
