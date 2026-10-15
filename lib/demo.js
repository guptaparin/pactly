// Read-only demo pacts that show every lifecycle state. Clearly marked demo: true and never touch PayPal.
const day = (d) => new Date(Date.now() + d * 86400000).toISOString();
const date = (d) => day(d).slice(0, 10);
const ev = (d, actor, event, detail) => ({ at: day(d), actor, event, detail });

const base = (id, o) => ({
  id: `demo-${id}`, demo: true, currency: "USD", released: 0, riskFlags: [], riskScore: 6,
  createdAt: day(o.created ?? -5), updatedAt: day(-1), sellerEmail: "", chat: o.chat || "", ...o,
});

export function demoPacts() {
  return [
    base("logo", {
      title: "Bakery logo for Crumb & Co", buyer: "Riya", seller: "Arjun", amount: 120, status: "settled", released: 120,
      summary: "3 logo concepts with a croissant motif in warm browns, then final PNG + SVG files.", created: -9,
      milestones: [
        { name: "3 logo concepts", amount: 50, status: "released", releasedAmount: 50, deadline: date(-4),
          criteria: ["3 distinct concepts for 'Crumb & Co'", "Croissant element", "Warm brown palette"],
          verdict: { decision: "release", releasePercent: 100, summary: "All three concepts meet every criterion.",
            checks: [
              { criterion: "3 distinct concepts for 'Crumb & Co'", met: true, reason: "Three different layouts, each with the correct name." },
              { criterion: "Croissant element", met: true, reason: "Every concept includes a croissant icon." },
              { criterion: "Warm brown palette", met: true, reason: "Browns and cream throughout." }] } },
        { name: "Final files", amount: 70, status: "released", releasedAmount: 70, deadline: date(-1),
          criteria: ["PNG and SVG formats", "Transparent background"],
          verdict: { decision: "release", releasePercent: 100, summary: "Both formats delivered with transparency.",
            checks: [
              { criterion: "PNG and SVG formats", met: true, reason: "Both files listed in the delivery link." },
              { criterion: "Transparent background", met: true, reason: "Checkerboard preview visible in screenshot." }] } },
      ],
      audit: [
        ev(-9, "agent", "pact_drafted", "Extracted 2 milestone(s), risk 6/100"),
        ev(-9, "paypal", "funds_held", "Authorization for 120.00 USD"),
        ev(-5, "agent", "delivery_verified", "3 logo concepts: release (100%)"),
        ev(-5, "buyer", "funds_captured", "3 logo concepts: 50 USD to seller (100%)."),
        ev(-1, "agent", "delivery_verified", "Final files: release (100%)"),
        ev(-1, "buyer", "funds_captured", "Final files: 70 USD to seller (100%). Final capture."),
      ],
    }),
    base("website", {
      title: "Landing page for a yoga studio", buyer: "Meera", seller: "Kabir", amount: 300, status: "funded", released: 150,
      summary: "Responsive one-page site: design mockup first, then the coded and deployed page.", created: -6,
      milestones: [
        { name: "Figma mockup", amount: 150, status: "released", releasedAmount: 150, deadline: date(-2),
          criteria: ["Desktop and mobile mockups", "Class schedule section", "Booking button"] },
        { name: "Live website", amount: 150, status: "pending", deadline: date(4),
          criteria: ["Deployed at a public URL", "Matches approved mockup", "Works on mobile"] },
      ],
      audit: [
        ev(-6, "agent", "pact_drafted", "Extracted 2 milestone(s), risk 4/100"),
        ev(-6, "paypal", "funds_held", "Authorization for 300.00 USD"),
        ev(-2, "buyer", "funds_captured", "Figma mockup: 150 USD to seller (100%)."),
      ],
    }),
    base("video", {
      title: "Reel edit for a sneaker drop", buyer: "Dev", seller: "Sana", amount: 80, status: "funded",
      summary: "Edit a 30-second Instagram reel with captions and brand colours.", created: -3,
      milestones: [
        { name: "Edited reel", amount: 80, status: "verified", deadline: date(1),
          criteria: ["30 seconds or less", "Burned-in captions", "Brand colours red/black", "Vertical 9:16"],
          verdict: { decision: "partial", releasePercent: 75,
            summary: "Captions are missing. Add burned-in captions to receive the remaining 25%.",
            checks: [
              { criterion: "30 seconds or less", met: true, reason: "Timeline shows 0:28." },
              { criterion: "Burned-in captions", met: false, reason: "No captions visible in any frame." },
              { criterion: "Brand colours red/black", met: true, reason: "Title cards use red and black." },
              { criterion: "Vertical 9:16", met: true, reason: "Export settings show 1080x1920." }] } },
      ],
      audit: [
        ev(-3, "agent", "pact_drafted", "Extracted 1 milestone(s), risk 8/100"),
        ev(-3, "paypal", "funds_held", "Authorization for 80.00 USD"),
        ev(-0.2, "agent", "delivery_verified", "Edited reel: partial (75%) — captions missing"),
      ],
    }),
    base("tutor", {
      title: "4 calculus tutoring sessions", buyer: "Aman", seller: "Prof. Rao", amount: 60, status: "voided",
      summary: "Four one-hour online sessions before the mid-term.", created: -8,
      milestones: [
        { name: "4 sessions", amount: 60, status: "refunded", deadline: date(-2),
          criteria: ["4 sessions of 60 minutes", "Session notes shared"] },
      ],
      audit: [
        ev(-8, "agent", "pact_drafted", "Extracted 1 milestone(s), risk 12/100"),
        ev(-8, "paypal", "funds_held", "Authorization for 60.00 USD"),
        ev(-1, "agent", "deadline_enforced", "\"4 sessions\" was due with no delivery. Voided the PayPal authorization; 60.00 USD returned to buyer automatically."),
      ],
    }),
    base("phone", {
      title: "Used iPhone sold via Instagram DM", buyer: "Karan", seller: "@deals_hub_99", amount: 450, status: "draft",
      riskScore: 82, created: -0.5,
      riskFlags: [
        "Seller asks to move payment to a direct bank transfer 'to avoid fees'",
        "Price is far below market for the stated model",
        "Urgency pressure: '3 other buyers waiting, pay in 10 minutes'",
      ],
      summary: "Purchase of a used phone; seller pushes for off-platform payment.",
      milestones: [{ name: "Phone delivered", amount: 450, status: "pending", criteria: ["Tracking number provided", "IMEI matches listing"] }],
      audit: [ev(-0.5, "agent", "pact_drafted", "Extracted 1 milestone(s), risk 82/100 — 3 scam signals flagged")],
    }),
    base("translation", {
      title: "Translate a product manual to Spanish", buyer: "Lena", seller: "Diego", amount: 200, status: "disputed-demo",
      summary: "Translate a 20-page manual; native-level Spanish with consistent terminology.", created: -7,
      milestones: [
        { name: "Full translation", amount: 200, status: "disputed", deadline: date(-1),
          criteria: ["All 20 pages translated", "Consistent technical terms", "Formatting preserved"],
          dispute: { sellerPercent: 70, buyerSays: "Pages 15-20 look machine translated.", sellerSays: "All pages were translated by me and proof-read.",
            reasoning: "Verification confirms all pages were delivered and formatting is preserved, but terminology is inconsistent in the last section. 70% to the seller reflects the delivered work; 30% returns to the buyer for the revision needed." } },
      ],
      audit: [
        ev(-7, "agent", "pact_drafted", "Extracted 1 milestone(s), risk 5/100"),
        ev(-7, "paypal", "funds_held", "Authorization for 200.00 USD"),
        ev(-1, "agent", "mediation_proposed", "70% to seller — terminology inconsistent in final section"),
      ],
    }),
  ].map((p) => ({ ...p, status: p.status === "disputed-demo" ? "funded" : p.status }));
}
