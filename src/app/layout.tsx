import type { Metadata, Viewport } from "next";
import { Inria_Serif, Jura } from "next/font/google";
import "./globals.css";

// next/font baixa as fontes no BUILD e as serve localmente: no dia, nada depende de internet.
const texto = Inria_Serif({
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  style: ["normal", "italic"],
  variable: "--fonte-texto",
  display: "swap",
});

// Reserva visual para a Resagokr enquanto os arquivos oficiais não estiverem em public/fonts.
const tituloReserva = Jura({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--fonte-titulo-reserva",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Roleta Constelação · Convenção 2026",
  description: "Roleta de brindes da confraternização OncologyGroup — A nossa força é brilhar juntos.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a2248",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" translate="no" className={`${texto.variable} ${tituloReserva.variable}`}>
      <body>{children}</body>
    </html>
  );
}
