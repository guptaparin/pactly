import "./globals.css";
export const metadata = { title: "Pactly — AI escrow for deals made in chats", description: "Turn any chat deal into a PayPal-backed escrow pact. Works on the web, inside Telegram groups, and for AI agents over MCP." };
export default function RootLayout({ children }) {
  return (
    <html lang="en"><body><div className="wrap">
      <nav>
        <a href="/" className="logo"><span className="seal">P</span>Pactly</a>
        <div className="links"><a href="/">New pact</a><a href="/connect">Connect</a><a href="/agent">Agent</a><a href="/dashboard">Control room</a></div>
      </nav>
      {children}
    </div></body></html>
  );
}
