const { NextResponse } = require('next/server');
const { getAuthenticatedUser, isGroupMember } = require('../../../../../src/lib/auth');
const { connectToDatabase } = require('../../../../../src/lib/db');
const { Group } = require('../../../../../src/models');
const { validateObjectId } = require('../../../../../src/lib/validators');
const { NotFoundError, formatErrorResponse } = require('../../../../../src/lib/errors');

/**
 * Helper to get the origin URL for invite links
 */
function getOrigin(request) {
  try {
    const url = new URL(request.url);
    return url.origin;
  } catch {
    return process.env.NEXTAUTH_URL || 'http://localhost:3000';
  }
}

/**
 * GET /api/groups/[id]/invite
 * Retrieves the current invite link, code, and expiry for a group.
 * Accessible only to active group members.
 */
async function GET(request, { params }) {
  try {
    await connectToDatabase();
    const { id } = params;
    validateObjectId(id, 'groupId');

    const group = await Group.findById(id);
    if (!group) {
      throw new NotFoundError('Group', id);
    }

    const authUser = await getAuthenticatedUser(request);
    if (!authUser) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required to access group invite link.',
          },
        },
        { status: 401 }
      );
    }

    const authorized = await isGroupMember(group, authUser);
    if (!authorized) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only active members of this group can view or manage invite links.',
          },
        },
        { status: 403 }
      );
    }

    // Ensure group has an invite code (for legacy groups created before this feature)
    let updated = false;
    if (!group.inviteCode) {
      group.regenerateInviteCode(7);
      updated = true;
    }
    if (updated) {
      await group.save();
    }

    const origin = getOrigin(request);
    const isExpired = group.inviteCodeExpiresAt
      ? new Date() > new Date(group.inviteCodeExpiresAt)
      : false;

    return NextResponse.json({
      success: true,
      data: {
        groupId: group._id.toString(),
        groupName: group.name,
        inviteCode: group.inviteCode,
        inviteUrl: `${origin}/join/${group.inviteCode}`,
        expiresAt: group.inviteCodeExpiresAt,
        isExpired,
      },
    });
  } catch (error) {
    const { statusCode, body } = formatErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

/**
 * POST /api/groups/[id]/invite
 * Regenerates the invite link (immediately invalidating any previous invite link).
 * Accessible only to active group members.
 */
async function POST(request, { params }) {
  try {
    await connectToDatabase();
    const { id } = params;
    validateObjectId(id, 'groupId');

    const group = await Group.findById(id);
    if (!group) {
      throw new NotFoundError('Group', id);
    }

    const authUser = await getAuthenticatedUser(request);
    if (!authUser) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required to regenerate group invite link.',
          },
        },
        { status: 401 }
      );
    }

    const authorized = await isGroupMember(group, authUser);
    if (!authorized) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only active members of this group can regenerate invite links.',
          },
        },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const expiryDays = typeof body.expiryDays === 'number' ? body.expiryDays : 7;

    const newCode = group.regenerateInviteCode(expiryDays);
    await group.save();

    const origin = getOrigin(request);

    return NextResponse.json({
      success: true,
      message: 'Invite link regenerated successfully. Any previous links have been invalidated.',
      data: {
        groupId: group._id.toString(),
        groupName: group.name,
        inviteCode: newCode,
        inviteUrl: `${origin}/join/${newCode}`,
        expiresAt: group.inviteCodeExpiresAt,
        isExpired: false,
      },
    });
  } catch (error) {
    const { statusCode, body } = formatErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

module.exports = { GET, POST };
