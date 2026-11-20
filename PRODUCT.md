# Product

<!-- impeccable:product-schema 1 -->

> Draft from `/impeccable init`, 20 Nov 2026. Filled in from the repo and project notes. Items marked **(to confirm)** are inferred and still need Ben's answer.

## Platform

web

Mobile-first web app, tested as an iPhone Safari Home Screen app (GitHub Pages). A native iOS app (Xcode or Expo) is a possible later step, not decided. **(to confirm)**

## Users

- **Primary:** football (soccer) card collectors who own numbered parallels, autos and graded slabs, and want to know what their cards are worth. Ben (@bloopercollects, Singapore) is the first user and the model user. **(to confirm: hobby collectors in Singapore/SEA first, or global from day one?)**
- **Secondary:** followers of Ben's TikTok and Instagram who land on the public Display page from his bio link, browse his cards, and may buy or make an offer.
- Two styles of use, both supported by the app's Easy/Pro switch: **Easy** ("see my cards, what they're worth, and show them off"; big photos, plain words) and **Pro** (trading-app density: % change, breakdowns, every tool).

## Product Purpose

Cappd tracks a football card collection and its value in one place: what each card cost, what it last sold for, and how the whole collection is moving. It also lets a collector show their cards off and sell them. Success for the closed beta (target Fri 15 Jan 2027): collectors add their own cards, come back regularly, and trust the values they see.

## Positioning

**(to confirm)** Football-first, where most trackers are built around US sports and Pokémon. Inferred differentiators:
- numbered parallels and print runs are first-class, with a community **Card Finder** (pull registry) showing which copies of a parallel have been found;
- **news that moves your cards**: football headlines ranked by the players in the user's own collection;
- a shareable **Display** of the collection that doubles as a shop window.

## Operating Context

- Used on a phone, often next to the cards, during breaks, after pulls, and while posting to TikTok/IG.
- Values are shown in Singapore dollars (S$). eBay sold listings in USD are converted.
- Collections are imported from a spreadsheet (Ben's "Cards v2" sheet, CSV) or added card by card.
- Grading flow: Raw → To be graded → At grader → Graded (PSA, BGS, SGC, CGC, TAG).

## Capabilities and Constraints

- **Main app** (`/`, `src/app.js` → `index.html` via `scripts/build.py`): Home (value hero, top movers, card of the day), Collection, Display, Add card, Me. Tools: grading calculator ("Grade or not?"), Card Finder, News, Trophy cabinet (streaks and badges), backup/export.
- **Public Display page** (`/display/`): Ben's TikTok bio link. For sale, PC and Sold tabs, Buy / Make an offer, bundle offers, launch-list sign-up. Other features are shown as "In development".
- Data stays in the browser (localStorage key `slabfolio-web-v1`). There are no accounts or a server. Users back up with Export.
- News refreshes every 6 hours from publisher RSS. Only the headline, source, link and date are stored, never article text.
- Card Finder reports are GitHub issues moderated by Ben (verified / rejected / fake labels).
- **Prices:** no live price feed yet. Licensed sources (SportsCardsPro, Card Hedge) are pending. No scraping or bots, ever.
- Repo, URL, storage key and the `slabfolio-find` marker keep the old "Slabfolio" name on purpose. Don't rename them.
- Feature freeze for v1: Display + Collection + comp sprint. News and the registry follow after the beta.

## Brand Commitments

- Name: **Cappd** (cap = football caps + market cap). Tagline idea: "Your cards, capped and valued." Domain: getcappd.com.
- Current look (PR #15, 18 Nov 2026): dark navy and gold, Archivo font, cap logo. Visual details belong in DESIGN.md, not here.
- Voice: plain, friendly, collector-to-collector. Easy mode avoids jargon.

## Evidence on Hand

- Real cards and photos from Ben's own collection (project files; `display/img/`), including PSA 10 slabs: Archie Gray Orange Lava auto 22/25 (pop 2), Schweinsteiger Inception auto 32/49 (pop 5).
- Real eBay last-sold comps for the Display cards (6 Nov 2026).
- The main app opens with a **sample** collection (`data/sample-cards.json`). It's labelled as sample data and holds no personal data.
- No testimonials, user counts, press or partnerships exist yet. Don't invent any.

## Product Principles

1. **Values you can trust.** Show where a price came from and how old it is. Never present a guess as a sale.
2. **Football-first.** Players, clubs and numbered parallels lead, not generic "items".
3. **Easy first, Pro when wanted.** A new collector should never need jargon. Depth is opt-in.
4. **Your cards are the hero.** Photos of the real cards beat generated art. Generated faces are only a fallback.
5. **Private by default.** Data stays on the device. Cert numbers are never published.

## Accessibility & Inclusion

No product-specific standard has been set. The app already respects `prefers-reduced-motion` and labels charts for screen readers. Keep touch targets phone-sized and values readable in sunlight. **(to confirm)**
