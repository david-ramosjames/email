import { CampaignRecipientStatus, EmailEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/email";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; campaign?: string }>;
}) {
  const params = await searchParams;
  const email = params.email || "";
  let message = "Enter the email address that should no longer receive referral outreach.";

  async function unsubscribe(formData: FormData) {
    "use server";

    const submittedEmail = String(formData.get("email") || "");
    const campaignId = String(formData.get("campaign") || "");
    const normalizedEmail = normalizeEmail(submittedEmail);

    await prisma.suppressionList.upsert({
      where: { normalizedEmail },
      update: { reason: "Unsubscribed", source: "unsubscribe_link" },
      create: {
        email: submittedEmail,
        normalizedEmail,
        reason: "Unsubscribed",
        source: "unsubscribe_link",
      },
    });

    const recipient = await prisma.recipient.findUnique({ where: { normalizedEmail } });
    if (recipient && campaignId) {
      const campaignRecipient = await prisma.campaignRecipient.findUnique({
        where: {
          campaignId_recipientId: {
            campaignId,
            recipientId: recipient.id,
          },
        },
      });
      if (campaignRecipient) {
        await prisma.campaignRecipient.update({
          where: { id: campaignRecipient.id },
          data: {
            status: CampaignRecipientStatus.unsubscribed,
            unsubscribedAt: new Date(),
          },
        });
        await prisma.emailEvent.create({
          data: {
            campaignId,
            campaignRecipientId: campaignRecipient.id,
            type: EmailEventType.unsubscribed,
          },
        });
      }
    }
  }

  if (email) {
    message = "Confirm the opt-out below. This address will be added to the suppression list.";
  }

  return (
    <main className="public-page">
      <section className="unsubscribe-panel">
        <h1>Referral outreach opt-out</h1>
        <p>{message}</p>
        <form action={unsubscribe}>
          <input name="email" type="email" defaultValue={email} required />
          <input name="campaign" type="hidden" defaultValue={params.campaign || ""} />
          <button type="submit">Do not contact</button>
        </form>
      </section>
    </main>
  );
}
