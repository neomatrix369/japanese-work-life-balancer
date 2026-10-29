// MOCK: fixed indicative FX rates (not live market data)
// 1 USD = 150 JPY, 1 GBP = 195 JPY
export type Currency = 'JPY' | 'USD' | 'GBP';

export const FX_RATES: Record<Currency, number> = {
  JPY: 1,
  USD: 1 / 150,
  GBP: 1 / 195,
};

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  JPY: '¥',
  USD: '$',
  GBP: '£',
};

/** Convert a JPY integer amount to the target currency, rounded to 2 decimal places */
export function convertFromJPY(amountJPY: number, currency: Currency): number {
  return Math.round(amountJPY * FX_RATES[currency] * 100) / 100;
}

/** Format a JPY amount in the target currency with the currency symbol */
export function formatMoney(amountJPY: number, currency: Currency): string {
  const converted = convertFromJPY(amountJPY, currency);
  const sym = CURRENCY_SYMBOLS[currency];
  if (currency === 'JPY') {
    return `${sym}${Math.round(converted).toLocaleString()}`;
  }
  return `${sym}${converted.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export const INDICATIVE_LABEL = 'indicative rates (MOCK)';
