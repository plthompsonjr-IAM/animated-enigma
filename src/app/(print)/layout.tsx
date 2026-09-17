/**
 * Chrome-free layout for internal printable documents (contracts, and future
 * printable records). These routes sit under the same protected paths as the
 * app — middleware still requires authentication — but render without the
 * sidebar, header, or mobile nav so nothing bleeds into the saved PDF.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-white">{children}</div>;
}
