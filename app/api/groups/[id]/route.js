const { NextResponse } = require('next/server');
const { connectToDatabase } = require('../../../../src/lib/db');
const { Group, LedgerEntry, User } = require('../../../../src/models');
const { getUnsettledPairwiseDebts, formatGroupConstraints } = require('../../../../src/services/settlementService');
const { simplifyDebts } = require('../../../../src/simplifier');
const { validateObjectId } = require('../../../../src/lib/validators');
const { NotFoundError, ValidationError, formatErrorResponse } = require('../../../../src/lib/errors');

/**
 * GET /api/groups/[id]
 * Returns group info, populated members, member net balances,
 * raw debt web, and current minimal settlement plan.
 */
async function GET(request, { params }) {
  try {
    await connectToDatabase();
    const { id } = params;

    validateObjectId(id, 'groupId');

    const group = await Group.findById(id).populate('members', 'name email defaultCurrency');
    if (!group) {
      throw new NotFoundError('Group', id);
    }

    // 1. Fetch recent ledger entries
    const ledgerEntries = await LedgerEntry.find({ group: group._id })
      .populate('user', 'name email')
      .populate('counterparty', 'name email')
      .sort({ createdAt: -1 })
      .limit(100);

    // 2. Aggregate each member's net balance in the group's base currency
    const memberBalancesMap = new Map();
    for (const m of group.members) {
      memberBalancesMap.set(m._id.toString(), 0);
    }

    const allGroupEntries = await LedgerEntry.find({
      group: group._id,
      currency: group.baseCurrency,
    });

    for (const entry of allGroupEntries) {
      const uId = entry.user.toString();
      const current = memberBalancesMap.get(uId) || 0;
      memberBalancesMap.set(uId, current + (entry.signedAmount || 0));
    }

    const membersWithBalances = group.members.map(m => ({
      _id: m._id.toString(),
      name: m.name,
      email: m.email,
      netBalanceCents: memberBalancesMap.get(m._id.toString()) || 0,
    }));

    // 3. Unsettled pairwise debts (the "Before" state for graph)
    const pairwiseDebts = await getUnsettledPairwiseDebts(group._id, group.baseCurrency);

    // 4. Compute minimal settlement plan (the "After" state for graph)
    const formattedConstraints = formatGroupConstraints(group.constraints);
    const memberIds = group.members.map(m => m._id.toString());

    let minimalTransactions = [];
    try {
      minimalTransactions = simplifyDebts(pairwiseDebts, {
        constraints: formattedConstraints,
        participants: memberIds,
      });
    } catch (e) {
      // If constraint deadlock, return empty and log warning
    }

    // Map IDs to friendly member names for graph visualization
    const idToName = new Map();
    for (const m of group.members) {
      idToName.set(m._id.toString(), m.name);
    }

    const rawDebtsNamed = pairwiseDebts.map(d => ({
      from: idToName.get(d.from) || d.from,
      to: idToName.get(d.to) || d.to,
      fromId: d.from,
      toId: d.to,
      amount: d.amount,
    }));

    const settlementDebtsNamed = minimalTransactions.map(d => ({
      from: idToName.get(d.from) || d.from,
      to: idToName.get(d.to) || d.to,
      fromId: d.from,
      toId: d.to,
      amount: d.amount,
    }));

    return NextResponse.json({
      success: true,
      data: {
        group,
        membersWithBalances,
        ledgerEntries,
        rawDebts: rawDebtsNamed,
        settlementDebts: settlementDebtsNamed,
        isFullySettled: minimalTransactions.length === 0,
      },
    });
  } catch (err) {
    const { statusCode, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status: statusCode });
  }
}

/**
 * PATCH /api/groups/[id]
 * Updates group members or avoidance constraints.
 */
async function PATCH(request, { params }) {
  try {
    await connectToDatabase();
    const { id } = params;
    validateObjectId(id, 'groupId');

    const group = await Group.findById(id);
    if (!group) {
      throw new NotFoundError('Group', id);
    }

    const body = await request.json().catch(() => ({}));
    const { action, userId, avoid, constraintIndex } = body;

    if (action === 'add_member') {
      validateObjectId(userId, 'userId');
      const user = await User.findById(userId);
      if (!user) throw new NotFoundError('User', userId);

      const exists = group.members.some(m => m.toString() === userId);
      if (exists) {
        return NextResponse.json({
          success: true,
          data: group,
          message: `${user.name} is already a member of this group.`,
        });
      }

      group.members.push(userId);
      await group.save();
    } else if (action === 'add_constraint') {
      if (!Array.isArray(avoid) || avoid.length !== 2) {
        throw new ValidationError('Constraint avoid must be an array of 2 member IDs');
      }
      const [u1, u2] = avoid;
      validateObjectId(u1, 'avoid[0]');
      validateObjectId(u2, 'avoid[1]');
      if (u1 === u2) {
        throw new ValidationError('Cannot set avoidance constraint between the same user');
      }

      const memberIds = new Set(group.members.map(m => m.toString()));
      if (!memberIds.has(u1) || !memberIds.has(u2)) {
        throw new ValidationError('Both users in avoidance constraint must be group members');
      }

      group.constraints.push({ avoid: [u1, u2] });
      await group.save();
    } else if (action === 'remove_constraint') {
      if (typeof constraintIndex === 'number' && constraintIndex >= 0 && constraintIndex < group.constraints.length) {
        group.constraints.splice(constraintIndex, 1);
        await group.save();
      }
    } else {
      throw new ValidationError(`Unsupported action "${action}"`);
    }

    await group.populate('members', 'name email defaultCurrency');

    return NextResponse.json({
      success: true,
      data: group,
      message: 'Group updated successfully.',
    });
  } catch (err) {
    const { statusCode, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status: statusCode });
  }
}

module.exports = { GET, PATCH };

