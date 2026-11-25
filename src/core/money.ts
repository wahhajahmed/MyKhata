import Big from 'big.js';

export type MoneyInput = string | number | Big | Money;

/** Immutable decimal money value. All amounts are stored as decimal strings. */
export class Money {
  private readonly value: Big;

  private constructor(value: Big) {
    this.value = value;
  }

  static of(input: MoneyInput): Money {
    if (input instanceof Money) return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('Money cannot be created from a non-finite number');
      return new Money(new Big(input.toString()));
    }
    return new Money(new Big(input.toString()));
  }

  static zero(): Money {
    return new Money(new Big(0));
  }

  add(other: MoneyInput): Money {
    return new Money(this.value.plus(Money.of(other).value));
  }

  sub(other: MoneyInput): Money {
    return new Money(this.value.minus(Money.of(other).value));
  }

  mul(other: MoneyInput): Money {
    return new Money(this.value.times(Money.of(other).value));
  }

  div(other: MoneyInput): Money {
    const divisor = Money.of(other).value;
    if (divisor.eq(0)) throw new Error('Division by zero is not allowed');
    return new Money(this.value.div(divisor));
  }

  abs(): Money {
    return new Money(this.value.abs());
  }

  negate(): Money {
    return new Money(this.value.times(-1));
  }

  isZero(): boolean {
    return this.value.eq(0);
  }

  isPositive(): boolean {
    return this.value.gt(0);
  }

  isNegative(): boolean {
    return this.value.lt(0);
  }

  isGreaterThan(other: MoneyInput): boolean {
    return this.value.gt(Money.of(other).value);
  }

  isLessThan(other: MoneyInput): boolean {
    return this.value.lt(Money.of(other).value);
  }

  greaterOrEqual(other: MoneyInput): boolean {
    return this.value.gte(Money.of(other).value);
  }

  equals(other: MoneyInput): boolean {
    return this.value.eq(Money.of(other).value);
  }

  /** Rounds to the currency's minor units using half-up semantics. */
  round(minorUnits = 2): Money {
    return new Money(this.value.round(minorUnits, Big.roundHalfUp));
  }

  toString(): string {
    return this.value.toFixed();
  }

  toFixed(minorUnits?: number): string {
    return this.value.toFixed(minorUnits);
  }

  toNumber(): number {
    return Number(this.value.toString());
  }

  toJSON(): string {
    return this.toString();
  }
}

export const ZERO = Money.zero();

export function sumMoney(values: MoneyInput[]): Money {
  return values.reduce<Money>((acc, v) => acc.add(v), Money.zero());
}

export function convert(amount: MoneyInput, rate: MoneyInput): Money {
  return Money.of(amount).mul(rate).round(6);
}

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  minorUnits: number;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  PKR: { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', minorUnits: 2 },
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2 },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', minorUnits: 2 },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', minorUnits: 2 },
  AED: { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', minorUnits: 2 },
  SAR: { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', minorUnits: 2 },
};

export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES[code] ?? { code, name: code, symbol: code, minorUnits: 2 };
}

export function formatMoney(amount: MoneyInput, code: string, withCode = true): string {
  const value = Money.of(amount).round(currencyInfo(code).minorUnits);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: currencyInfo(code).minorUnits,
    maximumFractionDigits: currencyInfo(code).minorUnits,
  }).format(value.toNumber());
  return withCode ? `${currencyInfo(code).symbol}${formatted} ${code}` : `${currencyInfo(code).symbol}${formatted}`;
}
