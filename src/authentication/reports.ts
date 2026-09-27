/**
 * @module
 * @internal
 */
import { bluetoothInputReportId } from '../protocol/consts'
import { crc32 } from '../utils/crc32'

export const challengeReportId = 0xF0
export const responseReportId = 0xF1
export const statusReportId = 0xF2
export const pageLength = 56

function collections (items: readonly HIDCollectionInfo[]): HIDCollectionInfo[] {
  return items.flatMap(item => [item, ...collections(item.children ?? [])])
}

export function authenticationTransport (device: HIDDevice): { supported: boolean, bluetooth: boolean } {
  const all = collections(device.collections)
  return {
    supported: [challengeReportId, responseReportId, statusReportId].every(id =>
      all.some(item => item.featureReports?.some(report => report.reportId === id))),
    bluetooth: all.some(item => item.inputReports?.some(report => report.reportId === bluetoothInputReportId))
  }
}

function checksum (report: Uint8Array, bluetooth: boolean, sending: boolean): number {
  // Bluetooth HIDP SET_REPORT / DATA headers participate in the feature CRC.
  // https://www.psdevwiki.com/ps4/DS4-BT#HID_features_reports
  return crc32(bluetooth ? Uint8Array.from([sending ? 0x53 : 0xA3, ...report]) : report)
}

export function challengePage (challenge: Uint8Array, sequence: number, page: number, bluetooth: boolean): Uint8Array<ArrayBuffer> {
  const report = new Uint8Array(64)
  report[0] = challengeReportId
  report[1] = sequence
  report[2] = page
  report.set(challenge.subarray(page * pageLength, (page + 1) * pageLength), 4)
  new DataView(report.buffer).setUint32(60, checksum(report.subarray(0, 60), bluetooth, true), true)
  // WebHID supplies the report ID separately, unlike hidapi.
  return report.subarray(1)
}

/** Normalize WebHID/hidapi sizes and reject corrupt packets before RSA checks. */
export function authenticationReport (data: DataView, reportId: number, bluetooth: boolean): Uint8Array<ArrayBuffer> {
  const length = reportId === statusReportId ? 16 : 64
  let report: Uint8Array<ArrayBuffer>
  if (data.byteLength === length - 1) {
    report = Uint8Array.from([reportId, ...new Uint8Array(data.buffer, data.byteOffset, data.byteLength)])
  } else if (data.getUint8(0) === reportId && (
    data.byteLength === length ||
    (reportId === statusReportId && data.byteLength === 64 &&
      new Uint8Array(data.buffer, data.byteOffset + length, 64 - length).every(byte => byte === 0))
  )) {
    report = new Uint8Array(data.buffer, data.byteOffset, length).slice()
  } else {
    throw new Error('Invalid authentication report length or ID.')
  }
  const expected = new DataView(report.buffer).getUint32(length - 4, true)
  if (checksum(report.subarray(0, -4), bluetooth, false) !== expected) throw new Error('Invalid authentication CRC.')
  return report
}
