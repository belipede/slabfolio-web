"""Build index.html from src/ and data/. Run: python3 scripts/build.py"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
app = (root / 'src/app.js').read_text()
for name in ['sets', 'seen', 'news', 'sample-cards']:
    key = '__' + name.upper().replace('-', '_') + '__'
    assert key in app, key
    data = json.loads((root / 'data' / f'{name}.json').read_text())
    app = app.replace(key, json.dumps(data, ensure_ascii=False, separators=(',', ':')), 1)
head = (root / 'src/head.html').read_text()
(root / 'index.html').write_text(head + '<script>\n' + app + '</script>\n</body>\n</html>\n')
print('built index.html', len(head) + len(app))
