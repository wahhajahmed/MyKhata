// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { unlock, unlockWithBiometric } = vi.hoisted(() => ({
  unlock: vi.fn(),
  unlockWithBiometric: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: () => ({
    securityState: {
      platform: 'electron', supported: true, configured: true, unlocked: false,
      biometricsAvailable: true, biometricsEnabled: true,
    },
    unlock: (pin: string) => unlock(pin),
    unlockWithBiometric: () => unlockWithBiometric(),
  }),
}));

import LockScreen from './LockScreen';

describe('LockScreen', () => {
  beforeEach(() => {
    unlock.mockReset();
    unlockWithBiometric.mockReset();
  });

  it('submits the entered PIN', async () => {
    unlock.mockResolvedValue(true);
    render(<LockScreen />);
    fireEvent.change(screen.getByLabelText('PIN or password'), { target: { value: '4729' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(unlock).toHaveBeenCalledWith('4729'));
  });

  it('reports an incorrect PIN without unlocking', async () => {
    unlock.mockResolvedValue(false);
    render(<LockScreen />);
    fireEvent.change(screen.getByLabelText('PIN or password'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect PIN');
  });

  it('offers biometric unlock on supported devices', async () => {
    unlockWithBiometric.mockResolvedValue(true);
    render(<LockScreen />);
    fireEvent.click(screen.getByRole('button', { name: /biometrics/i }));
    await waitFor(() => expect(unlockWithBiometric).toHaveBeenCalledOnce());
  });
});
