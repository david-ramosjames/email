import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { normalizeEmail } from "@/lib/email";
import { suppressionSchema } from "@/lib/schemas";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await requireAdmin();
    const suppressions = await prisma.suppressionList.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    return NextResponse.json({ suppressions });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    const body = suppressionSchema.parse(await request.json());
    const suppression = await prisma.suppressionList.upsert({
      where: { normalizedEmail: normalizeEmail(body.email) },
      update: {
        reason: body.reason || "Manual suppression",
        source: "manual",
        createdById: session.user.id,
      },
      create: {
        email: body.email,
        normalizedEmail: normalizeEmail(body.email),
        reason: body.reason || "Manual suppression",
        source: "manual",
        createdById: session.user.id,
      },
    });

    await prisma.campaignRecipient.updateMany({
      where: {
        recipient: { normalizedEmail: suppression.normalizedEmail },
        status: { in: ["pending", "queued"] },
      },
      data: {
        status: "skipped",
        skippedAt: new Date(),
        errorMessage: "Recipient is on the suppression list.",
      },
    });

    await auditLog({
      userId: session.user.id,
      action: "suppression.created",
      entity: "suppression_list",
      entityId: suppression.id,
      metadata: { email: body.email },
    });

    return NextResponse.json({ suppression }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
