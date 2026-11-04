import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import "./responsive.css";
import { ConfirmDialogHost } from "@/components/ui/confirm-dialog";

/** Fonte Hanken Grotesk, carregada pelo Next. */
const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Pesquisa Aqui",
  description: "Sistema de pesquisas",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f2f4f1",
};

/** Layout raiz do painel: fonte, idioma e estilos globais. */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={hankenGrotesk.variable}>
      <body>
        {children}
        <ConfirmDialogHost />
      </body>
    </html>
  );
}
