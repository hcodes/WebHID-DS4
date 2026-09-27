/**
 * @module
 * @internal
 */
import { receiveFeatureReport } from './receiveFeatureReport'
import { firmwareFeatureReportId } from './consts'
import { parseFirmwareInfo, type DualShock4FirmwareInfo } from './parseFirmwareInfo'

const featureReportTimeoutMs = 1000

/** Reads metadata without mutating a controller or session. */
export async function readControllerFirmware (device: HIDDevice, signal?: AbortSignal): Promise<DualShock4FirmwareInfo | null> {
  try {
    const report = await receiveFeatureReport(device, firmwareFeatureReportId, { timeoutMs: featureReportTimeoutMs, signal })
    return parseFirmwareInfo(report)
  } catch {
    return null
  }
}
