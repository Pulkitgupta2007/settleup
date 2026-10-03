const { NextResponse } = require('next/server');
const { connectToDatabase } = require('../../../../../src/lib/db');
const { getUserBalancesAcrossGroups } = require('../../../../../src/services/settlementService');
const { validateObjectId } = require('../../../../../src/lib/validators');
const { formatErrorResponse } = require('../../../../../src/lib/errors');

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    return NextResponse.json(
      {
        success: true,
        data: balances,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err) {
    const { statusCode, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status: statusCode });
  }
}

export { GET };
