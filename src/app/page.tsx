import { LoginPanel } from "@/components/LoginPanel";

const authErrors: Record<string, string> = {
  AccessDenied:
    "This Google account is not approved for this internal app. Add it to APPROVED_ADMIN_EMAILS and redeploy.",
  OAuthSignin: "Google sign-in could not start. Check the Google OAuth client settings.",
  OAuthCallback:
    "Google returned to the app, but the callback failed. Check Railway logs for the NextAuth error, and confirm the database migration ran.",
  Configuration: "Authentication is not fully configured. Check the app environment variables.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? authErrors[params.error] || "Sign-in failed. Check the app logs for details." : null;

  return <LoginPanel error={error} />;
}
