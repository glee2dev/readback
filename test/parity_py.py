import json, sys
sys.path.insert(0, sys.argv[1])
from check import score_output
replay = json.load(open(sys.argv[2])); out = {}
for q in replay['queries']:
    for mode, m in q['modes'].items():
        text = m['output'].get('text') or ''
        sample = (q.get('sample_stats') or {}).get('naive_grounded') if mode == 'naive_grounded' else None
        s = score_output(text, mode, q['stats'], sample, None, None)
        out[f"{q['id']}/{mode}"] = [[c['text'], c['status']] for c in s.claims]
json.dump(out, open(sys.argv[3], 'w'))
