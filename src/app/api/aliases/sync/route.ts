import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { syncSendAliases } from "@/lib/gmail";
import { requireAdmin } from "@/lib/session";

export async function POST() {
  try {
    const session = await requireAdmin();
    const aliases = await syncSendAliases(session.user.id);
    await auditLog({
      userId: session.user.id,
      action: "aliases.synced",
      entity: "send_alias",
      metadata: { count: aliases.length },
    });

    return NextResponse.json({ aliases });
  } catch (error) {
    return apiError(error);
  }
}
