/** Calculates an unsigned CRC-32 checksum for binary data. */
export function crc32 (data : Uint8Array) : number {
  let crc = 0xFFFFFFFF

  for (const byte of data) {
    crc ^= byte

    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
    }
  }

  return (crc ^ 0xFFFFFFFF) >>> 0
}
