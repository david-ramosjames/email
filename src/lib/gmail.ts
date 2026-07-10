import { google } from "googleapis";
import MailComposer from "nodemailer/lib/mail-composer";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const gmailScopes = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
];

function cleanEnv(value?: string) {
  return value?.trim().replace(/^["']|["']$/g, "") || "";
}

function serviceAccountPrivateKey() {
  return cleanEnv(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).replace(/\\n/g, "\n");
}

export function workspaceDelegationConfig() {
  const clientEmail = cleanEnv(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const privateKey = serviceAccountPrivateKey();
  const delegatedUser = cleanEnv(process.env.GOOGLE_WORKSPACE_IMPERSONATED_USER).toLowerCase();

  if (!clientEmail || !privateKey || !delegatedUser) return null;

  return { clientEmail, privateKey, delegatedUser };
}

export function isWorkspaceDelegationEnabled() {
  return workspaceDelegationConfig() !== null;
}

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

export async function delegatedGmailClient() {
  const config = workspaceDelegationConfig();

  if (!config) {
    throw new Error(
      "Google Workspace delegated sending is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, and GOOGLE_WORKSPACE_IMPERSONATED_USER.",
    );
  }

  const auth = new google.auth.JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: gmailScopes,
    subject: config.delegatedUser,
  });

  try {
    await auth.authorize();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Google authorization error";

    if (message.includes("unauthorized_client")) {
      throw new Error(
        [
          "Google Workspace rejected delegated Gmail access.",
          "The service account key may work for Sheets, but Gmail requires Workspace Admin domain-wide delegation for these exact scopes:",
          gmailScopes.join(","),
          `Impersonated user: ${config.delegatedUser}`,
          "In admin.google.com, authorize the service account's numeric OAuth client ID, not the service account email.",
          `Original Google error: ${message}`,
        ].join(" "),
      );
    }

    throw error;
  }

  return google.gmail({ version: "v1", auth });
}

async function gmailClientForSending(userId: string) {
  if (isWorkspaceDelegationEnabled()) {
    return delegatedGmailClient();
  }

  return gmailClientForUser(userId);
}

export async function syncSendAliases(userId: string) {
  const gmail = isWorkspaceDelegationEnabled()
    ? await delegatedGmailClient()
    : await gmailClientForUser(userId);
  const response = await gmail.users.settings.sendAs.list({ userId: "me" });
  const aliases = response.data.sendAs || [];
  const verificationSource = isWorkspaceDelegationEnabled()
    ? "workspace_domain_wide_delegation"
    : "gmail_send_as";

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
            verificationSource,
            lastSyncedAt: new Date(),
          },
          create: {
            userId,
            email: (alias.sendAsEmail || "").toLowerCase(),
            displayName: alias.displayName,
            replyTo: alias.replyToAddress,
            isDefault: Boolean(alias.isDefault),
            isVerified: alias.verificationStatus === "accepted",
            verificationSource,
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
  const gmail = await gmailClientForSending(userId);
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
