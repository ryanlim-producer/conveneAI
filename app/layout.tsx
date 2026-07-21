import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "conveneAI — Meeting Transcription",
  description: "Meeting Transcription + Action Items Platform",
};

// The UI is light-theme only (no theme toggle is wired up), so tell the
// browser explicitly — otherwise Android/Chrome's auto "force dark" content
// inversion kicks in on system-dark devices and mangles subtle shadows and
// borders into solid black bars.
export const viewport: Viewport = {
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
