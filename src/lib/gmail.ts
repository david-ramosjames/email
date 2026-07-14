import { google } from "googleapis";
import MailComposer from "nodemailer/lib/mail-composer";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const gmailSendScopes = ["https://www.googleapis.com/auth/gmail.send"];
const gmailAliasScopes = ["https://www.googleapis.com/auth/gmail.settings.basic"];
const gmailReadScopes = ["https://www.googleapis.com/auth/gmail.readonly"];

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

function configuredWorkspaceSendAliases() {
  const config = workspaceDelegationConfig();
  const envAliases = cleanEnv(process.env.GOOGLE_WORKSPACE_SEND_AS_ALIASES)
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set([config?.delegatedUser, ...envAliases].filter(Boolean) as string[]));
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

export async function delegatedGmailClient(scopes = gmailSendScopes) {
  const config = workspaceDelegationConfig();

  if (!config) {
    throw new Error(
      "Google Workspace delegated sending is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, and GOOGLE_WORKSPACE_IMPERSONATED_USER.",
    );
  }

  const auth = new google.auth.JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes,
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
          scopes.join(","),
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
    return delegatedGmailClient(gmailSendScopes);
  }

  return gmailClientForUser(userId);
}

export async function gmailClientForReading(userId: string) {
  if (isWorkspaceDelegationEnabled()) {
    return delegatedGmailClient(gmailReadScopes);
  }

  return gmailClientForUser(userId);
}

function sendAuthDetails() {
  const config = workspaceDelegationConfig();

  if (config) {
    return {
      authMode: "workspace_domain_wide_delegation",
      delegatedUser: config.delegatedUser,
    };
  }

  return {
    authMode: "signed_in_user_oauth",
    delegatedUser: null,
  };
}

async function saveConfiguredWorkspaceAliases(userId: string) {
  const aliases = configuredWorkspaceSendAliases();

  return Promise.all(
    aliases.map((email, index) =>
      prisma.sendAlias.upsert({
        where: {
          userId_email: {
            userId,
            email,
          },
        },
        update: {
          isDefault: index === 0,
          isVerified: true,
          verificationSource: "workspace_configured_alias",
          lastSyncedAt: new Date(),
        },
        create: {
          userId,
          email,
          displayName: email.split("@")[0]?.replace(".", " ") || email,
          isDefault: index === 0,
          isVerified: true,
          verificationSource: "workspace_configured_alias",
        },
      }),
    ),
  );
}

export async function syncSendAliases(userId: string) {
  if (isWorkspaceDelegationEnabled()) {
    try {
      const gmail = await delegatedGmailClient(gmailAliasScopes);
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
                verificationSource: "workspace_domain_wide_delegation",
                lastSyncedAt: new Date(),
              },
              create: {
                userId,
                email: (alias.sendAsEmail || "").toLowerCase(),
                displayName: alias.displayName,
                replyTo: alias.replyToAddress,
                isDefault: Boolean(alias.isDefault),
                isVerified: alias.verificationStatus === "accepted",
                verificationSource: "workspace_domain_wide_delegation",
              },
            }),
          ),
      );

      return saved.filter((alias) => Boolean(alias.email));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("unauthorized_client")) {
        return saveConfiguredWorkspaceAliases(userId);
      }
      throw error;
    }
  }

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
            verificationSource: "gmail_send_as",
            lastSyncedAt: new Date(),
          },
          create: {
            userId,
            email: (alias.sendAsEmail || "").toLowerCase(),
            displayName: alias.displayName,
            replyTo: alias.replyToAddress,
            isDefault: Boolean(alias.isDefault),
            isVerified: alias.verificationStatus === "accepted",
            verificationSource: "gmail_send_as",
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
    if (isWorkspaceDelegationEnabled() && configuredWorkspaceSendAliases().includes(email.toLowerCase())) {
      return prisma.sendAlias.upsert({
        where: {
          userId_email: {
            userId,
            email: email.toLowerCase(),
          },
        },
        update: {
          isVerified: true,
          verificationSource: "workspace_configured_alias",
          lastSyncedAt: new Date(),
        },
        create: {
          userId,
          email: email.toLowerCase(),
          isVerified: true,
          verificationSource: "workspace_configured_alias",
        },
      });
    }

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
  headers,
}: {
  userId: string;
  to: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}) {
  await assertVerifiedAlias(userId, fromEmail);
  const gmail = await gmailClientForSending(userId);
  const authDetails = sendAuthDetails();
  const message = await new MailComposer({
    from: `"${fromName.replaceAll('"', "'")}" <${fromEmail}>`,
    to,
    replyTo,
    subject,
    headers: {
      "X-Referral-Outreach": "true",
      ...headers,
    },
    html,
    text,
  }).compile().build();

  console.info("Sending Gmail message", {
    authMode: authDetails.authMode,
    delegatedUser: authDetails.delegatedUser,
    fromEmail,
    replyTo,
    to,
  });

  const raw = message
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return {
    gmailMessageId: response.data.id || "",
    fromEmail,
    replyTo,
    authMode: authDetails.authMode,
    delegatedUser: authDetails.delegatedUser,
  };
}
