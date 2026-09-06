/**
 * @module
 * @internal
 */
import { receiveFeatureReport } from './receiveFeatureReport'
import { firmwareFeatureReportId } from './consts'
import { parseFirmwareInfo, type DualShock4FirmwareInfo } from './parseFirmwareInfo'

const featureReportTimeoutMs = 1000
const cloneCheckTimeoutMs = 250
const originalControllerFeatureReportId = 0x81

/** Reads metadata without mutating a controller or session. */
export async function readControllerFirmware (device: HIDDevice, signal?: AbortSignal): Promise<{
  firmwareInfo: DualShock4FirmwareInfo | null
  isClone: boolean
}> {
  try {
    const report = await receiveFeatureReport(device, firmwareFeatureReportId, { timeoutMs: featureReportTimeoutMs, signal })
    const firmwareInfo = parseFirmwareInfo(report)
    let isClone = true
    if (firmwareInfo) {
      try {
        await receiveFeatureReport(device, originalControllerFeatureReportId, { timeoutMs: cloneCheckTimeoutMs, signal })
        isClone = false
      } catch {
        isClone = true
      }
    }
    return { firmwareInfo, isClone }
  } catch {
    return { firmwareInfo: null, isClone: true }
  }
}
