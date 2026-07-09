import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { auditLog } from "@/lib/audit";
import { encryptToken } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const approvedAdmins = (process.env.APPROVED_ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

function encryptedAdapter(): Adapter {
  const base = PrismaAdapter(prisma) as Record<string, unknown> & {
    linkAccount?: (account: Record<string, unknown>) => Promise<unknown>;
  };

  return {
    ...base,
    async linkAccount(account: Record<string, unknown>) {
      return base.linkAccount?.({
        ...account,
        access_token: encryptToken(account.access_token as string | undefined),
        refresh_token: encryptToken(account.refresh_token as string | undefined),
        id_token: encryptToken(account.id_token as string | undefined),
      });
    },
  } as Adapter;
}

export const authOptions: NextAuthOptions = {
  adapter: encryptedAdapter(),
  session: { strategy: "database" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: {
        params: {
          access_type: "offline",
          prompt: "consent",
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/gmail.settings.basic",
          ].join(" "),
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email || (approvedAdmins.length > 0 && !approvedAdmins.includes(email))) {
        return false;
      }

      await prisma.user.updateMany({
        where: { email },
        data: { approvedAt: new Date(), role: "admin" },
      });

      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = (user as typeof user & { role?: string }).role || "admin";
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      await auditLog({
        userId: user.id,
        action: "login",
        entity: "user",
        entityId: user.id,
      });
    },
  },
  pages: {
    signIn: "/",
    error: "/",
  },
};
