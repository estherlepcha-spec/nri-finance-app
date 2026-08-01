/**
 * LandingPage.jsx
 *
 * Marketing landing page structure for an NRI / Expat Finance web app.
 * Built as a single-file React component with plain CSS (no Tailwind
 * dependency assumed) so you can drop it into any React/Next.js project.
 *
 * WHERE TO PLUG IN YOUR REAL ASSETS:
 *   - Hero screenshot:      replace `heroScreenshot` src
 *   - Feature screenshots:  replace items in `features` array
 *   - Demo video:           replace `demoVideoUrl` (use a Loom embed URL,
 *                            a self-hosted <video>, or YouTube embed)
 *   - Testimonials:         replace `testimonials` array with real reviews
 *                            (or swap this section for a Senja embed)
 *
 * Design direction: dual-currency identity is the core idea of the product,
 * so the visual language leans on two anchored tones (deep indigo "home"
 * side, warm amber "abroad" side) meeting at a center line — a quiet visual
 * metaphor for "one person, two financial worlds" without being literal
 * about it (no flags, no globe icons).
 */

import { useState } from "react";

const heroScreenshot = "/assets/hero-dashboard.png"; // replace with your real screenshot
const demoVideoUrl = "/assets/demo.mp4"; // or a Loom/YouTube embed URL

const features = [
  {
    title: "One balance, every currency",
    description:
      "See your NRE, NRO, and foreign accounts converted and combined in real time.",
    screenshot: "/assets/screenshot-balance.png",
  },
  {
    title: "Remittance tracking",
    description:
      "Know exactly what rate you got, what fees you paid, and what's still pending.",
    screenshot: "/assets/screenshot-transfers.png",
  },
  {
    title: "Residency-aware tax view",
    description:
      "A running picture of your tax status so nothing surprises you at filing time.",
    screenshot: "/assets/screenshot-tax.png",
  },
];

const testimonials = [
  {
    quote:
      "I finally stopped juggling three banking apps and a spreadsheet to know what I actually have.",
    name: "Ananya R.",
    location: "Dubai, UAE",
  },
  {
    quote:
      "The remittance tracker alone saved me from a bad exchange rate twice in one month.",
    name: "Vikram S.",
    location: "London, UK",
  },
  {
    quote: "Built for people like me, not adapted from a generic budgeting app.",
    name: "Priya M.",
    location: "Toronto, Canada",
  },
];

export default function LandingPage() {
  const [videoPlaying, setVideoPlaying] = useState(false);

  return (
    <div className="landing">
      {/* HERO */}
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">For Indians living abroad</span>
          <h1>
            Your money, <em>wherever</em> home is.
          </h1>
          <p>
            One dashboard for every account, every currency, and every
            transfer between the two lives you're managing.
          </p>
          <div className="hero-actions">
            <button className="cta-primary">Get started free</button>
            <button className="cta-secondary" onClick={() => setVideoPlaying(true)}>
              ▶ Watch 60-second demo
            </button>
          </div>
        </div>
        <div className="hero-visual">
          <img src={heroScreenshot} alt="App dashboard showing combined balances" />
        </div>
      </section>

      {/* DEMO VIDEO */}
      <section className="demo">
        <h2>See it in action</h2>
        <div className="video-frame">
          {videoPlaying ? (
            <video src={demoVideoUrl} controls autoPlay />
          ) : (
            <button className="video-thumb" onClick={() => setVideoPlaying(true)}>
              <img src={heroScreenshot} alt="Preview of demo video" />
              <span className="play-icon">▶</span>
            </button>
          )}
        </div>
      </section>

      {/* FEATURES WITH SCREENSHOTS */}
      <section className="features">
        {features.map((f, i) => (
          <div
            className={`feature-row ${i % 2 === 1 ? "reverse" : ""}`}
            key={f.title}
          >
            <div className="feature-copy">
              <h3>{f.title}</h3>
              <p>{f.description}</p>
            </div>
            <div className="feature-visual">
              <img src={f.screenshot} alt={f.title} />
            </div>
          </div>
        ))}
      </section>

      {/* TESTIMONIALS */}
      <section className="testimonials">
        <h2>Trusted by expats managing money across borders</h2>
        <div className="testimonial-grid">
          {testimonials.map((t) => (
            <blockquote key={t.name} className="testimonial-card">
              <p>"{t.quote}"</p>
              <footer>
                <strong>{t.name}</strong>
                <span>{t.location}</span>
              </footer>
            </blockquote>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="final-cta">
        <h2>Stop reconciling two lives in a spreadsheet.</h2>
        <button className="cta-primary">Create your free account</button>
      </section>

      <style>{`
        .landing { font-family: 'Inter', system-ui, sans-serif; color: #1a1a2e; }
        .eyebrow { color: #b8752f; font-weight: 600; font-size: 0.85rem; letter-spacing: 0.05em; text-transform: uppercase; }
        .hero { display: flex; align-items: center; gap: 3rem; padding: 5rem 8vw; background: linear-gradient(120deg, #1e2255 0%, #1e2255 48%, #f4ede1 52%, #f4ede1 100%); }
        .hero-copy { flex: 1; color: white; }
        .hero-copy h1 { font-size: 3rem; line-height: 1.1; margin: 0.5rem 0 1rem; }
        .hero-copy em { color: #e8a855; font-style: normal; }
        .hero-copy p { font-size: 1.1rem; opacity: 0.85; max-width: 480px; }
        .hero-actions { display: flex; gap: 1rem; margin-top: 2rem; }
        .cta-primary { background: #e8a855; color: #1e2255; border: none; padding: 0.9rem 1.8rem; border-radius: 8px; font-weight: 700; cursor: pointer; }
        .cta-secondary { background: transparent; color: white; border: 1px solid rgba(255,255,255,0.4); padding: 0.9rem 1.8rem; border-radius: 8px; font-weight: 600; cursor: pointer; }
        .hero-visual { flex: 1; }
        .hero-visual img { width: 100%; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
        .demo { text-align: center; padding: 5rem 8vw; background: #f4ede1; }
        .video-frame { max-width: 800px; margin: 2rem auto 0; position: relative; }
        .video-thumb { position: relative; border: none; padding: 0; cursor: pointer; width: 100%; }
        .video-thumb img { width: 100%; border-radius: 12px; }
        .play-icon { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #e8a855; color: #1e2255; width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
        .features { padding: 5rem 8vw; display: flex; flex-direction: column; gap: 5rem; }
        .feature-row { display: flex; align-items: center; gap: 3rem; }
        .feature-row.reverse { flex-direction: row-reverse; }
        .feature-copy { flex: 1; }
        .feature-copy h3 { font-size: 1.8rem; margin-bottom: 0.75rem; }
        .feature-visual { flex: 1; }
        .feature-visual img { width: 100%; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.12); }
        .testimonials { background: #1e2255; color: white; padding: 5rem 8vw; text-align: center; }
        .testimonial-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem; margin-top: 2.5rem; }
        .testimonial-card { background: rgba(255,255,255,0.06); border-radius: 12px; padding: 1.5rem; text-align: left; }
        .testimonial-card p { font-size: 1rem; line-height: 1.5; }
        .testimonial-card footer { margin-top: 1rem; display: flex; flex-direction: column; }
        .testimonial-card footer span { opacity: 0.6; font-size: 0.85rem; }
        .final-cta { text-align: center; padding: 5rem 8vw; }
        .final-cta h2 { font-size: 2rem; margin-bottom: 1.5rem; }
        @media (max-width: 768px) {
          .hero, .feature-row, .feature-row.reverse { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}
