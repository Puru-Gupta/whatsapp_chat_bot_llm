import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AQLI WhatsApp Chatbot",
  description: "AI-powered WhatsApp support with knowledge base",
  icons: [{ rel: "icon", url: "/icon.svg", type: "image/svg+xml" }],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#f4f6f1] text-slate-950 antialiased">{children}</body>
    </html>
  );
}
