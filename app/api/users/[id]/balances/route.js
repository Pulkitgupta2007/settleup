const { NextResponse } = require('next/server');
const { connectToDatabase } = require('../../../../../src/lib/db');
const { getUserBalancesAcrossGroups } = require('../../../../../src/services/settlementService');
const { validateObjectId } = require('../../../../../src/lib/validators');
const { formatErrorResponse } = require('../../../../../src/lib/errors');

/**
 * GET /api/users/[id]/balances?currency=USD
 * Returns covered-index aggregated net balance per group for a user.
 */
async function GET(request, { params }) {
  try {
    await connectToDatabase();
    const { id } = params;
    validateObjectId(id, 'userId');

    const { searchParams } = new URL(request.url);
    const currency = searchParams.get('currency') || 'USD';

    const balances = await getUserBalancesAcrossGroups(id, currency);

    return NextResponse.json({
      success: true,
      data: balances,
    });
  } catch (err) {
    const { statusCode, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status: statusCode });
  }
}

module.exports = { GET };
