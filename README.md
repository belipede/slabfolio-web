# Slabfolio web prototype

A one-page test version of Slabfolio for trying on iPhone Safari. Published with GitHub Pages at https://belipede.github.io/slabfolio-web/.
It opens with a sample collection; import your own sheet from Me. Your collection is stored only in the browser (localStorage); use Export in the app to back it up.
Report bugs and ideas as issues.

## Editing the app

The app source is `src/app.js` and `src/head.html`; data lives in `data/`. After changing either, rebuild `index.html`:

    python3 scripts/build.py

## News

`data/news.json` is refreshed every 6 hours by the **Refresh news** workflow (`scripts/update_news.py`), from the publisher feeds listed in `data/news-feeds.json`.
Only the headline, publisher, link and date are kept, plus name-like words used to match headlines to the players in each person's collection on their phone.
Article text is never stored. Run it by hand from Actions › Refresh news › Run workflow.

## Card Finder public registry

**Share on the public registry** in the app opens a pre-filled GitHub issue. The reporter adds photos and posts it.
The **Update shared finds** workflow (`scripts/update_finds.py`) turns these issues into `data/finds.json`, which every copy of the app loads.

To moderate, open the issue and add a label:

- `verified`: the proof checks out. The first verified report of each numbered copy earns points.
- `rejected`: not good enough, or a duplicate. It disappears from the registry.
- `fake`: a fake report. It disappears and costs the reporter 50 points.

Open issues with no label show as pending. Once a find is published as verified its card details are locked, so later edits to the issue can't move it.
