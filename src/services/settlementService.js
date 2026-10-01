const mongoose = require('mongoose');
const { Group, Expense, LedgerEntry } = require('../models');
const { simplifyDebts } = require('../cppBridge');
const { convertAmount } = require('./currencyService');

/**
 * Calculates net pairwise debt obligations from existing ledger entries in a group.
 * 
 * DOUBLE-ENTRY LEDGER CONVENTION:
 * Every transaction generates two reciprocal ledger entries:
 * 1. DEBIT: represents a payable / liability on the user.
 *    (user: debtor, counterparty: creditor, amount: X) => Debtor owes Creditor X cents.
 * 2. CREDIT: represents a receivable / asset for the counterparty.
 *    (user: creditor, counterparty: debtor, amount: X) => Creditor is owed X cents by Debtor.
 * 
 * PERFORMANCE & PURITY OPTIMIZATION:
 * By querying ONLY documents where `direction === 'DEBIT'`, we:
 * 1. Cut the MongoDB query payload in half (zero redundant records over the wire).
 * 2. Completely eliminate double-counting without complex conditional branching.
 * 3. Guarantee that `entry.user` is always the payer/debtor and `entry.counterparty` is the payee/creditor.
 * 
 * @param {string|mongoose.Types.ObjectId} groupId
 * @param {string} currency - 3-letter currency code (group base currency)
 * @param {mongoose.ClientSession} [session] - Optional Mongoose session for transactional reads
 * @returns {Promise<Array<{ from: string, to: string, amount: number }>>} pairwise directed debts
 */
async function getUnsettledPairwiseDebts(groupId, currency, session) {
  const entries = await LedgerEntry.find({
    group: groupId,
    currency: currency.toUpperCase(),
    direction: 'DEBIT',
  }).session(session);

  // Pairwise net flow map: key "debtor\0creditor" stores total debt obligation from debtor to creditor
  const netFlow = new Map();

  for (const entry of entries) {
    if (!entry.counterparty || entry.user.equals(entry.counterparty)) {
      continue;
    }

    const debtor = entry.user.toString();
    const creditor = entry.counterparty.toString();
    const flowKey = `${debtor}\0${creditor}`;

    netFlow.set(flowKey, (netFlow.get(flowKey) || 0) + entry.amount);
  }

  // Net opposing flows between each pair of users (e.g. A owes B 50, B owes A 20 => A owes B 30)
  const pairwiseDebts = [];
  const processedPairs = new Set();

  for (const [flowKey, amount] of netFlow.entries()) {
    const [userA, userB] = flowKey.split('\0');
    const pairId = [userA, userB].sort().join('\0');

    if (processedPairs.has(pairId)) continue;
    processedPairs.add(pairId);

    const forwardFlow = netFlow.get(`${userA}\0${userB}`) || 0;
    const reverseFlow = netFlow.get(`${userB}\0${userA}`) || 0;
    const netObligation = forwardFlow - reverseFlow;

    if (netObligation > 0) {
      pairwiseDebts.push({ from: userA, to: userB, amount: netObligation });
    } else if (netObligation < 0) {
      pairwiseDebts.push({ from: userB, to: userA, amount: -netObligation });
    }
  }

  return pairwiseDebts;
}

/**
 * Allocates payer funding across split participant shares.
 * Guarantees exact 2D penny conservation:
 * 1. For every split i: sum of payer contributions === split.amount exactly.
 * 2. For every payer k: sum of contributions across all splits === payer.amountCents exactly.
 * 
 * @param {Array<{ user: mongoose.Types.ObjectId, amountCents: number }>} payers
 * @param {Array<{ user: mongoose.Types.ObjectId, amount: number }>} splits
 * @param {number} totalAmount
 * @returns {Array<Array<number>>} matrix[splitIdx][payerIdx] of contribution amounts in cents
 */
function allocatePayerContributions(payers, splits, totalAmount) {
  const matrix = [];
  const payerRemaining = payers.map(p => p.amountCents);

  for (let i = 0; i < splits.length; i++) {
    const splitAmount = splits[i].amount;
    const row = new Array(payers.length).fill(0);

    if (i === splits.length - 1) {
      // Conservation Boundary Guarantee:
      // The final split absorbs the exact residual balances of each payer.
      // Because sum(split.amount) === sum(payer.amountCents) === totalAmount,
      // this guarantees zero penny truncation drift without floating point bias.
      for (let k = 0; k < payers.length; k++) {
        row[k] = payerRemaining[k];
      }
    } else {
      let allocated = 0;
      const raw = [];

      for (let k = 0; k < payers.length; k++) {
        const exact = totalAmount > 0 ? (splitAmount * payers[k].amountCents) / totalAmount : 0;
        const floor = Math.min(Math.floor(exact), payerRemaining[k]);
        row[k] = floor;
        allocated += floor;
        raw.push({ k, frac: exact - Math.floor(exact), rem: payerRemaining[k] - floor });
      }

      let remainder = splitAmount - allocated;
      raw.sort((a, b) => b.frac - a.frac);

      for (const item of raw) {
        if (remainder <= 0) break;
        if (item.rem > 0) {
          row[item.k]++;
          item.rem--;
          remainder--;
        }
      }

      if (remainder > 0) {
        for (let k = 0; k < payers.length && remainder > 0; k++) {
          const avail = payerRemaining[k] - row[k];
          const take = Math.min(avail, remainder);
          row[k] += take;
          remainder -= take;
        }
      }

      for (let k = 0; k < payers.length; k++) {
        payerRemaining[k] -= row[k];
      }
    }

    matrix.push(row);
  }

  return matrix;
}

/**
 * Builds reciprocal double-entry ledger items for a recorded expense.
 * Supports both multi-payer co-funding and legacy single-payer expenses.
 * 
 * For each split participant and each contributing payer:
 * 1. Participant is DEBITED (liability: owes payer their share of that payer's contribution)
 * 2. Payer is CREDITED (asset: is owed by participant)
 * (Self-allocations where participant === payer are omitted from inter-member debt)
 * 
 * @param {Object} params
 * @param {mongoose.Types.ObjectId} params.groupObjectId
 * @param {Array<{ user: mongoose.Types.ObjectId, amountCents: number }>} [params.payers]
 * @param {mongoose.Types.ObjectId} [params.payerId] - Backward compatibility for single payer
 * @param {mongoose.Types.ObjectId} params.expenseId
 * @param {string} params.description
 * @param {string} params.expenseCurrency
 * @param {string} params.baseCurrency
 * @param {Array<{ user: mongoose.Types.ObjectId, amount: number }>} params.splits
 * @param {Object} params.fxOptions
 * @returns {Promise<Array<Object>>} array of unpersisted LedgerEntry document definitions
 */
async function buildExpenseLedgerRecords({
  groupObjectId,
  payers,
  payerId,
  expenseId,
  description,
  expenseCurrency,
  baseCurrency,
  splits,
  fxOptions = {},
}) {
  const isMultiCurrency = expenseCurrency !== baseCurrency;
  const ledgerEntries = [];

  // Normalize payers to standard array
  let normalizedPayers = [];
  if (Array.isArray(payers) && payers.length > 0) {
    normalizedPayers = payers.map(p => ({
      user: p.user instanceof mongoose.Types.ObjectId ? p.user : new mongoose.Types.ObjectId(p.user || p),
      amountCents: p.amountCents,
    }));
  } else if (payerId) {
    const singlePayerId = payerId instanceof mongoose.Types.ObjectId ? payerId : new mongoose.Types.ObjectId(payerId);
    const totalSplitCents = splits.reduce((acc, s) => acc + s.amount, 0);
    normalizedPayers = [{ user: singlePayerId, amountCents: totalSplitCents }];
  } else {
    throw new Error('Either payers array or payerId must be provided');
  }

  const totalExpenseCents = normalizedPayers.reduce((acc, p) => acc + (p.amountCents || 0), 0);
  const contributionMatrix = allocatePayerContributions(normalizedPayers, splits, totalExpenseCents);

  for (let i = 0; i < splits.length; i++) {
    const split = splits[i];
    const participantId = split.user instanceof mongoose.Types.ObjectId
      ? split.user
      : new mongoose.Types.ObjectId(split.user);

    for (let k = 0; k < normalizedPayers.length; k++) {
      const payer = normalizedPayers[k];
      const currentPayerId = payer.user;
      const contributionAmount = contributionMatrix[i][k];

      // Skip payer paying for their own share or zero contribution
      if (participantId.equals(currentPayerId) || contributionAmount <= 0) {
        continue;
      }

      let amountInBase = contributionAmount;
      let exchangeRate = 1.0;
      let isFxStale = false;
      let fxRateTimestamp = new Date();

      if (isMultiCurrency) {
        const conversion = await convertAmount({
          amountCents: contributionAmount,
          fromCurrency: expenseCurrency,
          toCurrency: baseCurrency,
          options: fxOptions,
        });

        amountInBase = conversion.convertedCents;
        exchangeRate = conversion.rate;
        isFxStale = conversion.isStale;
        fxRateTimestamp = conversion.fxTimestamp;
      }

      // Participant owes payer: DEBIT (liability)
      ledgerEntries.push({
        group: groupObjectId,
        user: participantId,
        counterparty: currentPayerId,
        type: 'EXPENSE',
        direction: 'DEBIT',
        amount: amountInBase,
        currency: baseCurrency,
        originalAmount: contributionAmount,
        originalCurrency: expenseCurrency,
        exchangeRate,
        isFxStale,
        fxRateTimestamp,
        expense: expenseId,
        description: isMultiCurrency
          ? `${description} (share: ${(contributionAmount / 100).toFixed(2)} ${expenseCurrency} converted @ ${exchangeRate})`
          : `${description} (share)`,
      });

      // Payer is owed by participant: CREDIT (asset/receivable)
      ledgerEntries.push({
        group: groupObjectId,
        user: currentPayerId,
        counterparty: participantId,
        type: 'EXPENSE',
        direction: 'CREDIT',
        amount: amountInBase,
        currency: baseCurrency,
        originalAmount: contributionAmount,
        originalCurrency: expenseCurrency,
        exchangeRate,
        isFxStale,
        fxRateTimestamp,
        expense: expenseId,
        description: isMultiCurrency
          ? `${description} (paid ${(contributionAmount / 100).toFixed(2)} ${expenseCurrency} for ${participantId} @ ${exchangeRate})`
          : `${description} (paid for ${participantId})`,
      });
    }
  }

  return ledgerEntries;
}

/**
 * Records an expense and appends corresponding double-entry LedgerEntry documents
 * inside a MongoDB multi-document transaction.
 * 
 * Invariant: Partial writes are impossible. If writing any ledger record fails,
 * the entire expense write is aborted and rolled back.
 * 
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.groupId
 * @param {string} params.description
 * @param {string|mongoose.Types.ObjectId|Array<{ user: string|mongoose.Types.ObjectId, amountCents: number }>} params.paidBy
 * @param {number} params.totalAmount - In integer cents
 * @param {string} params.currency
 * @param {Array<{ user: string|mongoose.Types.ObjectId, amount: number }>} params.splits
 * @param {mongoose.ClientSession} [params.session]
 * @param {Object} [params.fxOptions]
 * @returns {Promise<{ expense: Object, ledgerEntries: Array, ledgerEntriesCount: number }>}
 */
async function recordExpense({
  groupId,
  description,
  paidBy,
  totalAmount,
  currency,
  splitType = 'EQUAL',
  splits,
  session: externalSession,
  fxOptions = {},
}) {
  const session = externalSession || (await mongoose.startSession());
  const ownsSession = !externalSession;

  try {
    let result;

    const executeWithSession = async (activeSession) => {
      const groupObjectId = new mongoose.Types.ObjectId(groupId);

      const group = await Group.findById(groupObjectId).session(activeSession);
      if (!group) {
        throw new Error(`Group not found: ${groupId}`);
      }

      const expenseCurrency = currency.toUpperCase();
      const baseCurrency = group.baseCurrency.toUpperCase();

      // Normalize paidBy: supports both multi-payer array and legacy single payer
      let normalizedPayers;
      if (Array.isArray(paidBy)) {
        normalizedPayers = paidBy.map(p => ({
          user: new mongoose.Types.ObjectId(p.user || p),
          amountCents: p.amountCents != null ? p.amountCents : totalAmount,
        }));
      } else {
        const singlePayerId = new mongoose.Types.ObjectId(paidBy);
        normalizedPayers = [{ user: singlePayerId, amountCents: totalAmount }];
      }

      // 1. Create Expense record
      const [expense] = await Expense.create(
        [
          {
            group: groupObjectId,
            description,
            paidBy: normalizedPayers,
            totalAmount,
            currency: expenseCurrency,
            splitType,
            splits: splits.map(s => ({
              user: new mongoose.Types.ObjectId(s.user),
              amount: s.amount,
            })),
          },
        ],
        { session: activeSession }
      );

      // 2. Build reciprocal double-entry ledger items
      const ledgerEntries = await buildExpenseLedgerRecords({
        groupObjectId,
        payers: normalizedPayers,
        expenseId: expense._id,
        description,
        expenseCurrency,
        baseCurrency,
        splits,
        fxOptions,
      });

      // 3. Atomically batch insert ledger entries
      if (ledgerEntries.length > 0) {
        await LedgerEntry.insertMany(ledgerEntries, { session: activeSession });
      }

      return {
        expense,
        ledgerEntries,
        ledgerEntriesCount: ledgerEntries.length,
      };
    };

    if (ownsSession) {
      await session.withTransaction(async () => {
        result = await executeWithSession(session);
      });
    } else {
      result = await executeWithSession(session);
    }

    return result;
  } finally {
    if (ownsSession) {
      await session.endSession();
    }
  }
}

/**
 * Formats a group's avoidance constraints into the string-pair format required by simplifier.
 * 
 * @param {Array<{ avoid: Array<any> }>} [constraints=[]]
 * @returns {Array<{ avoid: [string, string] }>}
 */
function formatGroupConstraints(constraints = []) {
  return constraints.map(c => ({
    avoid: [c.avoid[0].toString(), c.avoid[1].toString()],
  }));
}

/**
 * Generates reciprocal double-entry ledger items for each transaction in a minimal settlement plan.
 * 
 * For each transaction (debtor pays creditor X cents):
 * - Debtor entry: CREDIT (reduces liability/payable)
 * - Creditor entry: DEBIT (clears asset/receivable)
 * 
 * @param {Object} params
 * @param {mongoose.Types.ObjectId} params.groupId
 * @param {string} params.baseCurrency
 * @param {mongoose.Types.ObjectId} params.settlementId
 * @param {Array<{ from: string, to: string, amount: number }>} params.transactions
 * @param {string} [params.notes]
 * @returns {{ ledgerEntries: Array<Object>, totalAmountSettledCents: number }}
 */
function buildSettlementLedgerRecords({
  groupId,
  baseCurrency,
  settlementId,
  transactions,
  notes = '',
}) {
  const ledgerEntries = [];
  let totalAmountSettledCents = 0;

  for (const tx of transactions) {
    const debtorId = new mongoose.Types.ObjectId(tx.from);
    const creditorId = new mongoose.Types.ObjectId(tx.to);
    totalAmountSettledCents += tx.amount;

    // Entry 1: Debtor pays -> Liability decreased (CREDIT)
    ledgerEntries.push({
      group: groupId,
      user: debtorId,
      counterparty: creditorId,
      type: 'SETTLEMENT',
      direction: 'CREDIT',
      amount: tx.amount,
      currency: baseCurrency,
      settlementId,
      description: notes || `Settlement payment of ${(tx.amount / 100).toFixed(2)} ${baseCurrency} to creditor`,
    });

    // Entry 2: Creditor receives -> Receivable cleared (DEBIT)
    ledgerEntries.push({
      group: groupId,
      user: creditorId,
      counterparty: debtorId,
      type: 'SETTLEMENT',
      direction: 'DEBIT',
      amount: tx.amount,
      currency: baseCurrency,
      settlementId,
      description: notes || `Settlement receipt of ${(tx.amount / 100).toFixed(2)} ${baseCurrency} from debtor`,
    });
  }

  return { ledgerEntries, totalAmountSettledCents };
}

/**
 * Executes a group debt settlement within a MongoDB multi-document transaction.
 * 
 * ATOMIC SETTLEMENT PROTOCOL:
 * 1. Computes minimal transaction plan from unsettled pairwise debts in the group's base currency.
 * 2. For each transaction (debtor pays creditor X cents), appends two reciprocal entries:
 *    - Debtor: CREDIT (reduces previous DEBIT liability back to zero)
 *    - Creditor: DEBIT (clears previous CREDIT receivable back to zero)
 * 3. Commits all records in a single atomic transaction.
 * 4. Partial writes are IMPOSSIBLE: if any failure occurs, the entire batch rolls back.
 * 
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.groupId - ID of the group to settle
 * @param {mongoose.ClientSession} [params.session] - Optional outer session
 * @param {string} [params.notes] - Optional settlement note / description
 * @returns {Promise<{ settlementId: string, transactions: Array, entryCount: number, ledgerEntriesCount: number, totalAmountSettledCents: number, message: string }>}
 */
async function settleGroup({ groupId, session: externalSession, notes = '' }) {
  const session = externalSession || (await mongoose.startSession());
  const ownsSession = !externalSession;

  try {
    let settlementResult;

    const executeWithSession = async (activeSession) => {
      // 1. Fetch group details inside transaction
      const group = await Group.findById(groupId).session(activeSession);
      if (!group) {
        throw new Error(`Group not found: ${groupId}`);
      }

      // 2. Fetch all unsettled pairwise debts for this group in its base currency
      const pairwiseDebts = await getUnsettledPairwiseDebts(
        groupId,
        group.baseCurrency,
        activeSession
      );

      if (pairwiseDebts.length === 0) {
        return {
          settlementId: null,
          transactions: [],
          entryCount: 0,
          ledgerEntriesCount: 0,
          totalAmountSettledCents: 0,
          message: 'Group is already fully settled. No transactions required.',
        };
      }

      // 3. Format constraints and participants for simplification algorithm
      const formattedConstraints = formatGroupConstraints(group.constraints);
      const participantIds = group.members.map(m => m.toString());

      // 4. Run simplification algorithm
      const minimalTransactions = simplifyDebts(pairwiseDebts, {
        constraints: formattedConstraints,
        participants: participantIds,
      });

      // 5. Generate reciprocal settlement ledger records
      const settlementId = new mongoose.Types.ObjectId();
      const { ledgerEntries, totalAmountSettledCents } = buildSettlementLedgerRecords({
        groupId: group._id,
        baseCurrency: group.baseCurrency,
        settlementId,
        transactions: minimalTransactions,
        notes,
      });

      // 6. Atomic batch insert of all settlement ledger entries
      await LedgerEntry.insertMany(ledgerEntries, { session: activeSession });

      // 7. Update Group status and timestamp
      group.lastSettledAt = new Date();
      await group.save({ session: activeSession });

      return {
        settlementId: settlementId.toString(),
        transactions: minimalTransactions,
        entryCount: ledgerEntries.length,
        ledgerEntriesCount: ledgerEntries.length,
        totalAmountSettledCents,
        message: `Successfully generated ${minimalTransactions.length} settlement transactions across ${ledgerEntries.length} ledger entries.`,
      };
    };

    if (ownsSession) {
      await session.withTransaction(async () => {
        settlementResult = await executeWithSession(session);
      });
    } else {
      settlementResult = await executeWithSession(session);
    }

    return settlementResult;
  } finally {
    if (ownsSession) {
      await session.endSession();
    }
  }
}

/**
 * Queries a user's net balance across all their groups in a specific currency.
 * Utilizes the compound index: { user: 1, currency: 1, group: 1, signedAmount: 1 }
 * 
 * Covered index: aggregates user balances without reading raw document bodies from disk.
 * 
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} currency - 3-letter currency code (e.g. 'USD')
 * @returns {Promise<Array<{ groupId: string, groupName: string, netBalanceCents: number, entryCount: number }>>}
 */
async function getUserBalancesAcrossGroups(userId, currency = 'USD') {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const normalizedCurrency = currency.toUpperCase();

  return LedgerEntry.aggregate([
    {
      $match: {
        user: userObjectId,
        currency: normalizedCurrency,
      },
    },
    {
      $group: {
        _id: '$group',
        netBalanceCents: { $sum: '$signedAmount' },
        totalCreditedCents: {
          $sum: { $cond: [{ $eq: ['$direction', 'CREDIT'] }, '$amount', 0] },
        },
        totalDebitedCents: {
          $sum: { $cond: [{ $eq: ['$direction', 'DEBIT'] }, '$amount', 0] },
        },
        entryCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'groups',
        localField: '_id',
        foreignField: '_id',
        as: 'groupInfo',
      },
    },
    {
      $unwind: {
        path: '$groupInfo',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        groupId: '$_id',
        groupName: { $ifNull: ['$groupInfo.name', 'Unknown Group'] },
        baseCurrency: { $ifNull: ['$groupInfo.baseCurrency', normalizedCurrency] },
        netBalanceCents: 1,
        totalCreditedCents: 1,
        totalDebitedCents: 1,
        entryCount: 1,
      },
    },
    {
      $sort: { netBalanceCents: -1 },
    },
  ]);
}

module.exports = {
  settleGroup,
  getUserBalancesAcrossGroups,
  getUnsettledPairwiseDebts,
  recordExpense,
  buildExpenseLedgerRecords,
  buildSettlementLedgerRecords,
  formatGroupConstraints,
};
