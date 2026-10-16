"use client";
import { useState } from "react";

const SAMPLE = `Riya (buyer): hey! saw your work on insta. need a logo for my bakery "Crumb & Co"
Arjun (designer): sure! I can do 3 logo concepts, then final files after you pick one
Riya: price?
Arjun: $120 total. $50 for the 3 concepts, $70 for the final in PNG + SVG, transparent bg
Riya: deadline?
Arjun: concepts by Oct 20, final by Oct 25
Riya: deal 👍 must have a croissant somewhere and use warm brown colors`;

export default function Home() {
  const [chat, setChat] = useState("");
  const [sellerEmail, setSellerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function create() {
    setBusy(true); setErr("");
    const r = await fetch("/api/pacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat, sellerEmail }) });
    const d = await r.json();
    if (!r.ok) { setErr(d.error); setBusy(false); return; }
    location.href = `/pact/${d.id}`;
  }

  return (
    <>
      <h1>Deals made in DMs,<br />protected like contracts.</h1>
      <p className="lede">Paste the chat where you agreed a deal. Pactly&apos;s AI agent writes the contract, PayPal holds the money, and the agent only releases it when the work actually matches what was promised.</p>
      <div className="row" style={{ marginTop: 18 }}>
        <a className="btn" href="#start">Create a pact →</a>
        <a className="btn" style={{ background: "transparent", color: "var(--ink)", border: "1px solid var(--line)" }} href="/dashboard">See the ledger demo</a>
      </div>
      <div className="grid3">
        <div className="card"><b>The buyer&apos;s fear</b><p className="small muted">“I paid upfront in a DM and the seller vanished.” Chat deals have no protection: no contract, no proof, no refund path.</p></div>
        <div className="card"><b>The seller&apos;s fear</b><p className="small muted">“I delivered the work and got ghosted.” Freelancers working first carry all the risk of non-payment.</p></div>
        <div className="card"><b>Why existing escrow fails</b><p className="small muted">Traditional escrow means forms, fees and days of manual review: far too heavy for a $50 logo or a $300 website.</p></div>
      </div>
      <div className="grid3 stats">
        <div><b>$2.7B</b><span>lost by Americans to scams that started on social media since 2021; online shopping was the most-reported type. <a href="https://securityboulevard.com/2023/10/ftc-american-lost-2-7-billion-since-2021-to-social-media-scams" target="_blank" rel="noreferrer">FTC data, 2023</a></span></div>
        <div><b>44%</b><span>of social-media scam reports in H1 2023 were shopping scams, mostly goods that never arrived. <a href="https://securityboulevard.com/2023/10/ftc-american-lost-2-7-billion-since-2021-to-social-media-scams" target="_blank" rel="noreferrer">FTC data, 2023</a></span></div>
        <div><b>62%</b><span>of New York freelancers have lost wages to a client who never paid; fewer than 1% took legal action. <a href="https://authorsguild.org/news/survey-finds-62-percent-of-ny-freelance-workers-have-lost-wages-due-to-nonpayment" target="_blank" rel="noreferrer">Freelancers Union et al., 2022</a></span></div>
      </div>
      <h2 style={{ marginTop: 34 }}>How Pactly works</h2>
      <div className="steps">
        <div><b>1</b>AI turns the chat into a pact with checkable criteria</div>
        <div><b>2</b>Buyer pays — PayPal <i>authorizes</i>, funds are held</div>
        <div><b>3</b>Seller delivers — AI verifies each criterion</div>
        <div><b>4</b>Agent captures, splits or returns the money</div>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>The agent also works on its own: it flags scam patterns before anyone pays, and voids the PayPal hold automatically if a deadline passes with no delivery.</p>
      <div className="card" id="start">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Paste the deal chat</h2>
          <button className="ghost" onClick={() => setChat(SAMPLE)}>Use sample chat</button>
        </div>
        <textarea value={chat} onChange={(e) => setChat(e.target.value)} placeholder="Copy the WhatsApp / Instagram / email thread here…" />
        <label>Seller&apos;s PayPal email (sandbox, optional — funds go here on release)</label>
        <input value={sellerEmail} onChange={(e) => setSellerEmail(e.target.value)} placeholder="seller@personal.example.com" />
        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={create} disabled={busy || !chat}>{busy ? "Agent is drafting the pact…" : "Draft pact with AI →"}</button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </>
  );
}
