/** Read only the first TIFF IFD orientation; never follow EXIF pointers or allocate from metadata. */
export function jpegOrientation(bytes: Buffer): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1
    const marker = bytes[offset + 1]
    if (marker === 0xff) {
      offset++
      continue
    }
    if (marker === 0xda || marker === 0xd9) return 1
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2
      continue
    }
    const length = bytes.readUInt16BE(offset + 2)
    const end = offset + 2 + length
    if (length < 2 || end > bytes.length) return 1
    if (marker === 0xe1 && bytes.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
      const tiff = offset + 10
      if (tiff + 8 > end) return 1
      const order = bytes.toString('latin1', tiff, tiff + 2)
      if (order !== 'II' && order !== 'MM') return 1
      const u16 = (at: number): number => (order === 'II' ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at))
      const u32 = (at: number): number => (order === 'II' ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at))
      if (u16(tiff + 2) !== 42) return 1
      const ifd = tiff + u32(tiff + 4)
      if (ifd < tiff + 8 || ifd + 2 > end) return 1
      const count = u16(ifd)
      if (ifd + 2 + count * 12 > end) return 1
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12
        if (u16(entry) === 0x112) {
          if (u16(entry + 2) !== 3 || u32(entry + 4) !== 1) return 1
          const orientation = u16(entry + 8)
          return orientation >= 1 && orientation <= 8 ? orientation : 1
        }
      }
      return 1
    }
    offset = end
  }
  return 1
}
