const { NextResponse } = require('next/server');
const { connectToDatabase } = require('../../../src/lib/db');
const { Group } = require('../../../src/models');
const { validateGroupInput } = require('../../../src/lib/validators');
const { formatErrorResponse } = require('../../../src/lib/errors');
const { getAuthenticatedUser } = require('../../../src/lib/auth');

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/groups
 * Lists all active groups.
 */
async function GET() {
  try {
    await connectToDatabase();
    const groups = await Group.find()
      .populate('members', 'name email defaultCurrency')
      .sort({ updatedAt: -1 });

    return NextResponse.json(
      {
        success: true,
        data: groups,
        count: groups.length,
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

/**
 * POST /api/groups
 * Creates a new group with validated members and optional constraints.
 * Automatically adds the authenticated user to group members if not already included.
 */
async function POST(request) {
  try {
    await connectToDatabase();
    const authUser = await getAuthenticatedUser(request);
    const body = await request.json().catch(() => null);

    // Ensure authenticated user is in members list if logged in
    let members = Array.isArray(body?.members) ? [...body.members] : [];
    if (authUser?.id && !members.includes(authUser.id)) {
      members.unshift(authUser.id);
    }

    const payload = {
      ...(body || {}),
      members,
    };

    const validated = validateGroupInput(payload);

    const group = await Group.create(validated);
    await group.populate('members', 'name email defaultCurrency');

    return NextResponse.json(
      {
        success: true,
        data: group,
        message: `Group "${group.name}" created successfully.`,
      },
      {
        status: 201,
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

export { GET, POST };
