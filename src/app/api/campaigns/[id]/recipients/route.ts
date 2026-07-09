import { CampaignRecipientStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { normalizeEmail } from "@/lib/email";
import { recipientsImportSchema } from "@/lib/schemas";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    const { recipients } = recipientsImportSchema.parse(await request.json());
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!campaign) throw new Error("Campaign not found.");
    if (campaign.status !== "draft" && campaign.status !== "paused") {
      throw new Error("Recipients can only be imported before sending or while paused.");
    }

    const invalid: Array<{ email: string; reason: string }> = [];
    let imported = 0;
    let skipped = 0;

    for (const row of recipients) {
      const normalizedEmail = normalizeEmail(row.email);
      const suppressed = await prisma.suppressionList.findUnique({
        where: { normalizedEmail },
      });

      const recipient = await prisma.recipient.upsert({
        where: { normalizedEmail },
        update: {
          email: row.email,
          firstName: row.first_name || null,
          lastName: row.last_name || null,
          firmName: row.firm_name || null,
          city: row.city || null,
          practiceArea: row.practice_area || null,
          notes: row.notes || null,
        },
        create: {
          email: row.email,
          normalizedEmail,
          firstName: row.first_name || null,
          lastName: row.last_name || null,
          firmName: row.firm_name || null,
          city: row.city || null,
          practiceArea: row.practice_area || null,
          notes: row.notes || null,
        },
      });

      const existing = await prisma.campaignRecipient.findUnique({
        where: {
          campaignId_recipientId: {
            campaignId: id,
            recipientId: recipient.id,
          },
        },
      });

      if (existing) {
        skipped += 1;
        continue;
      }

      await prisma.campaignRecipient.create({
        data: {
          campaignId: id,
          recipientId: recipient.id,
          personalization: row,
          status: suppressed ? CampaignRecipientStatus.skipped : CampaignRecipientStatus.pending,
          skippedAt: suppressed ? new Date() : null,
          errorMessage: suppressed ? "Recipient is on the suppression list." : null,
        },
      });

      imported += 1;
      if (suppressed) {
        invalid.push({ email: row.email, reason: "Suppressed recipient imported as skipped." });
      }
    }

    await auditLog({
      userId: session.user.id,
      action: "recipients.imported",
      entity: "campaign",
      entityId: id,
      metadata: { imported, skipped },
    });

    return NextResponse.json({ imported, skipped, warnings: invalid });
  } catch (error) {
    return apiError(error);
  }
}
