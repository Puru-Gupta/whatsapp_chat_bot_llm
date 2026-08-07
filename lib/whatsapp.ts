const WHATSAPP_API_VERSION = "v22.0";
const WHATSAPP_API_BASE = "https://graph.facebook.com";
const MAX_TEXT_LENGTH = 4096;

export async function sendWhatsAppMessage(
  to: string,
  body: string
): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error("WhatsApp credentials not configured");
  }

  const res = await fetch(
    `${WHATSAPP_API_BASE}/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: body.slice(0, MAX_TEXT_LENGTH) },
      }),
      signal: AbortSignal.timeout(20_000),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`WhatsApp send failed: ${error}`);
  }
}

export function verifyWebhookToken(token: string): boolean {
  return token === process.env.WHATSAPP_VERIFY_TOKEN;
}
