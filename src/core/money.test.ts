import { describe, expect, it } from 'vitest';
import { Money, convert, formatMoney, sumMoney } from './money';

describe('Money', () => {
  it('uses decimal arithmetic instead of floating point', () => {
    expect(Money.of('0.1').add('0.2').toString()).toBe('0.3');
    expect(Money.of('9999999999.99').add('0.01').toString()).toBe('10000000000');
  });

  it('supports subtraction, multiplication and comparison', () => {
    expect(Money.of('100.50').sub('30.25').toFixed(2)).toBe('70.25');
    expect(Money.of('25000').mul('1.075').toString()).toBe('26875');
    expect(Money.of('10').isGreaterThan('9.999')).toBe(true);
  });

  it('converts using an explicit rate and rounds half-up', () => {
    expect(convert('100', '280.25').toString()).toBe('28025');
    expect(Money.of('1.005').round(2).toFixed(2)).toBe('1.01');
    expect(Money.of('-1.005').round(2).toFixed(2)).toBe('-1.01');
  });

  it('rejects division by zero and invalid creation', () => {
    expect(() => Money.of('5').div('0')).toThrow();
    expect(() => Money.of('abc')).toThrow();
  });

  it('sums and formats without mixing currencies', () => {
    expect(sumMoney(['100', '250.75', '0.25']).toFixed(2)).toBe('351.00');
    expect(formatMoney('1234.5', 'PKR', false)).toContain('1,234.50');
  });
});
