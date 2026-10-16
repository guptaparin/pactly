# Pactly demo video: script (target 2:45, hard limit 3:00)

**Setup before recording**
- Browser at 100% zoom, a clean window, no bookmarks bar, incognito (for a fresh PayPal login).
- Ledger → *Load demo pacts* done beforehand.
- Prepare 2 image sets: (A) 3 unrelated logos (wrong work) and (B) 3 real "Crumb & Co" croissant logos in brown.
- Record the screen with OBS (free) at 1080p. Record the voice separately if that's easier.
- **Music: none, or royalty-free only** (for example the YouTube Audio Library). No copyrighted tracks.
- Keep each scene tight; cut waiting time (AI or PayPal spinners) in editing.

| Time | Screen | Voiceover |
|---|---|---|
| **0:00–0:15** | Landing page hero, then scroll to the 3 dark stat cards | "Millions of deals now happen in DMs. Buyers pay first and get scammed; Americans lost 2.7 billion dollars to scams that started on social media. Sellers work first and get ghosted; 62% of freelancers have lost wages to clients who never paid." |
| **0:15–0:25** | "How Pactly works" 4 steps | "Pactly is an AI escrow agent on PayPal. Paste the chat, and the agent turns it into a contract. PayPal holds the money, and it only moves when the work matches the deal." |
| **0:25–0:45** | Click *Use sample chat* → *Draft pact with AI* → pact page | "Here's a real chat: a $120 bakery logo. In seconds the agent extracts two milestones, checkable acceptance criteria like 'croissant motif' and 'warm brown', the deadlines, and a scam-risk score." |
| **0:45–1:05** | Yellow PayPal button → sandbox login → approve → page shows **FUNDED, $120 held** | "The buyer pays with PayPal, but as an authorization, not a payment. The money is held, and the audit trail records the authorization ID." |
| **1:05–1:30** | Switch to Seller → upload set A → verdict with ✗ marks | "Now the seller delivers, but cuts corners: these are existing brand logos. The agent checks every criterion against the images and catches it: wrong business names, no croissant. Payment is withheld." |
| **1:30–1:45** | Buyer → *Ask seller to fix & resubmit* → Seller uploads set B → ✓✓✓✓ | "The buyer sends it back with one click; the money stays held. The seller fixes the work, and this time every check passes." |
| **1:45–2:00** | Buyer → *Accept verdict, release 100%* → $50 released / $70 held | "One click, and PayPal captures $50 from the authorization. $70 stays held for the final files." |
| **2:00–2:20** | Agent page → ask "Which pacts need my decision?" → then "Release the final files to Arjun" → proposal card → **Confirm** → ✓ | "You can also just talk to your agent. It reads your ledger with function calling, but it never moves money itself: it proposes, and you confirm." |
| **2:20–2:35** | Another funded pact → *Simulate missed deadline* → **VOIDED** | "And it acts on its own when it's safe: if a seller misses the deadline, the agent voids the PayPal authorization and the buyer's money is released automatically." |
| **2:35–2:45** | Ledger (AG Grid) with demo pacts, high-risk row highlighted | "Every pact, hold and decision in one ledger. Pactly: deals made in DMs, protected like contracts. Built with PayPal and Gemini." |

**Upload checklist**
- Title: *Pactly: AI escrow agent for deals made in DMs (PayPal + AI)*
- Visibility: **Public**
- Description: one line, plus the live demo and repo links
- Length under 3:00; check before uploading
