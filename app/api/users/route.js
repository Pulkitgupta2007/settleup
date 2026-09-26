const { NextResponse } = require('next/server');
const { connectToDatabase } = require('../../../src/lib/db');
const { User } = require('../../../src/models');
const { formatErrorResponse, ValidationError } = require('../../../src/lib/errors');
const bcrypt = require('bcryptjs');

/**
 * GET /api/users
 * Returns list of registered users for member selection and invitation.
 */
async function GET(request) {
  try {
    await connectToDatabase();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    let filter = {};
    if (query) {
      filter = {
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { email: { $regex: query, $options: 'i' } },
        ],
      };
    }

    const users = await User.find(filter)
      .select('_id name email defaultCurrency')
      .sort({ name: 1 })
      .limit(50);

    return NextResponse.json({
      success: true,
      data: users,
    });
  } catch (err) {
    const { statusCode, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status: statusCode });
  }
}

/**
 * POST /api/users
 * Quickly registers a new user (for demo or invite).
 */
async function POST(request) {
  try {
    await connectToDatabase();
    const body = await request.json().catch(() => null);

    if (!body || !body.email || !body.name) {
      throw new ValidationError('Name and email are required');
    }

    const email = body.email.trim().toLowerCase();
    let existing = await User.findOne({ email });
    if (existing) {
      return NextResponse.json({
        success: true,
        data: existing,
        message: 'User already exists',
      });
    }

    const hashedPassword = await bcrypt.hash(body.password || 'demo-password-123', 10);
    const newUser = await User.create({
      name: body.name.trim(),
      email,
      password: hashedPassword,
      defaultCurrency: (body.defaultCurrency || 'USD').toUpperCase(),
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          _id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          defaultCurrency: newUser.defaultCurrency,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    const { statusCode, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status: statusCode });
  }
}

module.exports = { GET, POST };
