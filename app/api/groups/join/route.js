const { NextResponse } = require('next/server');
const { getAuthenticatedUser, isGroupMember } = require('../../../../src/lib/auth');
const { connectToDatabase } = require('../../../../src/lib/db');
const { Group } = require('../../../../src/models');
const { rateLimiter, getClientIp } = require('../../../../src/lib/rateLimiter');
const { formatErrorResponse } = require('../../../../src/lib/errors');

/**
 * GET /api/groups/join?inviteCode=xyz
 * Preview group details (name, member count, expiration) prior to joining.
 * Rate-limited to prevent brute-force scanning of invite codes.
 */
async function GET(request) {
  try {
    await connectToDatabase();
    const { searchParams } = new URL(request.url);
    const inviteCode = searchParams.get('inviteCode');

    if (!inviteCode) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invite code is required.',
          },
        },
        { status: 400 }
      );
    }

    // Rate limiting: 20 checks per 15 minutes per IP
    const clientIp = getClientIp(request);
    const rl = rateLimiter.check(`preview:${clientIp}`, { maxRequests: 20, windowMs: 15 * 60 * 1000 });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please wait a few minutes before trying again.',
          },
        },
        { status: 429 }
      );
    }

    const group = await Group.findOne({ inviteCode: inviteCode.trim() });
    if (!group) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'This invite link is invalid or has been revoked.',
          },
        },
        { status: 404 }
      );
    }

    const isExpired = group.inviteCodeExpiresAt
      ? new Date() > new Date(group.inviteCodeExpiresAt)
      : false;

    if (isExpired) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVITE_EXPIRED',
            message: 'This invite link has expired. Please ask the group owner for a new link.',
          },
        },
        { status: 410 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        groupId: group._id.toString(),
        name: group.name,
        description: group.description,
        baseCurrency: group.baseCurrency,
        memberCount: group.members.length,
        expiresAt: group.inviteCodeExpiresAt,
      },
    });
  } catch (error) {
    const { statusCode, body } = formatErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

/**
 * POST /api/groups/join
 * Joins a group using a valid invite code.
 * Requires user authentication and enforces rate limiting to prevent token guessing.
 */
async function POST(request) {
  try {
    await connectToDatabase();

    // 1. Rate limiting: 10 join attempts per 15 minutes per IP
    const clientIp = getClientIp(request);
    const rl = rateLimiter.check(`join:${clientIp}`, { maxRequests: 10, windowMs: 15 * 60 * 1000 });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many join attempts. Please wait before trying again.',
          },
        },
        { status: 429 }
      );
    }

    // 2. Authentication check
    const authUser = await getAuthenticatedUser(request);
    if (!authUser) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'You must be logged in to join a group.',
          },
        },
        { status: 401 }
      );
    }

    // 3. Payload validation
    const body = await request.json().catch(() => ({}));
    const { inviteCode } = body;

    if (!inviteCode || typeof inviteCode !== 'string' || !inviteCode.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invite code is required.',
          },
        },
        { status: 400 }
      );
    }

    // 4. Find group by invite code
    const group = await Group.findOne({ inviteCode: inviteCode.trim() });
    if (!group) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'This invite link is invalid or has been revoked.',
          },
        },
        { status: 404 }
      );
    }

    // 5. Expiration check
    if (group.inviteCodeExpiresAt && new Date() > new Date(group.inviteCodeExpiresAt)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVITE_EXPIRED',
            message: 'This invite link has expired. Please ask a group member for a new link.',
          },
        },
        { status: 410 }
      );
    }

    // 6. Check if user is already a member
    const isAlreadyMember = isGroupMember(group, authUser);
    if (isAlreadyMember) {
      return NextResponse.json({
        success: true,
        message: `You are already a member of "${group.name}".`,
        data: {
          groupId: group._id.toString(),
          groupName: group.name,
          alreadyMember: true,
        },
      });
    }

    // 7. Add member to group
    const userIdToAdd = authUser.user ? authUser.user._id : authUser.id;
    group.members.push(userIdToAdd);
    await group.save();

    return NextResponse.json({
      success: true,
      message: `You have successfully joined "${group.name}"!`,
      data: {
        groupId: group._id.toString(),
        groupName: group.name,
        alreadyMember: false,
      },
    });
  } catch (error) {
    const { statusCode, body } = formatErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

module.exports = { GET, POST };
