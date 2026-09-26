const mongoose = require('mongoose');
const crypto = require('crypto');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_INVITE_EXPIRY_DAYS = 7;

function generateInviteCode() {
  return crypto.randomBytes(8).toString('hex');
}

const constraintSchema = new mongoose.Schema(
  {
    avoid: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
      ],
      validate: {
        validator: function (val) {
          return Array.isArray(val) && val.length === 2 && !val[0].equals(val[1]);
        },
        message: 'Constraint must specify exactly 2 distinct users [debtor, creditor]',
      },
    },
  },
  { _id: false }
);

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Group name is required'],
      trim: true,
      minlength: [2, 'Group name must be at least 2 characters'],
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    baseCurrency: {
      type: String,
      required: true,
      default: 'USD',
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
    },
    members: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
      validate: {
        validator: function (members) {
          return Array.isArray(members) && members.length >= 1;
        },
        message: 'A group must have at least one member',
      },
    },
    constraints: {
      type: [constraintSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SETTLING', 'ARCHIVED'],
      default: 'ACTIVE',
    },
    lastSettledAt: {
      type: Date,
      default: null,
    },
    inviteCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: generateInviteCode,
    },
    inviteCodeExpiresAt: {
      type: Date,
      default: () => new Date(Date.now() + DEFAULT_INVITE_EXPIRY_DAYS * MS_PER_DAY),
    },
  },
  {
    timestamps: true,
  }
);

// Pre-validate hook: ensure inviteCode and expiry are generated
groupSchema.pre('validate', function () {
  if (!this.inviteCode) {
    this.inviteCode = generateInviteCode();
  }
  if (!this.inviteCodeExpiresAt) {
    this.inviteCodeExpiresAt = new Date(Date.now() + DEFAULT_INVITE_EXPIRY_DAYS * MS_PER_DAY);
  }
});

// Method to regenerate a new invite code and reset expiration (invalidating previous link)
groupSchema.methods.regenerateInviteCode = function (expiryDays = DEFAULT_INVITE_EXPIRY_DAYS) {
  this.inviteCode = generateInviteCode();
  this.inviteCodeExpiresAt = expiryDays
    ? new Date(Date.now() + expiryDays * MS_PER_DAY)
    : null;
  return this.inviteCode;
};

// Index for quickly looking up groups a user belongs to
groupSchema.index({ members: 1 });

const Group = mongoose.models.Group || mongoose.model('Group', groupSchema);
module.exports = Group;
