/**
 * @module
 * @internal
 */
import { receiveFeatureReport } from './receiveFeatureReport'
import { firmwareFeatureReportId } from './consts'
import { parseFirmwareInfo, type DualShock4FirmwareInfo } from './parseFirmwareInfo'
import { bluetoothInputReportId } from '../protocol/consts'

const featureReportTimeoutMs = 1000
const cloneCheckTimeoutMs = 250
const originalControllerFeatureReportId = 0x81

function hasBluetoothInputReport (collections: readonly HIDCollectionInfo[]): boolean {
  return collections.some(collection =>
    collection.inputReports?.some(report => report.reportId === bluetoothInputReportId) ||
    hasBluetoothInputReport(collection.children ?? []))
}

/** Reads metadata without mutating a controller or session. */
export async function readControllerFirmware (device: HIDDevice, signal?: AbortSignal): Promise<{
  firmwareInfo: DualShock4FirmwareInfo | null
  isClone: boolean | null
}> {
  // Report 0x81 is USB-only. The descriptor identifies Bluetooth even before
  // the first input report arrives; an unavailable probe is not a clone result.
  let isClone: boolean | null = hasBluetoothInputReport(device.collections) ? null : true
  try {
    const report = await receiveFeatureReport(device, firmwareFeatureReportId, { timeoutMs: featureReportTimeoutMs, signal })
    const firmwareInfo = parseFirmwareInfo(report)
    if (firmwareInfo && isClone !== null) {
      try {
        await receiveFeatureReport(device, originalControllerFeatureReportId, { timeoutMs: cloneCheckTimeoutMs, signal })
        isClone = false
      } catch {
        isClone = true
      }
    }
    return { firmwareInfo, isClone }
  } catch {
    return { firmwareInfo: null, isClone }
  }
}
