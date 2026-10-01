const CredentialsProvider = require('next-auth/providers/credentials').default;
const GoogleProvider = require('next-auth/providers/google').default;
const bcrypt = require('bcryptjs');
const { connectToDatabase } = require('./db');
const { User } = require('../models');

const authOptions = {
  session: {
    strategy: 'jwt',
  },
  providers: [
    // 1. Credentials Provider (Email & Password)
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'alice@example.com' },
        password: { label: 'Password', type: 'password' },
        name: { label: 'Name', type: 'text', placeholder: 'Alice' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Please provide both email and password');
        }

        await connectToDatabase();
        const normalizedEmail = credentials.email.trim().toLowerCase();

        let user = await User.findOne({ email: normalizedEmail }).select('+password');

        // If user doesn't exist yet, auto-register for streamlined onboarding
        if (!user) {
          const hashedPassword = await bcrypt.hash(credentials.password, 10);
          user = await User.create({
            name: credentials.name?.trim() || normalizedEmail.split('@')[0],
            email: normalizedEmail,
            password: hashedPassword,
            defaultCurrency: 'USD',
          });
        } else {
          // If user exists and has a password, verify it
          if (user.password) {
            const isValid = await bcrypt.compare(credentials.password, user.password);
            if (!isValid) {
              throw new Error('Invalid email or password');
            }
          } else {
            // User registered via OAuth, set their password now
            user.password = await bcrypt.hash(credentials.password, 10);
            await user.save();
          }
        }

        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          defaultCurrency: user.defaultCurrency || 'USD',
        };
      },
    }),

    // 2. Google OAuth Provider
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || 'placeholder-client-id',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'placeholder-client-secret',
      allowDangerousEmailAccountLinking: true,
    }),
  ],

  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        await connectToDatabase();
        const normalizedEmail = user.email.trim().toLowerCase();

        let existingUser = await User.findOne({ email: normalizedEmail });
        if (!existingUser) {
          existingUser = await User.create({
            name: user.name || profile?.name || 'Google User',
            email: normalizedEmail,
            googleId: profile?.sub || account.providerAccountId,
            image: user.image || profile?.picture,
            defaultCurrency: 'USD',
          });
        } else if (!existingUser.googleId) {
          existingUser.googleId = profile?.sub || account.providerAccountId;
          if (user.image) existingUser.image = user.image;
          await existingUser.save();
        }

        user.id = existingUser._id.toString();
        user.defaultCurrency = existingUser.defaultCurrency;
      }
      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.defaultCurrency = user.defaultCurrency;
      }
      return token;
    },

    async session({ session, token }) {
      if (session?.user) {
        session.user.id = token.id;
        session.user.defaultCurrency = token.defaultCurrency;
      }
      return session;
    },
  },

  pages: {
    signIn: '/login',
  },

  secret: process.env.NEXTAUTH_SECRET || 'settleup-dev-jwt-secret-very-secure-key-32chars',
};

/**
 * Extracts authenticated user identity from NextAuth session or fallback test headers.
 * Resolves to the database User document if available.
 * 
 * Priority order:
 * 1. NextAuth session: `session.user`
 * 2. Test/mock headers: `x-user-id` or `x-user-email`
 * 
 * @param {Request} request
 * @returns {Promise<{ id: string, email: string, user: Object|null }|null>}
 */
async function getAuthenticatedUser(request) {
  let session = null;
  try {
    const { getServerSession } = require('next-auth/next');
    session = await getServerSession(authOptions);
  } catch {
    // Fallback for testing environments where getServerSession has no request context
  }

  const userId = session?.user?.id || (request?.headers?.get ? request.headers.get('x-user-id') : null);
  const userEmail = session?.user?.email || (request?.headers?.get ? request.headers.get('x-user-email') : null);

  if (!userId && !userEmail) {
    return null;
  }

  await connectToDatabase();

  let userDoc = null;
  if (userId) {
    try {
      userDoc = await User.findById(userId);
    } catch {
      // Invalid ObjectId format
    }
  }

  if (!userDoc && userEmail) {
    try {
      userDoc = await User.findOne({ email: userEmail.toLowerCase().trim() });
    } catch {
      // Lookup failure
    }
  }

  const resolvedId = userDoc ? userDoc._id.toString() : (userId ? String(userId) : null);
  const resolvedEmail = userDoc ? userDoc.email : (userEmail ? String(userEmail) : null);

  return {
    id: resolvedId,
    email: resolvedEmail,
    user: userDoc,
  };
}

/**
 * Checks if an authenticated user is an active member of a group.
 * 
 * @param {Object} group - Group document or object containing `members`
 * @param {{ id?: string, email?: string, user?: Object }} authUser
 * @returns {boolean}
 */
function isGroupMember(group, authUser) {
  if (!group || !authUser) return false;
  const memberSet = new Set((group.members || []).map(m => m.toString()));

  if (authUser.id && memberSet.has(authUser.id)) {
    return true;
  }
  if (authUser.user && memberSet.has(authUser.user._id.toString())) {
    return true;
  }

  return false;
}

module.exports = {
  authOptions,
  getAuthenticatedUser,
  isGroupMember,
};
