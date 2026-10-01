const { ExchangeRate } = require('../models');
const { CurrencyConversionError, ValidationError } = require('../lib/errors');

/**
 * Milliseconds per hour, used for cache age calculations.
 */
const MS_PER_HOUR = 3600000;

/**
 * Timeout in milliseconds for external live FX HTTP requests.
 */
const FX_REQUEST_TIMEOUT_MS = 6000;

/**
 * Standard fallback rates against USD in case provider is unavailable
 * and no cached rates exist in the database (e.g. cold start offline).
 */
const FALLBACK_RATES_FROM_USD = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.5,
  CAD: 1.36,
  AUD: 1.52,
  JPY: 155.0,
  CHF: 0.9,
};

/**
 * Fetches live FX rates from the public ExchangeRate-API endpoint.
 * Free, keyless, and highly available.
 * 
 * @param {string} baseCurrency - 3-letter currency code (e.g. 'USD')
 * @param {Function} [fetchFn] - Optional fetch function for testing
 * @returns {Promise<{ baseCurrency: string, rates: Record<string, number>, fetchedAt: Date, source: string }>}
 */
async function fetchLiveExchangeRates(baseCurrency, fetchFn = globalThis.fetch) {
  const normalizedBase = baseCurrency.toUpperCase();
  const url = `https://open.er-api.com/v6/latest/${normalizedBase}`;

  if (!fetchFn) {
    throw new CurrencyConversionError('No fetch implementation available in current environment');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FX_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) {
      throw new CurrencyConversionError(`FX Provider returned status ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (data.result !== 'success' || !data.rates) {
      throw new CurrencyConversionError(
        `FX Provider returned unexpected payload: ${JSON.stringify(data).slice(0, 100)}`
      );
    }

    return {
      baseCurrency: normalizedBase,
      rates: data.rates,
      fetchedAt: new Date(data.time_last_update_unix ? data.time_last_update_unix * 1000 : Date.now()),
      source: 'open.er-api.com',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retrieves exchange rates for a base currency.
 * Caches in MongoDB, refreshes at most once every `ttlHours` (default 24h).
 * Falls back to stale cached rates or built-in fallback table if the API is down.
 * 
 * @param {string} baseCurrency - Base currency code (e.g. 'USD')
 * @param {Object} [options]
 * @param {number} [options.ttlHours=24] - Maximum cache age before attempting refresh
 * @param {boolean} [options.forceRefresh=false] - Force live API fetch
 * @param {Function} [options.customFetch] - Optional mock fetch for testing
 * @returns {Promise<{ baseCurrency: string, rates: Object, fetchedAt: Date, isStale: boolean, source: string }>}
 */
async function getExchangeRates(baseCurrency, options = {}) {
  const normalizedBase = baseCurrency.toUpperCase();
  const ttlHours = options.ttlHours ?? 24;
  const forceRefresh = options.forceRefresh ?? false;
  const customFetch = options.customFetch;

  // 1. Check MongoDB for existing cached document
  let cachedDoc = null;
  try {
    cachedDoc = await ExchangeRate.findOne({ baseCurrency: normalizedBase }).sort({ fetchedAt: -1 });
  } catch (err) {
    // If DB query fails, proceed to live fetch
  }

  const now = Date.now();
  const cacheAgeHours = cachedDoc ? (now - cachedDoc.fetchedAt.getTime()) / MS_PER_HOUR : Infinity;

  // 2. Return cache if fresh and not forced
  if (cachedDoc && cacheAgeHours < ttlHours && !forceRefresh) {
    const ratesObj = cachedDoc.rates instanceof Map
      ? Object.fromEntries(cachedDoc.rates)
      : cachedDoc.rates;

    return {
      baseCurrency: normalizedBase,
      rates: ratesObj,
      fetchedAt: cachedDoc.fetchedAt,
      isStale: false,
      source: 'cache',
    };
  }

  // 3. Cache is missing, expired, or forceRefresh requested: Try live fetch
  try {
    const liveData = await fetchLiveExchangeRates(normalizedBase, customFetch);

    // Save fresh rates to MongoDB
    try {
      await ExchangeRate.create({
        baseCurrency: normalizedBase,
        rates: liveData.rates,
        source: liveData.source,
        fetchedAt: liveData.fetchedAt,
        ttlHours,
      });
    } catch (saveErr) {
      // Non-fatal: if caching fails (e.g. read-only DB), return live rates
    }

    return {
      baseCurrency: normalizedBase,
      rates: liveData.rates,
      fetchedAt: liveData.fetchedAt,
      isStale: false,
      source: 'live',
    };
  } catch (liveErr) {
    // 4. Live fetch failed: Fallback to stale cached document
    if (cachedDoc) {
      const ratesObj = cachedDoc.rates instanceof Map
        ? Object.fromEntries(cachedDoc.rates)
        : cachedDoc.rates;

      return {
        baseCurrency: normalizedBase,
        rates: ratesObj,
        fetchedAt: cachedDoc.fetchedAt,
        isStale: true,
        staleReason: `FX live provider unreachable (${liveErr.message}). Using last cached rate from ${cachedDoc.fetchedAt.toISOString()}`,
        source: 'stale-cache',
      };
    }

    // 5. No cache available at all: Fallback to built-in baseline table
    let fallbackRates = FALLBACK_RATES_FROM_USD;
    if (normalizedBase !== 'USD' && FALLBACK_RATES_FROM_USD[normalizedBase]) {
      // Cross-convert fallback table to requested base currency: (USD / TargetBase)
      const usdPerTargetBase = 1 / FALLBACK_RATES_FROM_USD[normalizedBase];
      fallbackRates = {};
      for (const [curr, usdRate] of Object.entries(FALLBACK_RATES_FROM_USD)) {
        fallbackRates[curr] = Number((usdRate * usdPerTargetBase).toFixed(6));
      }
    }

    return {
      baseCurrency: normalizedBase,
      rates: fallbackRates,
      fetchedAt: new Date(0), // Epoch represents built-in static fallback
      isStale: true,
      staleReason: `FX live provider unreachable (${liveErr.message}) and no cache exists. Using static baseline fallback.`,
      source: 'builtin-fallback',
    };
  }
}

/**
 * Converts an amount from one currency to another in exact integer cents.
 * 
 * Formula:
 * convertedCents = Math.round(amountCents * rate)
 * 
 * Never loses precision to floats. Preserves audit information including
 * exchangeRate, isStale flag, and rate timestamp.
 * 
 * @param {Object} params
 * @param {number} params.amountCents - Amount in smallest integer currency unit (cents/paise)
 * @param {string} params.fromCurrency - Source currency code (e.g. 'EUR')
 * @param {string} params.toCurrency - Destination currency code (e.g. 'USD')
 * @param {Object} [params.options] - Options passed to getExchangeRates (ttlHours, customFetch)
 * @returns {Promise<{ convertedCents: number, rate: number, isStale: boolean, fxTimestamp: Date, source: string }>}
 */
async function convertAmount({
  amountCents,
  fromCurrency,
  toCurrency,
  options = {},
}) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ValidationError(`amountCents must be a strictly positive integer, got ${amountCents}`);
  }

  const from = fromCurrency.toUpperCase().trim();
  const to = toCurrency.toUpperCase().trim();

  // Same currency: 1.0 rate, zero conversion drift
  if (from === to) {
    return {
      convertedCents: amountCents,
      rate: 1.0,
      isStale: false,
      fxTimestamp: new Date(),
      source: 'identity',
    };
  }

  // Fetch exchange rates based on source currency
  const fxData = await getExchangeRates(from, options);
  let rate = fxData.rates[to];

  // If rate not found in fromCurrency's rates, try cross-converting via USD
  if (rate == null) {
    const usdRates = await getExchangeRates('USD', options);
    const fromToUsd = usdRates.rates[from] ? 1 / usdRates.rates[from] : null;
    const toFromUsd = usdRates.rates[to];

    if (fromToUsd != null && toFromUsd != null) {
      rate = fromToUsd * toFromUsd;
    } else {
      throw new CurrencyConversionError(`Unsupported currency conversion: ${from} -> ${to}`);
    }
  }

  // Integer cents conversion: round to nearest integer
  const convertedCents = Math.round(amountCents * rate);

  return {
    convertedCents,
    rate,
    isStale: fxData.isStale,
    staleReason: fxData.staleReason,
    fxTimestamp: fxData.fetchedAt,
    source: fxData.source,
  };
}

module.exports = {
  getExchangeRates,
  convertAmount,
  fetchLiveExchangeRates,
};
