"use client";
import { useEffect, useState } from "react";

export default function Connect() {
  const [cfg, setCfg] = useState({});
  const [origin, setOrigin] = useState("https://pactly-vert.vercel.app");
  const [copied, setCopied] = useState("");
  useEffect(() => { setOrigin(location.origin); fetch("/api/config").then((r) => r.json()).then(setCfg); }, []);
  const mcpUrl = `${origin}/api/mcp`;
  const copy = (k, t) => { navigator.clipboard?.writeText(t); setCopied(k); setTimeout(() => setCopied(""), 1500); };
  const bot = cfg.telegramBot;

  const curl = `curl -s ${mcpUrl} -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"tools/call",
  "params":{"name":"create_escrow_pact","arguments":{
    "title":"Transcribe 2 interviews","amount":40,"seller":"Fatima",
    "milestones":[{"name":"Transcripts","amount":40,
      "criteria":["2 transcripts","Speaker labels on every turn"]}]}}}'`;

  return (
    <>
      <h1 style={{ fontSize: 44 }}>Use Pactly where the deal happens</h1>
      <p className="lede">Deals don&apos;t start on escrow websites. They start in group chats, DMs and, more and more, between AI agents. Pactly meets them there; the money rules stay the same everywhere.</p>

      <div className="card">
        <span className="src src-tg tag">Telegram</span>
        <h2>Add the bot to your chat</h2>
        <ol className="small">
          <li>Add {bot ? <a href={`https://t.me/${bot}?startgroup=true`} target="_blank" rel="noreferrer"><b>@{bot}</b></a> : <b>the Pactly bot</b>} to the group where buyer and seller are talking (or forward it the messages in a DM).</li>
          <li>Agree the deal as you normally would. When someone says “deal 👍”, the bot offers to protect it, or anyone can send <code>/pact</code>.</li>
          <li>Buyer and seller each tap their role. The buyer taps <b>Fund with PayPal</b>; the money is <b>held</b>, not paid.</li>
          <li>The seller sends <code>/deliver</code> with a note, links, photos or <code>tracking: NUMBER</code>. The AI checks every criterion and posts the verdict.</li>
          <li>Only the buyer&apos;s tap releases money. Missed deadline? The agent voids the hold and refunds the buyer on its own.</li>
        </ol>
        <div className="row">
          {bot && <a className="btn" href={`https://t.me/${bot}?startgroup=true`} target="_blank" rel="noreferrer">Add @{bot} to a group →</a>}
          {bot && <a className="btn" style={{ background: "transparent", color: "var(--ink)", border: "1px solid var(--line)" }} href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">Open a DM</a>}
          {!bot && <span className="small muted">Set <code>TELEGRAM_BOT_USERNAME</code> to show the bot link here.</span>}
        </div>
      </div>

      <div className="card">
        <span className="src src-mcp tag">AI agents · MCP</span>
        <h2>Give any AI agent escrow</h2>
        <p className="small">Pactly is a remote MCP server. An agent can hire a human (or another agent), open a pact, send its owner the funding link, relay the delivery for verification and settle it, all inside rules the agent can&apos;t bend:</p>
        <ul className="small">
          <li>Funding always needs a human approving in PayPal.</li>
          <li>An agent releases money only if the buyer ticked “let AI agents release” while funding, never above the verifier&apos;s certified percentage, and never on a flagged delivery.</li>
          <li>Returning money to the buyer is always allowed.</li>
        </ul>
        <label>Server URL (Streamable HTTP){cfg.mcpNeedsKey ? " · send Authorization: Bearer <MCP_API_KEY>" : ""}</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input readOnly value={mcpUrl} onFocus={(e) => e.target.select()} />
          <button className="ghost" onClick={() => copy("url", mcpUrl)}>{copied === "url" ? "Copied" : "Copy"}</button>
        </div>
        <p className="small muted">Claude: add it as a custom connector with this URL. Claude Code:</p>
        <pre className="code">{`claude mcp add --transport http pactly ${mcpUrl}`}</pre>
        <p className="small muted">Cursor and other MCP clients (<code>mcp.json</code>):</p>
        <pre className="code">{JSON.stringify({ mcpServers: { pactly: { url: mcpUrl } } }, null, 2)}</pre>
        <p className="small muted">Tools: <code>create_escrow_pact</code>, <code>list_pacts</code>, <code>get_pact</code>, <code>submit_delivery</code>, <code>release_milestone</code>, <code>request_revision</code>, <code>open_dispute</code>, <code>cancel_pact</code>. Try it raw:</p>
        <pre className="code">{curl}</pre>
      </div>

      <div className="card">
        <span className="src src-web tag">Web</span>
        <h2>Paste a chat</h2>
        <p className="small">No bot, no agent? <a href="/#start">Paste the conversation</a> from WhatsApp, Instagram or email, and Pactly drafts the pact in seconds. Manage everything from the <a href="/dashboard">control room</a> or just <a href="/agent">talk to your agent</a>.</p>
      </div>
    </>
  );
}
