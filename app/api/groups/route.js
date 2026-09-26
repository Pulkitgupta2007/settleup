const { NextResponse } = require('next/server');
const { connectToDatabase } = require('../../../src/lib/db');
const { Group } = require('../../../src/models');
const { validateGroupInput } = require('../../../src/lib/validators');
const { formatErrorResponse } = require('../../../src/lib/errors');

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

    return NextResponse.json({
      success: true,
      data: groups,
      count: groups.length,
    });
  } catch (err) {
    const { statusCode, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status: statusCode });
  }
}

/**
 * POST /api/groups
 * Creates a new group with validated members and optional constraints.
 */
async function POST(request) {
  try {
    await connectToDatabase();
    const body = await request.json().catch(() => null);

    const validated = validateGroupInput(body);

    const group = await Group.create(validated);
    await group.populate('members', 'name email defaultCurrency');

    return NextResponse.json(
      {
        success: true,
        data: group,
        message: `Group "${group.name}" created successfully.`,
      },
      { status: 201 }
    );
  } catch (err) {
    const { statusCode, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status: statusCode });
  }
}

module.exports = { GET, POST };
