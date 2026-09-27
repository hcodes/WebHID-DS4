/**
 * @module
 * @internal
 */
// Sony's Jedi CA public key. Only this pinned authority may certify a controller.
// Source: https://github.com/chrepl/ds4/blob/master/jedi_crypto-mod.py
// SPKI SHA-256: e5e095e643b5688b400c757b4c44efacc2936148e5cebd6c6d410f54f1487f49
const sonyAuthority: JsonWebKey = {
  kty: 'RSA', e: 'AQAB',
  n: 'jtf55KpcxdIxlvDeeX3-rPY-3nvJZxbxPPUq3vjaz6jiM9xlVxc0fUyMgm6rkDYW_5-4-XM2F_vUTsgQeK1uJLBiYZ9aF-4vVXK0J8A0qUk2PobTshM1H4kEpJn4YkAfTmCsITHNS7n939WQyOIrffltAVpBxUnz6g3t_DLOwy1yxTSTSu890StY2zV90E2akxGjgz_4VXoLhbRUzSHauQ1xSuot7ELm9O8gRTz22_OVTnOodpHPoD9HWUVci5bx0Lad091iYulDjcwmls_mS5MMbn1OAVH20bFdGkvi5g8LNhGMYPJT_bziJ6ikyc3yJghYWEq41xxinNQh7GZgWQ'
}
const rsaAlgorithm = { name: 'RSA-PSS', hash: 'SHA-256' }
const signatureAlgorithm = { name: 'RSA-PSS', saltLength: 32 }

function unsignedBase64Url (bytes: Uint8Array): string {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) start++
  return btoa(String.fromCharCode(...bytes.subarray(start)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Verify the Sony certificate first, then proof of possession of its private key. */
export async function verifyAuthenticationResponse (challenge: Uint8Array<ArrayBuffer>, response: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const authority = await crypto.subtle.importKey('jwk', sonyAuthority, rsaAlgorithm, false, ['verify'])
  const identity = response.slice(256, 784)
  if (!await crypto.subtle.verify(signatureAlgorithm, authority, response.slice(784, 1040), identity)) return false
  try {
    const controller = await crypto.subtle.importKey('jwk', {
      kty: 'RSA',
      n: unsignedBase64Url(response.subarray(272, 528)),
      e: unsignedBase64Url(response.subarray(528, 784))
    }, rsaAlgorithm, false, ['verify'])
    return await crypto.subtle.verify(signatureAlgorithm, controller, response.slice(0, 256), challenge)
  } catch (error) {
    // Invalid certified RSA parameters are a failed proof; platform failures
    // propagate so the caller can keep authenticity unknown.
    if (error instanceof DOMException && error.name === 'DataError') return false
    throw error
  }
}
