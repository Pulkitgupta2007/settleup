const { NextResponse } = require('next/server');
const { connectToDatabase } = require('../../../../../src/lib/db');
const { Group } = require('../../../../../src/models');
const { recordExpense } = require('../../../../../src/services/settlementService');
const { validateObjectId, validateExpenseInput } = require('../../../../../src/lib/validators');
const { NotFoundError, formatErrorResponse } = require('../../../../../src/lib/errors');

/**
 * POST /api/groups/[id]/expenses
 * Records an expense, executes multi-currency conversion to group base currency,
 * and appends double-entry records to the immutable ledger.
 */
async function POST(request, { params }) {
  try {
    await connectToDatabase();
    const { id } = params;

    // 1. Validate Group ID format
    validateObjectId(id, 'groupId');

    // 2. Fetch Group
    const group = await Group.findById(id);
    if (!group) {
      throw new NotFoundError('Group', id);
    }

    // 3. Parse and validate JSON payload
    const rawBody = await request.json().catch(() => null);
    const validated = validateExpenseInput(rawBody, group);

    // 4. Record expense and create double-entry ledger records
    const result = await recordExpense({
      groupId: group._id,
      description: validated.description,
      paidBy: validated.paidBy,
      totalAmount: validated.totalAmount,
      currency: validated.currency,
      splitType: validated.splitType,
      splits: validated.splits,
    });

    const isFxStale = result.ledgerEntries.some(entry => entry.isFxStale);
    const exchangeRate = result.ledgerEntries[0]?.exchangeRate ?? 1.0;

    return NextResponse.json(
      {
        success: true,
        data: {
          expense: result.expense,
          ledgerEntriesCount: result.ledgerEntries.length,
          convertedToBase: validated.currency !== group.baseCurrency,
          baseCurrency: group.baseCurrency,
          exchangeRate,
          isFxStale,
        },
        meta: {
          warning: isFxStale ? 'Exchange rate was retrieved from cached fallback. Live provider was unreachable.' : null,
          timestamp: new Date().toISOString(),
        },
        message: `Expense "${validated.description}" recorded successfully.`,
      },
      { status: 201 }
    );
  } catch (err) {
    const { statusCode, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status: statusCode });
  }
}

module.exports = { POST };
