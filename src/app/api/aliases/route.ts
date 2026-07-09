import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await requireAdmin();
    const aliases = await prisma.sendAlias.findMany({
      where: { userId: session.user.id },
      orderBy: [{ isDefault: "desc" }, { email: "asc" }],
    });

    return NextResponse.json({ aliases });
  } catch (error) {
    return apiError(error);
  }
}
