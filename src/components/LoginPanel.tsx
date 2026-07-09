"use client";

import { signIn } from "next-auth/react";

export function LoginPanel() {
  return (
    <main className="login-page">
      <section className="login-panel">
        <p className="eyebrow">Internal referral outreach</p>
        <h1>Private mail merge for small professional referral campaigns</h1>
        <p>
          Sign in with an approved Google Workspace account to create campaigns,
          preview personalized messages, and send through verified Gmail aliases.
        </p>
        <button className="primary-action" onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
          Continue with Google
        </button>
      </section>
    </main>
  );
}
