const COMMON_PINS = new Set([
  '0000', '1111', '1234', '123456', '654321', '112233', '121212',
  '000000', '111111', '222222', '333333', '444444', '555555',
  '666666', '777777', '888888', '999999', '12345678', 'password',
]);

/** Returns a user-facing error, or null when the PIN/password is acceptable. */
export function validatePin(pin: string): string | null {
  const value = pin.trim();
  if (/^\d{4,12}$/.test(value)) {
    if (COMMON_PINS.has(value)) return 'Choose a less predictable PIN';
    if (/^(\d)\1+$/.test(value)) return 'Choose a less predictable PIN';
    return null;
  }
  if (value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value)) {
    return null;
  }
  return 'Use a 4–12 digit PIN or a password of at least 8 characters with letters and numbers';
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** WebCrypto PBKDF2 helper shared by native/web lock implementations. */
export async function deriveKeyMaterial(secret: string, salt: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure cryptography is unavailable on this platform');
  const material = await subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export interface PinVerifier {
  version: 1;
  salt: string;
  hash: string;
  iterations: 310000;
}

export async function createPinVerifier(pin: string): Promise<PinVerifier> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveKeyMaterial(pin, salt);
  return { version: 1, salt: toBase64(salt), hash: toBase64(hash), iterations: 310000 };
}

export async function verifyPinVerifier(pin: string, verifier: PinVerifier): Promise<boolean> {
  if (verifier.version !== 1 || verifier.iterations !== 310000) return false;
  const expected = fromBase64(verifier.hash);
  const actual = await deriveKeyMaterial(pin, fromBase64(verifier.salt));
  return constantTimeEqual(expected, actual);
}
