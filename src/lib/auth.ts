import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import type { NextAuthConfig } from 'next-auth';

export const authConfig: NextAuthConfig = {
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const isOnAdminPage = request.nextUrl.pathname.startsWith('/admin');
      const isOnApiRoute = request.nextUrl.pathname.startsWith('/api');
      const isOnLoginPage = request.nextUrl.pathname === '/login';

      // Admin pages require authentication
      if (isOnAdminPage && !isLoggedIn) {
        return false;
      }

      // API routes for admin actions require authentication
      // (documents management requires auth; inquiries/mcp are public)
      if (isOnApiRoute && !isLoggedIn) {
        const path = request.nextUrl.pathname;
        const requiresAuth = [
          '/api/documents',
        ].some((p) => path.startsWith(p));

        if (requiresAuth) return false;
      }

      if (isOnLoginPage && isLoggedIn) {
        return Response.redirect(new URL('/admin', request.nextUrl));
      }

      return true;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
