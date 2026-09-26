const mongoose = require('mongoose');

const exchangeRateSchema = new mongoose.Schema(
  {
    baseCurrency: {
      type: String,
      required: [true, 'Base currency is required'],
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
    },
    rates: {
      type: Map,
      of: Number,
      required: [true, 'Exchange rates map is required'],
    },
    source: {
      type: String,
      default: 'open.er-api.com',
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    ttlHours: {
      type: Number,
      default: 24,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to quickly find the latest exchange rates for any base currency
exchangeRateSchema.index({ baseCurrency: 1, fetchedAt: -1 });

const ExchangeRate = mongoose.models.ExchangeRate || mongoose.model('ExchangeRate', exchangeRateSchema);
module.exports = ExchangeRate;
