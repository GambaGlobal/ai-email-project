import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminNav } from "./components/admin-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Email Admin"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="admin-shell">
          <AdminNav />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
