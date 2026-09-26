const { NextResponse } = require('next/server');
const { getAuthenticatedUser, isGroupMember } = require('../../../../../src/lib/auth');
const { connectToDatabase } = require('../../../../../src/lib/db');
const { Group, LedgerEntry, User } = require('../../../../../src/models');
const { validateObjectId } = require('../../../../../src/lib/validators');
const { NotFoundError, formatErrorResponse } = require('../../../../../src/lib/errors');

function escapeCsv(val) {
  if (val == null) return '';
  const str = String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatLedgerRow(entry) {
  const dateStr = entry.createdAt
    ? new Date(entry.createdAt).toISOString().replace('T', ' ').substring(0, 19)
    : '';
  const description = entry.description || (entry.type === 'SETTLEMENT' ? 'Settlement Payment' : 'Expense Share');
  const amountStr = (entry.amount / 100).toFixed(2);
  const currency = entry.currency || 'USD';
  const type = entry.type || 'EXPENSE';

  let paidBy = '';
  let splitAmong = '';

  if (entry.type === 'SETTLEMENT') {
    if (entry.direction === 'CREDIT') {
      paidBy = entry.user?.name || entry.user?.email || 'Unknown Debtor';
      splitAmong = entry.counterparty?.name || entry.counterparty?.email || 'Unknown Creditor';
    } else {
      paidBy = entry.counterparty?.name || entry.counterparty?.email || 'Unknown Debtor';
      splitAmong = entry.user?.name || entry.user?.email || 'Unknown Creditor';
    }
  } else {
    // EXPENSE
    if (entry.expense && Array.isArray(entry.expense.paidBy) && entry.expense.paidBy.length > 0) {
      paidBy = entry.expense.paidBy
        .map(p => {
          const name = p.user?.name || p.user?.email || 'Payer';
          const amt = p.amountCents ? ` ($${(p.amountCents / 100).toFixed(2)})` : '';
          return `${name}${amt}`;
        })
        .join('; ');
    } else {
      paidBy = entry.direction === 'CREDIT'
        ? (entry.user?.name || entry.user?.email || 'Unknown Payer')
        : (entry.counterparty?.name || entry.counterparty?.email || 'Unknown Payer');
    }

    if (entry.expense && Array.isArray(entry.expense.splits) && entry.expense.splits.length > 0) {
      splitAmong = entry.expense.splits
        .map(s => {
          const name = s.user?.name || s.user?.email || 'Member';
          const amt = s.amount ? ` ($${(s.amount / 100).toFixed(2)})` : '';
          return `${name}${amt}`;
        })
        .join('; ');
    } else {
      splitAmong = entry.direction === 'CREDIT'
        ? (entry.counterparty?.name || entry.counterparty?.email || 'Unknown Member')
        : (entry.user?.name || entry.user?.email || 'Unknown Member');
    }
  }

  return [
    escapeCsv(dateStr),
    escapeCsv(description),
    escapeCsv(amountStr),
    escapeCsv(currency),
    escapeCsv(paidBy),
    escapeCsv(splitAmong),
    escapeCsv(type),
  ].join(',');
}

/**
 * GET /api/groups/[id]/export
 * Streams all append-only LedgerEntry documents for the group as a downloadable CSV.
 * Requires user to be an active member of the group.
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

    // Authorization: User must be an authenticated member of this group
    const authUser = await getAuthenticatedUser(request);
    if (!authUser) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required to export group transaction history.',
          },
        },
        { status: 401 }
      );
    }

    if (!isGroupMember(group, authUser)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied. Only active members of this group are authorized to export transaction history.',
          },
        },
        { status: 403 }
      );
    }

    // Query ALL append-only ledger entries in chronological sequence
    const cursor = LedgerEntry.find({ group: group._id })
      .sort({ createdAt: 1 })
      .populate('user', 'name email')
      .populate('counterparty', 'name email')
      .populate({
        path: 'expense',
        populate: [
          { path: 'paidBy.user', select: 'name email' },
          { path: 'splits.user', select: 'name email' },
        ],
      })
      .cursor();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 1. CSV Header
          controller.enqueue(
            encoder.encode('Date,Description,Amount,Currency,Paid By,Split Among,Transaction Type\n')
          );

          // 2. Stream records chunk by chunk
          for await (const entry of cursor) {
            const line = formatLedgerRow(entry) + '\n';
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    const safeFilename = `${group.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}_ledger.csv`;

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Cache-Control': 'no-cache, no-store',
      },
    });
  } catch (err) {
    const { statusCode, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status: statusCode });
  }
}

module.exports = { GET };
