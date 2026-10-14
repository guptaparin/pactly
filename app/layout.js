import "./globals.css";
export const metadata = { title: "Pactly — AI escrow for informal deals", description: "Turn any chat deal into a PayPal-backed escrow pact." };
export default function RootLayout({ children }) {
  return (
    <html lang="en"><body><div className="wrap">
      <nav>
        <a href="/" className="logo"><span className="seal">P</span>Pactly</a>
        <div className="links"><a href="/">New pact</a><a href="/dashboard">Ledger</a></div>
      </nav>
      {children}
    </div></body></html>
  );
}
