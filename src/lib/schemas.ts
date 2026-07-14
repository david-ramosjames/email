import { z } from "zod";

export const campaignSchema = z.object({
  name: z.string().min(1),
  subjectLine: z.string().min(1),
  fromName: z.string().min(1),
  fromEmailAlias: z.string().email(),
  replyToEmail: z.union([z.string().email(), z.literal("")]).optional(),
  htmlBody: z.string().min(1),
  textBody: z.string().min(1),
  businessIdentity: z.string().min(1),
  mailingAddress: z.string().min(1),
  trackOpens: z.boolean().default(true),
  throttlePerHour: z.coerce.number().int().min(1).max(50).default(25),
  errorRateStopPercent: z.coerce.number().int().min(1).max(100).default(20),
});

export const campaignPatchSchema = campaignSchema.partial();

export function normalizeCampaignInput(input: z.infer<typeof campaignSchema>) {
  return {
    ...input,
    fromEmailAlias: input.fromEmailAlias.toLowerCase(),
    replyToEmail: input.replyToEmail?.trim() || input.fromEmailAlias.toLowerCase(),
  };
}

export function normalizeCampaignPatchInput(
  input: z.infer<typeof campaignPatchSchema>,
) {
  const normalized = { ...input };

  if (normalized.fromEmailAlias) {
    normalized.fromEmailAlias = normalized.fromEmailAlias.toLowerCase();
  }

  if (normalized.replyToEmail === "" && normalized.fromEmailAlias) {
    normalized.replyToEmail = normalized.fromEmailAlias;
  }

  return normalized;
}

export const recipientSchema = z.object({
  email: z.string().email(),
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  firm_name: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  practice_area: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const recipientsImportSchema = z.object({
  recipients: z.array(recipientSchema).min(1),
});

export const suppressionSchema = z.object({
  email: z.string().email(),
  reason: z.string().optional(),
});
