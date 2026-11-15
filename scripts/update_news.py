"""Refresh data/news.json from publisher RSS/Atom feeds.

Keeps only what a feed reader shows: headline, publisher, link and date.
Article text is never stored. A short list of name-like words from the
headline and teaser ("n") is kept so the app can match headlines to players
in each person's own collection on their phone.

Run: python3 scripts/update_news.py [--dry-run] [--fixtures DIR]
"""
import argparse, datetime as dt, email.utils, gzip, html, json, pathlib, re, sys, unicodedata
import urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'news.json'
FEEDS = json.loads((ROOT / 'data' / 'news-feeds.json').read_text())
UA = 'SlabfolioNews/0.2 (+https://github.com/belipede/slabfolio-web)'
MAX_AGE_DAYS = 14
MAX_FOOTBALL, MAX_CARDS = 400, 60

# card-news items are only kept when they are about football cards
CARD_KEEP = re.compile(r'soccer|football|uefa|premier league|\bepl\b|la liga|bundesliga|serie a|\bmls\b|world cup|champions league|'
                       r'merlin|topps chrome ucc|club competitions|panini prizm (?:epl|premier|world cup)|select fifa|donruss soccer|'
                       r'naturally|inception|pristine|museum|royalty|finest|deco', re.I)
CARD_DROP = re.compile(r'\bnfl\b|nba|mlb|nhl|baseball|basketball|hockey|pok[eé]mon|magic: the gathering|wrestling|ufc|f1\b|formula 1|nascar|golf', re.I)
CARD_TAGS = [(r'topps', 'Topps'), (r'panini', 'Panini'), (r'futera', 'Futera'), (r'checklist', 'Checklist'), (r'release|launch|drops?\b|preview|first look', 'Release')]

NS = {'atom': 'http://www.w3.org/2005/Atom', 'media': 'http://search.yahoo.com/mrss/', 'dc': 'http://purl.org/dc/elements/1.1/'}
STOP = set('The A An And Of In On At To For With From By As After Before Over Under Into Out Up Down Vs V Is Are Was Were Be Been Has Have Had '
           'His Her Their Its Our Your My We He She They It This That These Those What Who Why How When Where Which Will Would Can Could Should '
           'May Might Must Not No Yes All Any Some More Most Less New Old First Last Next Live Watch Report Reports Says Said Exclusive Analysis '
           'Opinion Video Podcast Gallery Quiz Transfer Transfers News Football Soccer Premier League Cup Champions January February March April '
           'June July August September October November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday'.split())


def clean(s):
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))
    return re.sub(r'\s+', ' ', s).strip()


def fold(s):
    return unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()


def names(*texts):
    """Lower-case, accent-free capitalised words (and particles like 'van', 'de') from headline + teaser."""
    out = set()
    for t in texts:
        for w in re.findall(r"[A-ZÀ-ɏ][\w'À-ɏ-]+|\b(?:van|de|der|den|da|di|dos|el|al|ten|ter)\b", t):
            w = w.strip("'-")
            if w in STOP or len(w) < 2:
                continue
            out.add(fold(w).removesuffix("'s"))
    return sorted(out)


def when(s):
    if not s:
        return None
    try:
        d = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = dt.datetime.fromisoformat(s.strip().replace('Z', '+00:00'))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone.utc)


def parse(xml_bytes):
    root = ET.fromstring(xml_bytes)
    items = []
    for it in root.iter('item'):  # RSS 2.0
        items.append(dict(t=it.findtext('title'), u=it.findtext('link') or it.findtext('guid'),
                          d=it.findtext('pubDate') or it.findtext('dc:date', namespaces=NS),
                          x=it.findtext('description')))
    for it in root.iter('{%s}entry' % NS['atom']):  # Atom
        link = it.find("atom:link[@rel='alternate']", NS)
        if link is None:
            link = it.find('atom:link', NS)
        items.append(dict(t=it.findtext('atom:title', namespaces=NS), u=link.get('href') if link is not None else None,
                          d=it.findtext('atom:published', namespaces=NS) or it.findtext('atom:updated', namespaces=NS),
                          x=it.findtext('atom:summary', namespaces=NS)))
    return items


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5'})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read()
    return gzip.decompress(body) if body[:2] == b'\x1f\x8b' else body  # some servers gzip even when not asked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='print a summary, do not write data/news.json')
    ap.add_argument('--fixtures', help='read <feed id>.xml files from this folder instead of the web (for tests)')
    a = ap.parse_args()

    now = dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=MAX_AGE_DAYS)
    try:
        old = json.loads(OUT.read_text())
    except (FileNotFoundError, ValueError):
        old = {}
    old_items = old.get('items', []) if isinstance(old.get('items'), list) else []

    fresh, report, ok = [], [], 0
    for f in FEEDS:
        try:
            raw = (pathlib.Path(a.fixtures) / f"{f['id']}.xml").read_bytes() if a.fixtures else fetch(f['url'])
            got = parse(raw)
            ok += 1
        except Exception as e:  # one bad feed must not stop the rest
            report.append(f"  FAIL {f['id']}: {type(e).__name__}: {e}")
            continue
        kept = 0
        for it in got:
            t, u = clean(it['t']), (it['u'] or '').strip()
            d = when(it['d']) or now
            if not t or not u.startswith('http') or d < cutoff:
                continue
            teaser = clean(it['x'])[:400]
            row = dict(k=f['kind'], t=t[:200], s=f['name'], u=u, d=d.strftime('%Y-%m-%dT%H:%M:%SZ'))
            if f['kind'] == 'cards':
                blob = t + ' ' + teaser
                if not CARD_KEEP.search(blob) or CARD_DROP.search(t):
                    continue
                row['tag'] = next((n for p, n in CARD_TAGS if re.search(p, blob, re.I)), 'Cards')
            row['n'] = names(t, teaser)
            fresh.append(row)
            kept += 1
        report.append(f"  ok   {f['id']}: {len(got)} items, kept {kept}")

    if ok == 0:
        print('\n'.join(report))
        sys.exit('No feed could be read; leaving data/news.json as it is.')

    # merge with what we had so headlines don't vanish when a feed rotates, newest first, one per link
    by_url = {}
    for row in sorted(old_items + fresh, key=lambda r: r['d']):
        if row.get('d', '') >= cutoff.strftime('%Y-%m-%dT%H:%M:%SZ'):
            by_url[row['u']] = row
    rows = sorted(by_url.values(), key=lambda r: r['d'], reverse=True)
    rows = [r for r in rows if r['k'] == 'football'][:MAX_FOOTBALL] + [r for r in rows if r['k'] == 'cards'][:MAX_CARDS]

    out = dict(pulled=now.strftime('%Y-%m-%dT%H:%M:%SZ'), sources=sorted({f['name'] for f in FEEDS}), items=rows)
    print('\n'.join(report))
    print(f"{len(rows)} headlines ({sum(r['k'] == 'football' for r in rows)} football, {sum(r['k'] == 'cards' for r in rows)} cards) from {ok}/{len(FEEDS)} feeds")
    for r in rows[:5]:
        print('  ', r['d'][:10], r['s'], '|', r['t'])
    if a.dry_run:
        return
    if old_items == rows:
        print('No change.')
        return
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0, separators=(',', ':')) + '\n')
    print('wrote', OUT.relative_to(ROOT))


if __name__ == '__main__':
    main()
