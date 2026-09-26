const mongoose = require('mongoose');
const { ValidationError, NotFoundError } = require('./errors');

/**
 * Checks if a string is a strictly valid 24-character hexadecimal MongoDB ObjectId.
 * 
 * @param {string} id
 * @returns {boolean}
 */
function isValidObjectId(id) {
  if (typeof id !== 'string') return false;
  return mongoose.Types.ObjectId.isValid(id) && new mongoose.Types.ObjectId(id).toString() === id;
}

/**
 * Asserts that a value is a valid MongoDB ObjectId string.
 * 
 * @param {string} id
 * @param {string} fieldName
 * @throws {ValidationError}
 */
function validateObjectId(id, fieldName = 'id') {
  if (!id) {
    throw new ValidationError(`Field "${fieldName}" is required`);
  }
  if (!isValidObjectId(id)) {
    throw new ValidationError(
      `Field "${fieldName}" must be a valid 24-character hexadecimal MongoDB ObjectId (got "${id}")`
    );
  }
}

/**
 * Validates a 3-letter ISO 4217 currency code.
 * 
 * @param {string} code
 * @param {string} fieldName
 * @throws {ValidationError}
 * @returns {string} normalized uppercase currency code
 */
function validateCurrencyCode(code, fieldName = 'currency') {
  if (!code || typeof code !== 'string') {
    throw new ValidationError(`Field "${fieldName}" is required and must be a string`);
  }
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new ValidationError(
      `Field "${fieldName}" must be a valid 3-letter ISO 4217 currency code (e.g. "USD", "EUR", "INR", got "${code}")`
    );
  }
  return normalized;
}

/**
 * Asserts that an amount is a strictly positive integer in cents.
 * 
 * @param {number} amount
 * @param {string} fieldName
 * @throws {ValidationError}
 */
function validatePositiveIntegerCents(amount, fieldName = 'amount') {
  if (amount == null) {
    throw new ValidationError(`Field "${fieldName}" is required`);
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new ValidationError(`Field "${fieldName}" must be a number`);
  }
  if (!Number.isInteger(amount)) {
    throw new ValidationError(
      `Field "${fieldName}" must be an integer in cents (e.g. 1050 for $10.50, got float ${amount})`
    );
  }
  if (amount <= 0) {
    throw new ValidationError(
      `Field "${fieldName}" must be strictly positive (got ${amount} cents)`
    );
  }
}

/**
 * Comprehensive validation for creating an Expense.
 * 
 * Enforces:
 * 1. Required fields: description, paidBy, totalAmount, currency, splits.
 * 2. Positive integer cents.
 * 3. Valid ISO currency code.
 * 4. Payer must be an active group member.
 * 5. Every split participant must be an active group member.
 * 6. No duplicate participants in splits.
 * 7. Exact conservation of money: sum of all split amounts MUST equal totalAmount exactly.
 * 
 * @param {Object} body
 * @param {Object} group - Populated or loaded Group document
 * @throws {ValidationError}
 * @returns {Object} sanitized payload
 */
function validateExpenseInput(body, group) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object');
  }

  const { description, paidBy, totalAmount, currency, splits, splitType } = body;

  // 1. Description validation
  if (!description || typeof description !== 'string' || description.trim() === '') {
    throw new ValidationError('Expense description is required and cannot be empty');
  }

  // 2. Total amount validation (integer cents)
  validatePositiveIntegerCents(totalAmount, 'totalAmount');

  // 3. Currency validation
  const normalizedCurrency = validateCurrencyCode(currency, 'currency');

  // 4. Group members set for membership verification
  const memberSet = new Set((group.members || []).map(m => m.toString()));

  // 5. Payer validation (supports both multi-payer array and single-payer string/ObjectId)
  let sanitizedPaidBy = [];

  if (Array.isArray(paidBy)) {
    if (paidBy.length === 0) {
      throw new ValidationError('At least one payer is required in paidBy');
    }

    const seenPayers = new Set();
    let payersSum = 0;

    for (let i = 0; i < paidBy.length; i++) {
      const p = paidBy[i];
      if (!p || typeof p !== 'object') {
        throw new ValidationError(`Payer at index ${i} must be an object with "user" and "amountCents"`);
      }

      validateObjectId(p.user, `paidBy[${i}].user`);
      const userIdStr = p.user.toString();
      if (!memberSet.has(userIdStr)) {
        throw new ValidationError(
          `Payer "${userIdStr}" at index ${i} is not a member of group "${group.name}". Only group members can pay for expenses.`
        );
      }

      if (seenPayers.has(userIdStr)) {
        throw new ValidationError(
          `Duplicate payer "${userIdStr}" in paidBy at index ${i}. Each payer can only appear once per expense.`
        );
      }
      seenPayers.add(userIdStr);

      if (p.amountCents == null || typeof p.amountCents !== 'number' || !Number.isInteger(p.amountCents) || p.amountCents <= 0) {
        throw new ValidationError(
          `Payer amount for "${userIdStr}" at index ${i} must be a strictly positive integer in cents (got ${p.amountCents})`
        );
      }

      payersSum += p.amountCents;
      sanitizedPaidBy.push({
        user: userIdStr,
        amountCents: p.amountCents,
      });
    }

    // Conservation check: sum of payer amounts must equal totalAmount exactly
    if (payersSum !== totalAmount) {
      const discrepancy = totalAmount - payersSum;
      throw new ValidationError(
        `Sum of payer amounts (${payersSum} cents) does not match total expense amount (${totalAmount} cents). ` +
        `Discrepancy: ${discrepancy > 0 ? '+' : ''}${discrepancy} cents. All payments must fully fund the expense.`
      );
    }
  } else {
    // Single payer shorthand
    validateObjectId(paidBy, 'paidBy');
    const payerStr = paidBy.toString();
    if (!memberSet.has(payerStr)) {
      throw new ValidationError(
        `Payer "${payerStr}" is not a member of group "${group.name}". Only group members can pay for expenses.`
      );
    }
    sanitizedPaidBy = [
      {
        user: payerStr,
        amountCents: totalAmount,
      },
    ];
  }

  // 6. Splits validation
  if (!Array.isArray(splits) || splits.length === 0) {
    throw new ValidationError('Splits array is required and must contain at least one participant');
  }

  const seenParticipants = new Set();
  let splitsSum = 0;
  const sanitizedSplits = [];

  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    if (!s || typeof s !== 'object') {
      throw new ValidationError(`Split at index ${i} must be an object with "user" and "amount"`);
    }

    validateObjectId(s.user, `splits[${i}].user`);
    if (!memberSet.has(s.user)) {
      throw new ValidationError(
        `Split participant "${s.user}" at index ${i} is not a member of group "${group.name}"`
      );
    }

    if (seenParticipants.has(s.user)) {
      throw new ValidationError(
        `Duplicate participant "${s.user}" in splits at index ${i}. Each member can only appear once per expense.`
      );
    }
    seenParticipants.add(s.user);

    if (s.amount == null || typeof s.amount !== 'number' || !Number.isInteger(s.amount)) {
      throw new ValidationError(
        `Split amount for participant "${s.user}" at index ${i} must be an integer in cents (got ${s.amount})`
      );
    }
    if (s.amount < 0) {
      throw new ValidationError(
        `Split amount for participant "${s.user}" at index ${i} cannot be negative (got ${s.amount})`
      );
    }

    splitsSum += s.amount;
    sanitizedSplits.push({
      user: s.user,
      amount: s.amount,
    });
  }

  // 7. Penny conservation check
  if (splitsSum !== totalAmount) {
    const discrepancy = totalAmount - splitsSum;
    throw new ValidationError(
      `Sum of split amounts (${splitsSum} cents) does not match total expense amount (${totalAmount} cents). ` +
      `Discrepancy: ${discrepancy > 0 ? '+' : ''}${discrepancy} cents. Money cannot be created or dropped.`
    );
  }

  const validSplitTypes = ['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES'];
  const sanitizedSplitType = splitType && validSplitTypes.includes(splitType.toUpperCase())
    ? splitType.toUpperCase()
    : 'EQUAL';

  return {
    description: description.trim(),
    paidBy: sanitizedPaidBy,
    totalAmount,
    currency: normalizedCurrency,
    splitType: sanitizedSplitType,
    splits: sanitizedSplits,
  };
}

/**
 * Validates group creation payload.
 * 
 * @param {Object} body
 * @throws {ValidationError}
 * @returns {Object} sanitized payload
 */
function validateGroupInput(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object');
  }

  const { name, description = '', baseCurrency = 'USD', members = [], constraints = [] } = body;

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    throw new ValidationError('Group name is required and must be at least 2 characters');
  }

  const normalizedBase = validateCurrencyCode(baseCurrency, 'baseCurrency');

  if (!Array.isArray(members) || members.length < 1) {
    throw new ValidationError('Group must have at least one member');
  }

  const sanitizedMembers = [];
  const memberSet = new Set();
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    validateObjectId(m, `members[${i}]`);
    if (memberSet.has(m)) {
      throw new ValidationError(`Duplicate member ID "${m}" in members list`);
    }
    memberSet.add(m);
    sanitizedMembers.push(m);
  }

  const sanitizedConstraints = [];
  if (Array.isArray(constraints)) {
    for (let i = 0; i < constraints.length; i++) {
      const c = constraints[i];
      if (!c || !Array.isArray(c.avoid) || c.avoid.length !== 2) {
        throw new ValidationError(`Constraint at index ${i} must have an "avoid" array with exactly 2 user IDs`);
      }
      const [u1, u2] = c.avoid;
      validateObjectId(u1, `constraints[${i}].avoid[0]`);
      validateObjectId(u2, `constraints[${i}].avoid[1]`);

      if (u1 === u2) {
        throw new ValidationError(`Constraint at index ${i} cannot specify the same user for both sides (${u1})`);
      }
      if (!memberSet.has(u1) || !memberSet.has(u2)) {
        throw new ValidationError(`Constraint at index ${i} references users who are not group members`);
      }
      sanitizedConstraints.push({ avoid: [u1, u2] });
    }
  }

  return {
    name: name.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    baseCurrency: normalizedBase,
    members: sanitizedMembers,
    constraints: sanitizedConstraints,
  };
}

module.exports = {
  isValidObjectId,
  validateObjectId,
  validateCurrencyCode,
  validatePositiveIntegerCents,
  validateExpenseInput,
  validateGroupInput,
};
