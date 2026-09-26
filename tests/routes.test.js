const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const os = require('os');
const { User, Group, Expense, LedgerEntry } = require('../src/models');

const groupsRoute = require('../app/api/groups/route');
const groupDetailRoute = require('../app/api/groups/[id]/route');
const groupExpensesRoute = require('../app/api/groups/[id]/expenses/route');
const groupSettleRoute = require('../app/api/groups/[id]/settle/route');
const groupExportRoute = require('../app/api/groups/[id]/export/route');
const groupInviteRoute = require('../app/api/groups/[id]/invite/route');
const groupJoinRoute = require('../app/api/groups/join/route');
const { rateLimiter } = require('../src/lib/rateLimiter');
const usersRoute = require('../app/api/users/route');
const userBalancesRoute = require('../app/api/users/[id]/balances/route');

let replSet;
jest.setTimeout(30000);

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, {
    runtimeAdapters: { os },
  });
  await Promise.all([
    User.init(),
    Group.init(),
    Expense.init(),
    LedgerEntry.init(),
  ]);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
});

beforeEach(async () => {
  rateLimiter.clear();
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// Helper to simulate Next.js Request object with optional headers
function createMockRequest(url, method = 'GET', body = null, headers = {}) {
  const headerMap = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    url,
    method,
    headers: {
      get: (key) => headerMap.get(key.toLowerCase()) || null,
    },
    json: async () => body,
  };
}

describe('API Route Handlers', () => {
  let user1, user2, user3;

  beforeEach(async () => {
    user1 = await User.create({ name: 'Alice', email: 'alice@route.test', defaultCurrency: 'USD' });
    user2 = await User.create({ name: 'Bob', email: 'bob@route.test', defaultCurrency: 'USD' });
    user3 = await User.create({ name: 'Charlie', email: 'charlie@route.test', defaultCurrency: 'USD' });
  });

  describe('User Routes (/api/users)', () => {
    test('GET /api/users returns list of users', async () => {
      const req = createMockRequest('http://localhost:3000/api/users');
      const res = await usersRoute.GET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.length).toBe(3);
    });

    test('POST /api/users creates a new user', async () => {
      const req = createMockRequest('http://localhost:3000/api/users', 'POST', {
        name: 'David',
        email: 'david@route.test',
      });
      const res = await usersRoute.POST(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('David');
      expect(json.data.email).toBe('david@route.test');
    });
  });

  describe('Group Routes (/api/groups & /api/groups/[id])', () => {
    test('POST /api/groups creates a new group and GET /api/groups lists it', async () => {
      const postReq = createMockRequest('http://localhost:3000/api/groups', 'POST', {
        name: 'Weekend Trip',
        baseCurrency: 'USD',
        members: [user1._id.toString(), user2._id.toString()],
      });
      const postRes = await groupsRoute.POST(postReq);
      const postJson = await postRes.json();

      expect(postRes.status).toBe(201);
      expect(postJson.success).toBe(true);
      expect(postJson.data.name).toBe('Weekend Trip');

      const getRes = await groupsRoute.GET();
      const getJson = await getRes.json();
      expect(getRes.status).toBe(200);
      expect(getJson.count).toBe(1);
      expect(getJson.data[0].name).toBe('Weekend Trip');
    });

    test('PATCH /api/groups/[id] adds a member and constraint to existing group', async () => {
      const group = await Group.create({
        name: 'Dinner Crew',
        baseCurrency: 'USD',
        members: [user1._id, user2._id],
      });

      // 1. Add Member
      const addMemberReq = createMockRequest(
        `http://localhost:3000/api/groups/${group._id}`,
        'PATCH',
        { action: 'add_member', userId: user3._id.toString() }
      );
      const addRes = await groupDetailRoute.PATCH(addMemberReq, {
        params: { id: group._id.toString() },
      });
      const addJson = await addRes.json();

      expect(addRes.status).toBe(200);
      expect(addJson.data.members.length).toBe(3);

      // 2. Add Avoidance Constraint (user1 avoid user3)
      const addConstraintReq = createMockRequest(
        `http://localhost:3000/api/groups/${group._id}`,
        'PATCH',
        {
          action: 'add_constraint',
          avoid: [user1._id.toString(), user3._id.toString()],
        }
      );
      const constraintRes = await groupDetailRoute.PATCH(addConstraintReq, {
        params: { id: group._id.toString() },
      });
      const constraintJson = await constraintRes.json();

      expect(constraintRes.status).toBe(200);
      expect(constraintJson.data.constraints.length).toBe(1);
    });

    test('GET /api/groups/[id] returns populated balances, rawDebts, and settlementDebts', async () => {
      const group = await Group.create({
        name: 'Festival',
        baseCurrency: 'USD',
        members: [user1._id, user2._id, user3._id],
      });

      // Add an expense: Alice paid $30.00, split 3 ways ($10 each)
      const expReq = createMockRequest(
        `http://localhost:3000/api/groups/${group._id}/expenses`,
        'POST',
        {
          description: 'Tickets',
          paidBy: user1._id.toString(),
          totalAmount: 3000,
          currency: 'USD',
          splits: [
            { user: user1._id.toString(), amount: 1000 },
            { user: user2._id.toString(), amount: 1000 },
            { user: user3._id.toString(), amount: 1000 },
          ],
        }
      );
      const expRes = await groupExpensesRoute.POST(expReq, {
        params: { id: group._id.toString() },
      });
      expect(expRes.status).toBe(201);

      // Now query group detail
      const detailReq = createMockRequest(`http://localhost:3000/api/groups/${group._id}`);
      const detailRes = await groupDetailRoute.GET(detailReq, {
        params: { id: group._id.toString() },
      });
      const detailJson = await detailRes.json();

      expect(detailRes.status).toBe(200);
      expect(detailJson.success).toBe(true);

      const aliceBal = detailJson.data.membersWithBalances.find(m => m.name === 'Alice');
      const bobBal = detailJson.data.membersWithBalances.find(m => m.name === 'Bob');
      expect(aliceBal.netBalanceCents).toBe(2000);
      expect(bobBal.netBalanceCents).toBe(-1000);

      expect(detailJson.data.settlementDebts.length).toBe(2);
      expect(detailJson.data.isFullySettled).toBe(false);
    });
  });

  describe('Settlement Route (/api/groups/[id]/settle)', () => {
    test('POST /api/groups/[id]/settle zeroes balances and commits append-only ledger entries', async () => {
      const group = await Group.create({
        name: 'Camp Trip',
        baseCurrency: 'USD',
        members: [user1._id, user2._id],
      });

      // User1 paid $50.00 for both
      await groupExpensesRoute.POST(
        createMockRequest(`http://localhost:3000/api/groups/${group._id}/expenses`, 'POST', {
          description: 'Tent',
          paidBy: user1._id.toString(),
          totalAmount: 5000,
          currency: 'USD',
          splits: [
            { user: user1._id.toString(), amount: 2500 },
            { user: user2._id.toString(), amount: 2500 },
          ],
        }),
        { params: { id: group._id.toString() } }
      );

      // Settle group
      const settleReq = createMockRequest(
        `http://localhost:3000/api/groups/${group._id}/settle`,
        'POST',
        { notes: 'Settled via cash' }
      );
      const settleRes = await groupSettleRoute.POST(settleReq, {
        params: { id: group._id.toString() },
      });
      const settleJson = await settleRes.json();

      expect(settleRes.status).toBe(200);
      expect(settleJson.success).toBe(true);
      expect(settleJson.data.ledgerEntriesCount).toBe(2);

      // Check group detail is now fully settled
      const detailRes = await groupDetailRoute.GET(
        createMockRequest(`http://localhost:3000/api/groups/${group._id}`),
        { params: { id: group._id.toString() } }
      );
      const detailJson = await detailRes.json();

      expect(detailJson.data.isFullySettled).toBe(true);
      expect(detailJson.data.settlementDebts.length).toBe(0);
      for (const m of detailJson.data.membersWithBalances) {
        expect(m.netBalanceCents).toBe(0);
      }
    });
  });

  describe('User Balances Route (/api/users/[id]/balances)', () => {
    test('GET /api/users/[id]/balances returns user net metrics', async () => {
      const group = await Group.create({
        name: 'Road Trip',
        baseCurrency: 'USD',
        members: [user1._id, user2._id],
      });

      // User1 paid $40.00
      await groupExpensesRoute.POST(
        createMockRequest(`http://localhost:3000/api/groups/${group._id}/expenses`, 'POST', {
          description: 'Gas',
          paidBy: user1._id.toString(),
          totalAmount: 4000,
          currency: 'USD',
          splits: [
            { user: user1._id.toString(), amount: 2000 },
            { user: user2._id.toString(), amount: 2000 },
          ],
        }),
        { params: { id: group._id.toString() } }
      );

      const balReq = createMockRequest(
        `http://localhost:3000/api/users/${user1._id}/balances?currency=USD`
      );
      const balRes = await userBalancesRoute.GET(balReq, {
        params: { id: user1._id.toString() },
      });
      const balJson = await balRes.json();

      expect(balRes.status).toBe(200);
      expect(balJson.success).toBe(true);
      expect(balJson.data.length).toBe(1);
      expect(balJson.data[0].netBalanceCents).toBe(2000);
    });
  });

  describe('Group CSV Export Route (/api/groups/[id]/export)', () => {
    test('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const group = await Group.create({
        name: 'Secret Group',
        baseCurrency: 'USD',
        members: [user1._id, user2._id],
      });

      const req = createMockRequest(`http://localhost:3000/api/groups/${group._id}/export`);
      const res = await groupExportRoute.GET(req, {
        params: { id: group._id.toString() },
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    test('rejects non-members with 403 Forbidden', async () => {
      const group = await Group.create({
        name: 'Private Club',
        baseCurrency: 'USD',
        members: [user1._id, user2._id],
      });

      // user3 is not in the group
      const req = createMockRequest(
        `http://localhost:3000/api/groups/${group._id}/export`,
        'GET',
        null,
        { 'x-user-id': user3._id.toString() }
      );
      const res = await groupExportRoute.GET(req, {
        params: { id: group._id.toString() },
      });
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('FORBIDDEN');
    });

    test('streams full ledger history as downloadable CSV for authorized members', async () => {
      const group = await Group.create({
        name: 'Alpine Trip',
        baseCurrency: 'USD',
        members: [user1._id, user2._id],
      });

      // Expense 1: Alice paid $50 split equally
      await groupExpensesRoute.POST(
        createMockRequest(`http://localhost:3000/api/groups/${group._id}/expenses`, 'POST', {
          description: 'Groceries',
          paidBy: user1._id.toString(),
          totalAmount: 5000,
          currency: 'USD',
          splits: [
            { user: user1._id.toString(), amount: 2500 },
            { user: user2._id.toString(), amount: 2500 },
          ],
        }),
        { params: { id: group._id.toString() } }
      );

      // Settle group: Bob pays Alice $25
      await groupSettleRoute.POST(
        createMockRequest(`http://localhost:3000/api/groups/${group._id}/settle`, 'POST', {
          notes: 'Cash settlement',
        }),
        { params: { id: group._id.toString() } }
      );

      const totalLedgerCount = await LedgerEntry.countDocuments({ group: group._id });
      expect(totalLedgerCount).toBe(4); // 2 expense entries (DEBIT+CREDIT) + 2 settlement entries (CREDIT+DEBIT)

      // Request CSV export as member user1
      const req = createMockRequest(
        `http://localhost:3000/api/groups/${group._id}/export`,
        'GET',
        null,
        { 'x-user-id': user1._id.toString() }
      );
      const res = await groupExportRoute.GET(req, {
        params: { id: group._id.toString() },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain('attachment; filename="alpine_trip_ledger.csv"');

      // Read streamed CSV text
      const csvText = await res.text();
      const lines = csvText.trim().split('\n');

      // Line 0 is header
      expect(lines[0]).toBe('Date,Description,Amount,Currency,Paid By,Split Among,Transaction Type');
      // Total lines minus header equals total ledger records (complete history, not just balances)
      expect(lines.length - 1).toBe(totalLedgerCount);

      // Verify contents reflect true append-only history (both EXPENSE and SETTLEMENT present)
      expect(csvText).toContain('Groceries');
      expect(csvText).toContain('Cash settlement');
      expect(csvText).toContain('EXPENSE');
      expect(csvText).toContain('SETTLEMENT');
      expect(csvText).toContain('25.00');
    });
  });

  describe('Group Shareable Invite Link & Join Routes', () => {
    let testGroup, memberUser, outsiderUser;

    beforeEach(async () => {
      memberUser = await User.create({ name: 'Member Alice', email: 'alice_mem@test.com' });
      outsiderUser = await User.create({ name: 'Outsider Dave', email: 'dave_out@test.com' });
      testGroup = await Group.create({
        name: 'Road Trip Crew',
        baseCurrency: 'USD',
        members: [memberUser._id],
      });
    });

    test('GET /api/groups/[id]/invite rejects unauthenticated requests with 401', async () => {
      const req = createMockRequest(`http://localhost:3000/api/groups/${testGroup._id}/invite`);
      const res = await groupInviteRoute.GET(req, { params: { id: testGroup._id.toString() } });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    test('GET /api/groups/[id]/invite rejects non-members with 403', async () => {
      const req = createMockRequest(
        `http://localhost:3000/api/groups/${testGroup._id}/invite`,
        'GET',
        null,
        { 'x-user-id': outsiderUser._id.toString() }
      );
      const res = await groupInviteRoute.GET(req, { params: { id: testGroup._id.toString() } });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('FORBIDDEN');
    });

    test('GET /api/groups/[id]/invite returns invite link and expiry for authorized members', async () => {
      const req = createMockRequest(
        `http://localhost:3000/api/groups/${testGroup._id}/invite`,
        'GET',
        null,
        { 'x-user-id': memberUser._id.toString() }
      );
      const res = await groupInviteRoute.GET(req, { params: { id: testGroup._id.toString() } });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.inviteCode).toBe(testGroup.inviteCode);
      expect(json.data.inviteUrl).toContain(`/join/${testGroup.inviteCode}`);
      expect(json.data.isExpired).toBe(false);
      expect(new Date(json.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    test('POST /api/groups/[id]/invite regenerates invite code and invalidates old code', async () => {
      const oldCode = testGroup.inviteCode;

      const req = createMockRequest(
        `http://localhost:3000/api/groups/${testGroup._id}/invite`,
        'POST',
        { expiryDays: 14 },
        { 'x-user-id': memberUser._id.toString() }
      );
      const res = await groupInviteRoute.POST(req, { params: { id: testGroup._id.toString() } });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.inviteCode).not.toBe(oldCode);
      expect(json.data.inviteUrl).toContain(`/join/${json.data.inviteCode}`);

      // Verify in DB that oldCode is no longer valid
      const updatedGroup = await Group.findById(testGroup._id);
      expect(updatedGroup.inviteCode).toBe(json.data.inviteCode);
      expect(updatedGroup.inviteCode).not.toBe(oldCode);
    });

    test('GET /api/groups/join previews group details and rejects invalid/expired codes', async () => {
      // 1. Missing invite code
      const reqMissing = createMockRequest('http://localhost:3000/api/groups/join');
      const resMissing = await groupJoinRoute.GET(reqMissing);
      expect(resMissing.status).toBe(400);

      // 2. Non-existent code
      const reqNotFound = createMockRequest('http://localhost:3000/api/groups/join?inviteCode=nonexistent123');
      const resNotFound = await groupJoinRoute.GET(reqNotFound);
      expect(resNotFound.status).toBe(404);

      // 3. Valid code returns preview
      const reqValid = createMockRequest(`http://localhost:3000/api/groups/join?inviteCode=${testGroup.inviteCode}`);
      const resValid = await groupJoinRoute.GET(reqValid);
      expect(resValid.status).toBe(200);
      const jsonValid = await resValid.json();
      expect(jsonValid.success).toBe(true);
      expect(jsonValid.data.name).toBe('Road Trip Crew');
      expect(jsonValid.data.memberCount).toBe(1);

      // 4. Expired code returns 410
      testGroup.inviteCodeExpiresAt = new Date(Date.now() - 60000); // 1 minute ago
      await testGroup.save();
      const reqExpired = createMockRequest(`http://localhost:3000/api/groups/join?inviteCode=${testGroup.inviteCode}`);
      const resExpired = await groupJoinRoute.GET(reqExpired);
      expect(resExpired.status).toBe(410);
      const jsonExpired = await resExpired.json();
      expect(jsonExpired.error.code).toBe('INVITE_EXPIRED');
    });

    test('POST /api/groups/join validates authentication, membership, and joins successfully', async () => {
      // 1. Rejects unauthenticated
      const reqUnauth = createMockRequest('http://localhost:3000/api/groups/join', 'POST', {
        inviteCode: testGroup.inviteCode,
      });
      const resUnauth = await groupJoinRoute.POST(reqUnauth);
      expect(resUnauth.status).toBe(401);

      // 2. Successfully joins outsider to group
      const reqJoin = createMockRequest(
        'http://localhost:3000/api/groups/join',
        'POST',
        { inviteCode: testGroup.inviteCode },
        { 'x-user-id': outsiderUser._id.toString() }
      );
      const resJoin = await groupJoinRoute.POST(reqJoin);
      expect(resJoin.status).toBe(200);
      const jsonJoin = await resJoin.json();
      expect(jsonJoin.success).toBe(true);
      expect(jsonJoin.data.alreadyMember).toBe(false);
      expect(jsonJoin.data.groupId).toBe(testGroup._id.toString());

      // Confirm DB state
      const dbGroup = await Group.findById(testGroup._id);
      expect(dbGroup.members.map(m => m.toString())).toContain(outsiderUser._id.toString());
      expect(dbGroup.members).toHaveLength(2);

      // 3. Re-joining is idempotent
      const resRejoin = await groupJoinRoute.POST(reqJoin);
      expect(resRejoin.status).toBe(200);
      const jsonRejoin = await resRejoin.json();
      expect(jsonRejoin.data.alreadyMember).toBe(true);
      const dbGroupAfter = await Group.findById(testGroup._id);
      expect(dbGroupAfter.members).toHaveLength(2); // Still 2, no duplicates
    });

    test('POST /api/groups/join rejects expired invite link with 410', async () => {
      testGroup.inviteCodeExpiresAt = new Date(Date.now() - 3600000); // 1 hour ago
      await testGroup.save();

      const req = createMockRequest(
        'http://localhost:3000/api/groups/join',
        'POST',
        { inviteCode: testGroup.inviteCode },
        { 'x-user-id': outsiderUser._id.toString() }
      );
      const res = await groupJoinRoute.POST(req);
      expect(res.status).toBe(410);
      const json = await res.json();
      expect(json.error.code).toBe('INVITE_EXPIRED');
    });

    test('POST /api/groups/join enforces rate limiting after excessive attempts', async () => {
      const spoofIp = '203.0.113.42';

      // Send 10 attempts
      for (let i = 0; i < 10; i++) {
        const req = createMockRequest(
          'http://localhost:3000/api/groups/join',
          'POST',
          { inviteCode: 'invalid_attempt_' + i },
          { 'x-user-id': outsiderUser._id.toString(), 'x-forwarded-for': spoofIp }
        );
        const res = await groupJoinRoute.POST(req);
        // Will be 404 (not found)
        expect(res.status).toBe(404);
      }

      // 11th attempt from same IP must be rejected with 429 RATE_LIMIT_EXCEEDED
      const blockedReq = createMockRequest(
        'http://localhost:3000/api/groups/join',
        'POST',
        { inviteCode: testGroup.inviteCode },
        { 'x-user-id': outsiderUser._id.toString(), 'x-forwarded-for': spoofIp }
      );
      const blockedRes = await groupJoinRoute.POST(blockedReq);
      expect(blockedRes.status).toBe(429);
      const blockedJson = await blockedRes.json();
      expect(blockedJson.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});
