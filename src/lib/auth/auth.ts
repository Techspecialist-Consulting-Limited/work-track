import NextAuth from "next-auth";
import { cookies } from "next/headers";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

const LOGIN_ROLE_COOKIE = "wt_login_role";

const tenantId = process.env.ENTRA_TENANT_ID;
const clientId = process.env.ENTRA_CLIENT_ID;
const clientSecret = process.env.ENTRA_CLIENT_SECRET;

if (!tenantId || !clientId || !clientSecret) {
  // Auth is configured lazily so `next build` works without secrets;
  // requests fail closed at runtime instead of exposing data.
  console.warn("[auth] ENTRA_* env vars missing — Microsoft sign-in will not work.");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: clientId ?? "",
      clientSecret: clientSecret ?? "",
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      authorization: {
        params: {
          scope: "openid profile email",
        },
      },
      profile(profile) {
        return {
          id: profile.oid ?? profile.sub,
          name: profile.name,
          email: profile.email ?? profile.preferred_username,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.oid = (profile as { oid?: string } | undefined)?.oid ?? account.providerAccountId;
        token.tid = (profile as { tid?: string } | undefined)?.tid ?? tenantId;
        // The role picked on /login travels in a short-lived cookie.
        const store = await cookies();
        const role = store.get(LOGIN_ROLE_COOKIE)?.value;
        if (role === "staff" || role === "hr" || role === "chairman") {
          token.role = role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { oid?: string }).oid = token.oid as string | undefined;
        (session.user as { tid?: string }).tid = token.tid as string | undefined;
        (session.user as { role?: string }).role = token.role as string | undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
