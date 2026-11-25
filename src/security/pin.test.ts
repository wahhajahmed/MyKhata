import { describe, expect, it } from 'vitest';
import { constantTimeEqual, createPinVerifier, deriveKeyMaterial, validatePin, verifyPinVerifier } from './pin';

describe('PIN policy', () => {
  it('rejects predictable PINs and weak passwords', () => {
    for (const value of ['1234', '0000', '111111', '', 'abc', 'password', 'abcdefgh']) {
      expect(validatePin(value)).not.toBeNull();
    }
  });

  it('accepts a non-common numeric PIN or a strong password', () => {
    expect(validatePin('4729')).toBeNull();
    expect(validatePin('Khat@2026')).toBeNull();
  });
});

describe('PIN verifier', () => {
  it('verifies the correct PIN and rejects an incorrect one', async () => {
    const verifier = await createPinVerifier('4729');
    expect(verifier.version).toBe(1);
    expect(verifier.iterations).toBe(310000);
    expect(await verifyPinVerifier('4729', verifier)).toBe(true);
    expect(await verifyPinVerifier('4730', verifier)).toBe(false);
  });

  it('rejects verifiers from an unsupported version or iteration count', async () => {
    const verifier = await createPinVerifier('Khat@2026');
    expect(await verifyPinVerifier('Khat@2026', { ...verifier, version: 2 as 1 })).toBe(false);
    expect(await verifyPinVerifier('Khat@2026', { ...verifier, iterations: 1000 as 310000 })).toBe(false);
  });

  it('derives stable key material and uses constant-time comparison', async () => {
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const first = await deriveKeyMaterial('4729', salt);
    const second = await deriveKeyMaterial('4729', salt);
    expect(first).toHaveLength(32);
    expect(constantTimeEqual(first, second)).toBe(true);
    expect(constantTimeEqual(first, new Uint8Array(32))).toBe(false);
    expect(constantTimeEqual(first, new Uint8Array(31))).toBe(false);
  });
});
