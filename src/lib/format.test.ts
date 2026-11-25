import { describe, expect, it } from 'vitest';
import { fmt, getDefaultCurrency, setDefaultCurrency } from './format';

describe('currency formatting', () => {
  it('uses the configured base currency when no currency is supplied', () => {
    const previous = getDefaultCurrency();
    try {
      setDefaultCurrency('USD');
      expect(fmt('1234.5')).toBe('$1,234.50 USD');
    } finally {
      setDefaultCurrency(previous);
    }
  });

  it('honours an explicit currency over the configured default', () => {
    const previous = getDefaultCurrency();
    try {
      setDefaultCurrency('USD');
      expect(fmt('100', 'PKR')).toBe('₨100.00 PKR');
    } finally {
      setDefaultCurrency(previous);
    }
  });
});
