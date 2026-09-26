const { NextResponse } = require('next/server');
const { connectToDatabase } = require('../../../../../src/lib/db');
const { Group } = require('../../../../../src/models');
const { settleGroup } = require('../../../../../src/services/settlementService');
const { validateObjectId } = require('../../../../../src/lib/validators');
const { NotFoundError, TransactionError, formatErrorResponse } = require('../../../../../src/lib/errors');

/**
 * POST /api/groups/[id]/settle
 * Executes multi-document transactional settlement.
 * Guarantees atomic rollback on any failure.
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

    const rawBody = await request.json().catch(() => ({}));
    const notes = typeof rawBody?.notes === 'string' ? rawBody.notes.trim() : '';

    // 3. Execute settlement in MongoDB multi-document transaction
    let settlementResult;
    try {
      settlementResult = await settleGroup({ groupId: id, notes });
    } catch (settlementErr) {
      // Structured logging of transaction failure
      console.error('[SETTLEMENT_TRANSACTION_FAILED]', {
        groupId: id,
        groupName: group.name,
        error: settlementErr.message,
        stack: settlementErr.stack,
        timestamp: new Date().toISOString(),
      });

      // Wrap in domain TransactionError if not already a specific error
      if (settlementErr.message && settlementErr.message.includes('Cannot satisfy constraints')) {
        throw settlementErr; // Keep constraint deadlock specific
      }
      throw new TransactionError(
        `Failed to settle group "${group.name}": transaction was aborted. No partial ledger entries were written.`,
        settlementErr
      );
    }

    return NextResponse.json({
      success: true,
      data: settlementResult,
      meta: {
        timestamp: new Date().toISOString(),
      },
      message: settlementResult.message,
    });
  } catch (err) {
    const { statusCode, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status: statusCode });
  }
}

module.exports = { POST };
