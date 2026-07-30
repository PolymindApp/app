import { Capacitor, registerPlugin } from '@capacitor/core'

interface PasskeyPlugin {
  isAvailable(): Promise<{ available: boolean }>
  createCredential(options: { requestJson: string }): Promise<{ responseJson: string }>
  getCredential(options: { requestJson: string }): Promise<{ responseJson: string }>
}

type PasskeyCredential = Record<string, unknown>

const nativePasskey = registerPlugin<PasskeyPlugin>('Passkey')

export class PasskeyCancelledError extends Error {
  constructor() {
    super('The biometric request was cancelled.')
    this.name = 'PasskeyCancelledError'
  }
}

export async function isAndroidPasskeyAvailable() {
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isNativePlatform()) return false
  try {
    return (await nativePasskey.isAvailable()).available
  } catch {
    return false
  }
}

export async function createAndroidPasskey(requestJson: string) {
  return invokePasskey(() => nativePasskey.createCredential({ requestJson }))
}

export async function getAndroidPasskey(requestJson: string) {
  return invokePasskey(() => nativePasskey.getCredential({ requestJson }))
}

async function invokePasskey(
  operation: () => Promise<{ responseJson: string }>,
): Promise<PasskeyCredential> {
  try {
    const result = await operation()
    const credential = JSON.parse(result.responseJson)
    if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
      throw new Error('Android returned an invalid biometric sign-in response.')
    }
    return credential as PasskeyCredential
  } catch (cause) {
    if (
      cause
      && typeof cause === 'object'
      && 'code' in cause
      && cause.code === 'PASSKEY_CANCELLED'
    ) {
      throw new PasskeyCancelledError()
    }
    throw cause
  }
}
