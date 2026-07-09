import { EmailEventType } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { addComplianceFooter, personalize } from "@/lib/email";
import { sendGmailMessage } from "@/lib/gmail";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const to = body.to || session.user.email;
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!campaign) throw new Error("Campaign not found.");
    if (!to) throw new Error("No test recipient email is available.");

    const sample = {
      email: to,
      first_name: "Sample",
      last_name: "Recipient",
      firm_name: "Example Firm",
      city: "Chicago",
      practice_area: "Estate Planning",
      notes: "Test send",
    };
    const unsubscribeUrl = `${process.env.UNSUBSCRIBE_BASE_URL || ""}?email=${encodeURIComponent(to)}&campaign=${campaign.id}`;
    const withFooter = addComplianceFooter({
      html: personalize(campaign.htmlBody, sample),
      text: personalize(campaign.textBody, sample),
      businessIdentity: campaign.businessIdentity,
      mailingAddress: campaign.mailingAddress,
      unsubscribeUrl,
    });
    const gmailMessageId = await sendGmailMessage({
      userId: session.user.id,
      to,
      fromName: campaign.fromName,
      fromEmail: campaign.fromEmailAlias,
      replyTo: campaign.replyToEmail,
      subject: `[TEST] ${personalize(campaign.subjectLine, sample)}`,
      html: withFooter.html,
      text: withFooter.text,
    });

    await prisma.campaign.update({
      where: { id },
      data: { testSentAt: new Date() },
    });
    await prisma.emailEvent.create({
      data: {
        campaignId: id,
        type: EmailEventType.test_sent,
        metadata: { to, gmailMessageId },
      },
    });
    await auditLog({
      userId: session.user.id,
      action: "campaign.test_sent",
      entity: "campaign",
      entityId: id,
      metadata: { to },
    });

    return NextResponse.json({ ok: true, gmailMessageId });
  } catch (error) {
    return apiError(error);
  }
}
