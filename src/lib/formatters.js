/**
 * SettleUp - Shared Formatting Utilities
 * 
 * Centralizes currency and date formatting across UI components
 * to guarantee visual and mathematical consistency.
 */

const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  CAD: 'C$',
  JPY: '¥',
  AUD: 'A$',
  CHF: 'CHF ',
};

/**
 * Formats integer cents into standard localized currency string.
 * Example: 1050 cents in 'USD' -> "$10.50"
 * 
 * @param {number} cents - Integer amount in cents
 * @param {string} [currency='USD'] - 3-letter currency code
 * @returns {string}
 */
export function formatCents(cents, currency = 'USD') {
  const normCurrency = (currency || 'USD').toUpperCase();
  const symbol = CURRENCY_SYMBOLS[normCurrency] || `${normCurrency} `;
  const absValue = (Math.abs(cents || 0) / 100).toFixed(2);
  return `${symbol}${absValue}`;
}

/**
 * Formats integer cents with an explicit '+' or '-' sign for net positions.
 * Example: 1050 -> "+$10.50", -1050 -> "-$10.50", 0 -> "$0.00"
 * 
 * @param {number} cents
 * @param {string} [currency='USD']
 * @returns {string}
 */
export function formatSignedCents(cents, currency = 'USD') {
  if (!cents || cents === 0) {
    return formatCents(0, currency);
  }
  const formatted = formatCents(cents, currency);
  return cents > 0 ? `+${formatted}` : `-${formatted}`;
}

/**
 * Formats a Date or ISO string into a concise, readable timestamp for ledgers.
 * Example: "Sep 25, 10:14 PM"
 * 
 * @param {Date|string} dateInput
 * @returns {string}
 */
export function formatLedgerTimestamp(dateInput) {
  if (!dateInput) return '—';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '—';

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
