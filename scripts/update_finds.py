"""Rebuild data/finds.json from Card Finder issues on GitHub.

The app opens a pre-filled issue when someone shares a pull. The issue body
carries the report as JSON inside an HTML comment, which is how these issues
are found (labels in the link only stick for people with triage rights). A moderator
adds the `verified` label after checking the photos or listing, or `rejected`
(or `fake`) to throw it out. Open issues with neither label show as pending.
The reporter is always the issue author, whatever the JSON says. Once a find
is published as verified its card details are locked, so editing the issue
afterwards can't move the points to another card.

Run: GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo python3 scripts/update_finds.py [--dry-run] [--fixture FILE]
"""
import argparse, json, os, pathlib, re, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'finds.json'
SETS = {s['id']: s for s in json.loads((ROOT / 'data' / 'sets.json').read_text())}
BLOCK = re.compile(r'<!--\s*slabfolio-find\s*(\{.*?\})\s*-->', re.S)
IMG = re.compile(r'(https://(?:github\.com/user-attachments/assets/[\w-]+|user-images\.githubusercontent\.com/\S+?\.(?:png|jpe?g|webp|gif)|private-user-images\.githubusercontent\.com/\S+?))[)\s"\']')
PROOF = {'photo', 'listing', 'video', 'graded'}


def points_for(run):
    return 100 if run == 1 else 40 if run <= 5 else 20 if run <= 10 else 10


def issues(repo, token):
    out, page = [], 1
    while True:
        url = f'https://api.github.com/repos/{repo}/issues?state=all&per_page=100&page={page}'
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                                                   'User-Agent': 'slabfolio-finds'})
        with urllib.request.urlopen(req, timeout=30) as r:
            got = json.load(r)
        out += [i for i in got if 'pull_request' not in i]
        if len(got) < 100:
            return out
        page += 1


def check(rep):
    """Return (clean report, None) or (None, reason)."""
    s = SETS.get(rep.get('set'))
    if not s:
        return None, 'unknown set'
    g = next((g for g in s['groups'] if g['n'] == rep.get('grp')), None)
    if not g:
        return None, 'unknown insert'
    if not any(c[0] == str(rep.get('card')) for c in g['cards']):
        return None, 'unknown card'
    p = next((p for p in g['pars'] if p['n'] == rep.get('par')), None)
    if not p:
        return None, 'unknown parallel'
    try:
        serial = int(rep.get('serial') or 0)
    except (TypeError, ValueError):
        return None, 'bad serial'
    if not 0 <= serial <= p['r']:
        return None, 'serial out of range'
    ev = rep.get('ev') if rep.get('ev') in PROOF else 'photo'
    link = rep.get('link') or ''
    if link and not re.match(r'https?://', link):
        link = ''
    return dict(set=s['id'], grp=g['n'], card=str(rep['card']), par=p['n'], run=p['r'], serial=serial, ev=ev, link=link[:300],
                code=re.sub(r'[^A-Z0-9]', '', str(rep.get('code', '')).upper())[:8], note=str(rep.get('note', ''))[:280],
                anon=bool(rep.get('anon'))), None


def build(raw, old=()):
    locked = {f['issue']: f for f in old if f.get('status') == 'verified'}
    finds, skipped = [], []
    for i in sorted(raw, key=lambda i: i['created_at']):
        labels = {l['name'].lower() for l in i.get('labels', [])}
        m = BLOCK.search(i.get('body') or '')
        if not m:
            continue  # an ordinary issue, such as a bug report
        try:
            rep, why = check(json.loads(m.group(1)))
        except ValueError:
            rep, why = None, 'bad JSON'
        if not rep:
            skipped.append((i['number'], why))
            continue
        if 'rejected' in labels or 'fake' in labels:
            status = 'rejected'
        elif 'verified' in labels:
            status = 'verified'
        elif i['state'] == 'open':
            status = 'pending'
        else:
            skipped.append((i['number'], 'closed without a verdict'))
            continue
        if status == 'verified' and i['number'] in locked:
            rep = {k: locked[i['number']][k] for k in rep}
        img = IMG.search((i.get('body') or '') + ' ')
        rep.update(id=f"gh{i['number']}", issue=i['number'], url=i['html_url'], user=i['user']['login'], status=status,
                   fake='fake' in labels, t=i['created_at'], photo=img.group(1) if img else '', auto=False)
        finds.append(rep)

    # first verified report of each numbered copy earns the points (oldest issue wins)
    taken = set()
    for f in finds:
        if f['status'] != 'verified':
            continue
        key = (f['set'], f['grp'], f['card'], f['par'], f['serial'])
        first = f['serial'] > 0 and key not in taken
        if first:
            taken.add(key)
        f['firstVerified'], f['points'] = first, points_for(f['run']) if first else 0
    # rejected reports are not published; a report rejected as fake costs its author points
    penalties = {}
    for f in finds:
        if f['status'] == 'rejected' and f['fake']:
            penalties[f['user']] = penalties.get(f['user'], 0) + 1
    return [f for f in finds if f['status'] != 'rejected'], penalties, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--fixture', help='read issues from a JSON file instead of the GitHub API')
    a = ap.parse_args()
    if a.fixture:
        raw = json.loads(pathlib.Path(a.fixture).read_text())
    else:
        repo, token = os.environ.get('GITHUB_REPOSITORY'), os.environ.get('GITHUB_TOKEN')
        if not repo or not token:
            sys.exit('Set GITHUB_REPOSITORY and GITHUB_TOKEN')
        raw = issues(repo, token)
    try:
        old = json.loads(OUT.read_text()).get('finds', [])
    except (FileNotFoundError, ValueError):
        old = []
    finds, penalties, skipped = build(raw, old)
    print(f"{len(finds)} finds from {len(raw)} issues "
          f"({sum(f['status'] == 'verified' for f in finds)} verified, {sum(f['status'] == 'pending' for f in finds)} pending)")
    for n, why in skipped:
        print(f'  skipped #{n}: {why}')
    out = json.dumps(dict(finds=finds, penalties=penalties), ensure_ascii=False, indent=0, separators=(',', ':')) + '\n'
    if a.dry_run:
        return
    if OUT.exists() and OUT.read_text() == out:
        print('No change.')
        return
    OUT.write_text(out)
    print('wrote', OUT.relative_to(ROOT))


if __name__ == '__main__':
    main()
