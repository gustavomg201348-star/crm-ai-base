import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM AI Base",
  description: "CRM operacional com atendimento, pipeline, credito e IA."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
