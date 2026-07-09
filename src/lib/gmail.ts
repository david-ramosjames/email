import { google } from "googleapis";
import MailComposer from "nodemailer/lib/mail-composer";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export async function getGoogleAccount(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (!account?.refresh_token) {
    throw new Error("No connected Google account with a refresh token was found.");
  }

  return account;
}

export async function gmailClientForUser(userId: string) {
  const account = await getGoogleAccount(userId);
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );

  oauth2.setCredentials({
    refresh_token: decryptToken(account.refresh_token),
    access_token: decryptToken(account.access_token),
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });

  oauth2.on("tokens", async (tokens) => {
    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: tokens.access_token ? encryptToken(tokens.access_token) : undefined,
        refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : undefined,
        expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : undefined,
      },
    });
  });

  return google.gmail({ version: "v1", auth: oauth2 });
}

export async function syncSendAliases(userId: string) {
  const gmail = await gmailClientForUser(userId);
  const response = await gmail.users.settings.sendAs.list({ userId: "me" });
  const aliases = response.data.sendAs || [];

  const saved = await Promise.all(
    aliases
      .filter((alias) => Boolean(alias.sendAsEmail))
      .map((alias) =>
      prisma.sendAlias.upsert({
        where: {
          userId_email: {
            userId,
            email: (alias.sendAsEmail || "").toLowerCase(),
          },
        },
        update: {
          displayName: alias.displayName,
          replyTo: alias.replyToAddress,
          isDefault: Boolean(alias.isDefault),
          isVerified: alias.verificationStatus === "accepted",
          lastSyncedAt: new Date(),
        },
        create: {
          userId,
          email: (alias.sendAsEmail || "").toLowerCase(),
          displayName: alias.displayName,
          replyTo: alias.replyToAddress,
          isDefault: Boolean(alias.isDefault),
          isVerified: alias.verificationStatus === "accepted",
        },
      }),
    ),
  );

  return saved.filter((alias) => Boolean(alias.email));
}

export async function assertVerifiedAlias(userId: string, email: string) {
  const alias = await prisma.sendAlias.findFirst({
    where: {
      userId,
      email: email.toLowerCase(),
      isVerified: true,
    },
  });

  if (!alias) {
    throw new Error("That sender alias is not verified for this Google Workspace account.");
  }

  return alias;
}

export async function sendGmailMessage({
  userId,
  to,
  fromName,
  fromEmail,
  replyTo,
  subject,
  html,
  text,
}: {
  userId: string;
  to: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
}) {
  await assertVerifiedAlias(userId, fromEmail);
  const gmail = await gmailClientForUser(userId);
  const message = await new MailComposer({
    from: `"${fromName.replaceAll('"', "'")}" <${fromEmail}>`,
    to,
    replyTo,
    subject,
    html,
    text,
  }).compile().build();

  const raw = message
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return response.data.id || "";
}
