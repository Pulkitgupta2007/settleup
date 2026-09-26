const mongoose = require('mongoose');

const payerItemSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Payer user ID is required'],
    },
    amountCents: {
      type: Number,
      required: [true, 'Payer amount in cents is required'],
      validate: {
        validator: function (val) {
          return Number.isInteger(val) && val > 0;
        },
        message: 'Payer amount must be a strictly positive integer in cents',
      },
    },
  },
  { _id: false }
);

const splitItemSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Split participant user ID is required'],
    },
    amount: {
      type: Number,
      required: [true, 'Split amount is required'],
      validate: {
        validator: Number.isInteger,
        message: 'Split amount must be an integer in cents',
      },
      min: [0, 'Split amount cannot be negative'],
    },
  },
  { _id: false }
);

const expenseSchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      required: [true, 'Expense must belong to a group'],
      index: true,
    },
    description: {
      type: String,
      required: [true, 'Expense description is required'],
      trim: true,
      minlength: [1, 'Expense description cannot be empty'],
    },
    paidBy: {
      type: [payerItemSchema],
      required: [true, 'At least one payer is required in paidBy'],
      set: function (val) {
        if (!val) return val;
        if (!Array.isArray(val)) {
          // Backward compatibility: normalize single payer to array of { user, amountCents }
          if (val instanceof mongoose.Types.ObjectId || typeof val === 'string') {
            return [{ user: val, amountCents: this ? this.totalAmount : undefined }];
          }
          if (typeof val === 'object' && val.user) {
            return [{ user: val.user, amountCents: val.amountCents || (this ? this.totalAmount : undefined) }];
          }
        }
        return val;
      },
      validate: {
        validator: function (payers) {
          if (!Array.isArray(payers) || payers.length === 0) return false;
          // Exact conservation: sum of paidBy amounts must equal totalAmount exactly
          const sum = payers.reduce((acc, curr) => acc + (curr.amountCents || 0), 0);
          return sum === this.totalAmount;
        },
        message: 'Sum of paidBy amounts must exactly match totalAmount in cents',
      },
    },
    totalAmount: {
      type: Number,
      required: [true, 'Total expense amount is required'],
      validate: {
        validator: function (val) {
          return Number.isInteger(val) && val > 0;
        },
        message: 'Total amount must be a strictly positive integer in cents',
      },
    },
    currency: {
      type: String,
      required: [true, 'Currency is required'],
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
    },
    splitType: {
      type: String,
      enum: ['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES'],
      default: 'EQUAL',
    },
    splits: {
      type: [splitItemSchema],
      required: true,
      validate: {
        validator: function (splits) {
          if (!Array.isArray(splits) || splits.length === 0) return false;
          // Exact penny conservation: sum of split shares must equal totalAmount exactly
          const sum = splits.reduce((acc, curr) => acc + curr.amount, 0);
          return sum === this.totalAmount;
        },
        message: 'Sum of splits must exactly match totalAmount in cents (no penny lost/gained)',
      },
    },
  },
  {
    timestamps: true,
  }
);

// Pre-validate hook: ensure single-payer shorthand inherits totalAmount if totalAmount was set afterwards
expenseSchema.pre('validate', function () {
  if (
    Array.isArray(this.paidBy) &&
    this.paidBy.length === 1 &&
    this.paidBy[0].amountCents == null &&
    this.totalAmount != null
  ) {
    this.paidBy[0].amountCents = this.totalAmount;
  }
});

// Compound index for listing group expenses in reverse chronological order
expenseSchema.index({ group: 1, createdAt: -1 });
expenseSchema.index({ 'paidBy.user': 1 });

const Expense = mongoose.models.Expense || mongoose.model('Expense', expenseSchema);
module.exports = Expense;

