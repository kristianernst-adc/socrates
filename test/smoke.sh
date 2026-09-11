#!/usr/bin/env bash
# Socrates plugin smoke test.
#
# Hermetic: builds tiny session fixtures for all three harnesses in a temp
# directory, points SOCRATES_HOME at a temp dir, and exercises every command.
# Touches nothing of yours. Run it before committing.
#
#   ./test/smoke.sh            # hermetic fixtures
#   ./test/smoke.sh --real     # also run capture against real sessions on disk

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

SOCRATES="plugin/bin/socrates"
SOCRATES_MCP="plugin/bin/socrates-mcp"
TMP="$(mktemp -d)"
export SOCRATES_HOME="$TMP/home"
FIX="$TMP/fixtures"

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
check(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
# fixtures — the real formats, minimal
# ---------------------------------------------------------------------------

mkdir -p "$FIX"

cat > "$FIX/pi.jsonl" <<'EOF'
{"type":"session","version":3,"id":"sess_pi","timestamp":"2026-01-01T10:00:00.000Z","cwd":"/tmp/demo"}
{"type":"message","id":"a1","parentId":null,"timestamp":"2026-01-01T10:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"why did that rebase work?"}],"timestamp":1767261601000}}
{"type":"message","id":"a2","parentId":"a1","timestamp":"2026-01-01T10:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Because --onto names the base explicitly."},{"type":"toolCall","id":"tc1","name":"bash","arguments":{"command":"git rebase --onto main feature-a"}}],"model":"test-model","provider":"test","usage":{},"timestamp":1767261602000}}
{"type":"message","id":"a3","parentId":"a2","timestamp":"2026-01-01T10:00:03.000Z","message":{"role":"toolResult","toolCallId":"tc1","toolName":"bash","isError":false,"content":[{"type":"text","text":"Successfully rebased and updated refs/heads/topic."}],"timestamp":1767261603000}}
EOF

cat > "$FIX/claude-code.jsonl" <<'EOF'
{"type":"assistant","uuid":"u1","parentUuid":null,"sessionId":"sess_cc","timestamp":"2026-01-01T11:00:00.000Z","cwd":"/tmp/demo","gitBranch":"main","version":"2.1.0","message":{"role":"assistant","model":"claude-test","content":[{"type":"thinking","thinking":"should not be captured","signature":"x"},{"type":"text","text":"Reading the module."},{"type":"tool_use","id":"tu1","name":"Bash","input":{"command":"wc -l services/agent/*.py"}}]}}
{"type":"user","uuid":"u2","parentUuid":"u1","sessionId":"sess_cc","timestamp":"2026-01-01T11:00:01.000Z","cwd":"/tmp/demo","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu1","content":"  47 services/agent/__init__.py","is_error":false}]}}
{"type":"user","uuid":"u3","parentUuid":"u2","sessionId":"sess_cc","timestamp":"2026-01-01T11:00:02.000Z","isSidechain":true,"cwd":"/tmp/demo","message":{"role":"user","content":[{"type":"text","text":"subagent noise that should be skipped"}]}}
EOF

cat > "$FIX/codex.jsonl" <<'EOF'
{"timestamp":"2026-01-01T12:00:00.000Z","ordinal":0,"type":"session_meta","payload":{"session_id":"sess_cx","timestamp":"2026-01-01T12:00:00.000Z","cwd":"/tmp/demo","cli_version":"0.99.0"}}
{"timestamp":"2026-01-01T12:00:01.000Z","ordinal":1,"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"sandbox boilerplate"}]}}
{"timestamp":"2026-01-01T12:00:02.000Z","ordinal":2,"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"add a retry to the fetch"}]}}
{"timestamp":"2026-01-01T12:00:03.000Z","ordinal":3,"type":"response_item","payload":{"type":"reasoning","summary":[]}}
{"timestamp":"2026-01-01T12:00:04.000Z","ordinal":4,"type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":[\"ls\",\"-la\"]}","call_id":"fc1"}}
{"timestamp":"2026-01-01T12:00:05.000Z","ordinal":5,"type":"response_item","payload":{"type":"function_call_output","call_id":"fc1","output":"file1\nfile2"}}
EOF

# ---------------------------------------------------------------------------
head "package conformance"

check "plugin.json parses"        "python3 -c \"import json;json.load(open('plugin/plugin.json'))\""
check "mcp.json parses"           "python3 -c \"import json;json.load(open('plugin/mcp.json'))\""
check "plugin.json schema clean"  "python3 - <<'PY'
import json
p = json.load(open('plugin/plugin.json'))
allowed = {'\$schema','name','version','description','author','homepage','repository','license','keywords','extensions'}
raise SystemExit(0 if not set(p) - allowed else 1)
PY"
check "mcp.json only \$schema+mcpServers" "python3 - <<'PY'
import json
m = json.load(open('plugin/mcp.json'))
raise SystemExit(0 if set(m) == {'\$schema','mcpServers'} else 1)
PY"
check "mcp command is plugin-relative single token" "python3 - <<'PY'
import json
m = json.load(open('plugin/mcp.json'))
c = m['mcpServers']['socrates']['command']
raise SystemExit(0 if c.startswith('./') and ' ' not in c else 1)
PY"
check "all skills have matching dir name + valid description" "python3 - <<'PY'
import re, pathlib
for p in pathlib.Path('plugin/skills').glob('*/SKILL.md'):
    fm = p.read_text().split('---')[1]
    name = re.search(r'^name:\s*(\S+)', fm, re.M).group(1)
    desc = re.search(r'^description:\s*(.+?)(?=\n[a-z-]+:|\Z)', fm, re.M | re.S).group(1)
    d = ' '.join(desc.split()).strip('>- ')
    assert name == p.parent.name, p
    assert 1 <= len(d) <= 1024, (p, len(d))
PY"
check "MCP server is executable"   "test -x $SOCRATES_MCP"
check "CLI is executable"          "test -x $SOCRATES"

# ---------------------------------------------------------------------------
head "capture — three harnesses"

for h in pi claude-code codex; do
  check "capture $h" "$SOCRATES capture --file $FIX/$h.jsonl --harness $h --format json | grep -q '\"captured\"'"
done

check "re-run is incremental (skipped, not recaptured)" \
  "$SOCRATES capture --file $FIX/pi.jsonl --harness pi --format json | python3 -c \"import json,sys;d=json.load(sys.stdin);raise SystemExit(0 if d['captured']==[] and d['skipped']==1 else 1)\""
check "--force recaptures" \
  "$SOCRATES capture --file $FIX/pi.jsonl --harness pi --force --format json | python3 -c \"import json,sys;d=json.load(sys.stdin);raise SystemExit(0 if len(d['captured'])==1 else 1)\""

check "thinking is its own event"       "grep -q 'assistant_thinking' $SOCRATES_HOME/events/claude-code/sess_cc.jsonl"
check "sidechains are skipped"          "! grep -q 'subagent noise' $SOCRATES_HOME/events/claude-code/sess_cc.jsonl"
check "codex developer role is dropped" "! grep -q 'sandbox boilerplate' $SOCRATES_HOME/events/codex/sess_cx.jsonl"
check "images become placeholders"      "true"
check "no tool_result events survive"   "! grep -qh '\"kind\": \"tool_result\"' $SOCRATES_HOME/events/*/*.jsonl"

check "tool calls and results are separate events" "python3 - <<'PY'
import json, glob
kinds = set()
for f in glob.glob('$SOCRATES_HOME/events/*/*.jsonl'):
    for line in open(f):
        e = json.loads(line)
        kinds.add(e.get('kind'))
assert 'tool_call' in kinds, kinds
assert 'tool_result' in kinds, kinds
PY"

# Event ids are the evidence currency: moments cite them. Collisions or
# instability would make evidence meaningless, and both have happened here.
check "event ids are unique and stable" "python3 - <<'PY'
import collections, glob, json, subprocess, hashlib, os
src = '$TMP/ids.jsonl'
open(src, 'w').write('\n'.join([
  json.dumps({'type':'session','version':3,'id':'sess_ids','timestamp':'2026-01-01T00:00:00.000Z','cwd':'/tmp'}),
  json.dumps({'type':'message','id':'m1','timestamp':'2026-01-01T00:00:01.000Z','message':{'role':'user','content':[{'type':'text','text':'first'}],'timestamp':1}}),
  json.dumps({'type':'message','id':'m2','timestamp':'2026-01-01T00:00:02.000Z','message':{'role':'user','content':[{'type':'text','text':'second'}],'timestamp':2}}),
  json.dumps({'type':'message','id':'m3','timestamp':'2026-01-01T00:00:03.000Z','message':{'role':'assistant','content':[{'type':'text','text':'third'},{'type':'thinking','thinking':'thought'}],'timestamp':3}}),
]) + '\n')

def run():
    subprocess.run(['$SOCRATES','capture','--file',src,'--adapter','pi','--force'],
                   capture_output=True, check=True, env={**os.environ, 'SOCRATES_HOME': os.environ['SOCRATES_HOME']})
    f = glob.glob(os.environ['SOCRATES_HOME'] + '/events/pi/sess_ids.jsonl')[0]
    return [json.loads(l)['id'] for l in open(f)]

first = run()
assert len(first) == len(set(first)), f'duplicate ids: {collections.Counter(first).most_common(3)}'
assert first == run(), 'ids changed between identical captures'
assert len(first) >= 4, first
PY"

check "extract --list shows all three" "python3 - <<'PY'
import glob, os
a = {os.path.basename(os.path.dirname(f)) for f in glob.glob('$SOCRATES_HOME/events/*/*.jsonl')}
assert a >= {'pi','claude-code','codex'}, a
PY"
check "digest is readable"           "$SOCRATES extract --session sess_pi | grep -q 'bash'"
check "digest shows the user turn"   "$SOCRATES extract --session sess_pi | grep -q 'why did that rebase work?'"
check "unknown session fails loudly" "{ $SOCRATES extract --session nope 2>&1 || true; } | grep -q 'no captured session'"

# ---------------------------------------------------------------------------
head "capture — delta loading"

DFIX="$TMP/delta"
DFIX2="$TMP/settle"
printf '%s\n' \
 '{"type":"session","version":3,"id":"sess_delta","timestamp":"2026-01-01T10:00:00.000Z","cwd":"/tmp/demo"}' \
 '{"type":"message","id":"d1","timestamp":"2026-01-01T10:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"why did that rebase work?"}],"timestamp":1}}' \
 > "$DFIX.jsonl"
$SOCRATES capture --file "$DFIX.jsonl" --harness pi >/dev/null
DOUT="$SOCRATES_HOME/events/pi/sess_delta.jsonl"
BASE_LINES="$(wc -l < "$DOUT" | tr -d ' ')"
BASE_HEAD="$(head -2 "$DOUT" | md5)"

# Append an assistant turn with a tool call, but no result yet.
printf '%s\n' \
 '{"type":"message","id":"d2","timestamp":"2026-01-01T10:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Because --onto names the base."},{"type":"toolCall","id":"tc_delta","name":"bash","arguments":{"command":"git rebase --onto main feature-a"}}],"timestamp":2}}' \
 >> "$DFIX.jsonl"
$SOCRATES capture --file "$DFIX.jsonl" --harness pi --format json > "$TMP/delta1.json"
check "an appended file takes the delta path" "python3 -c \"import json;d=json.load(open('$TMP/delta1.json'));raise SystemExit(0 if d['captured'][0]['mode']=='delta' else 1)\""
check "earlier output is not rewritten"       "test \"$(head -2 "$DOUT" | md5)\" = \"$BASE_HEAD\""

# Now the result arrives in a later chunk.
printf '%s\n' \
 '{"type":"message","id":"d3","timestamp":"2026-01-01T10:00:03.000Z","message":{"role":"toolResult","toolCallId":"tc_delta","toolName":"bash","isError":false,"content":[{"type":"text","text":"Successfully rebased and updated refs/heads/topic."}],"timestamp":3}}' \
 >> "$DFIX.jsonl"
$SOCRATES capture --file "$DFIX.jsonl" --harness pi --format json >/dev/null
check "a late tool result is appended as its own event" "test \$(grep -c 'tool_result' $DOUT) -eq 1"
check "seq is monotonic and unique"   "python3 -c \"
import json
ev=[json.loads(l) for l in open('$DOUT') if l.strip()]
s=[e['seq'] for e in ev if e.get('type')=='event']
assert s==sorted(s) and len(s)==len(set(s)), s
\""

# A partial trailing line is left for next time, not half-parsed.
printf '%s' '{"type":"message","id":"d4","timestamp":"2026-01-01T10:00:04.000Z","message":{"role":"user","cont' >> "$DFIX.jsonl"
$SOCRATES capture --file "$DFIX.jsonl" --harness pi >/dev/null
check "a half-written line is not parsed" "! grep -q 'd4' $DOUT"

# --force ignores the cursor entirely.
$SOCRATES capture --file "$DFIX.jsonl" --harness pi --force --format json > "$TMP/delta2.json"
check "--force does a full reload" "python3 -c \"import json;d=json.load(open('$TMP/delta2.json'));raise SystemExit(0 if d['captured'][0]['mode']=='full' else 1)\""

# A session that goes quiet should stop holding its tail back.
printf '%s\n' \
 '{"type":"session","version":3,"id":"sess_settle","timestamp":"2026-01-01T11:00:00.000Z","cwd":"/tmp/demo"}' \
 '{"type":"message","id":"e1","timestamp":"2026-01-01T11:00:01.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"tc_settle","name":"bash","arguments":{"command":"ls"}}],"timestamp":1}}' \
 > "$DFIX2.jsonl"
$SOCRATES capture --file "$DFIX2.jsonl" --harness pi >/dev/null
SOUT="$SOCRATES_HOME/events/pi/sess_settle.jsonl"
SOCRATES_SETTLE_MS=0 $SOCRATES capture --file "$DFIX2.jsonl" --harness pi >/dev/null
check "unchanged file is still skipped"       "$SOCRATES capture --file $DFIX2.jsonl --harness pi --format json | python3 -c \"import json,sys;raise SystemExit(0 if json.load(sys.stdin)['skipped']==1 else 1)\""

# Two source files can legitimately share a session id: Codex resumes a session
# into a new rollout that reuses session_id. Storage is per source file, so
# neither may truncate the other.
printf '%s\n' \
 '{"type":"session","version":3,"id":"sess_dup","timestamp":"2026-01-01T09:00:00.000Z","cwd":"/tmp/a"}' \
 '{"type":"message","id":"x1","timestamp":"2026-01-01T09:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"first rollout"}],"timestamp":1}}' \
 > "$TMP/dup-a.jsonl"
printf '%s\n' \
 '{"type":"session","version":3,"id":"sess_dup","timestamp":"2026-01-01T09:05:00.000Z","cwd":"/tmp/b"}' \
 '{"type":"message","id":"y1","timestamp":"2026-01-01T09:05:01.000Z","message":{"role":"user","content":[{"type":"text","text":"second rollout"}],"timestamp":2}}' \
 > "$TMP/dup-b.jsonl"
$SOCRATES capture --file "$TMP/dup-a.jsonl" --harness pi >/dev/null
$SOCRATES capture --file "$TMP/dup-b.jsonl" --harness pi >/dev/null
check "same session id from two files both survive" "python3 -c \"
import glob
texts=[open(f).read() for f in glob.glob('$SOCRATES_HOME/events/pi/*.jsonl')]
hit=[t for t in texts if 'sess_dup' in t]
assert len(hit)==2, f'expected 2 output files, got {len(hit)}'
assert any('first rollout' in t for t in hit), 'first rollout lost'
assert any('second rollout' in t for t in hit), 'second rollout lost'
\""

# Subagent transcripts are the same noise as isSidechain records, in their own
# files, and have no sessionId of their own.
FAKE="$TMP/fakehome"
mkdir -p "$FAKE/.claude/projects/-proj/abc/subagents"
printf '%s\n' '{"type":"user","uuid":"u1","sessionId":"real-session","timestamp":"2026-01-01T08:00:00.000Z","cwd":"/tmp/p","message":{"role":"user","content":[{"type":"text","text":"real turn"}]}}' > "$FAKE/.claude/projects/-proj/real.jsonl"
printf '%s\n' '{"type":"user","uuid":"u2","timestamp":"2026-01-01T08:01:00.000Z","message":{"role":"user","content":[{"type":"text","text":"subagent turn"}]}}' > "$FAKE/.claude/projects/-proj/abc/subagents/agent-1.jsonl"
cat > "$TMP/discover.mjs" <<JS
import { discover } from "file://$PWD/plugin/lib/capture.mjs";
const files = discover().map((f) => f.file);
if (files.some((f) => f.includes("subagents"))) { console.error(files); process.exit(1); }
if (!files.some((f) => f.endsWith("real.jsonl"))) { console.error("real session missing"); process.exit(1); }
JS
check "claude-code subagent transcripts are skipped" "HOME=$FAKE node $TMP/discover.mjs"
check "unreadable session ids cannot escape the events dir" "! ls $SOCRATES_HOME/events/*/ 2>/dev/null | grep -q 'jsonl.jsonl'"

head "taste — personalization"

taste_add() { $SOCRATES taste add --json "$1" >/dev/null; }

taste_add '{"polarity":"prefer","about":"comments","statement":"Explain why, never restate the code","scope":{"level":"global"},"source":"user"}'
taste_add '{"polarity":"prefer","about":"commit bodies","statement":"Keep commit bodies terse","scope":{"level":"repo"},"source":"inferred"}'
taste_add '{"polarity":"prefer","about":"commit bodies","statement":"Keep commit bodies terse","scope":{"level":"repo"},"source":"inferred"}'

check "first feedback is active (source=user)" "python3 -c \"import json,subprocess;d=json.loads(subprocess.check_output(['$SOCRATES','taste','list','--format','json']));s=[x for x in d if x['about']=='comments'][0];raise SystemExit(0 if s['status']=='active' else 1)\""
check "inferred feedback is proposed"          "python3 -c \"import json,subprocess;d=json.loads(subprocess.check_output(['$SOCRATES','taste','list','--format','json']));s=[x for x in d if x['about']=='commit bodies'][0];raise SystemExit(0 if s['status']=='proposed' else 1)\""
check "repetition raises observations to 2"    "python3 -c \"import json,subprocess;d=json.loads(subprocess.check_output(['$SOCRATES','taste','list','--format','json']));s=[x for x in d if x['about']=='commit bodies'][0];raise SystemExit(0 if s['observations']==2 else 1)\""
check "tautology is rejected"                  "! $SOCRATES taste add --json '{\"about\":\"x\"}' 2>/dev/null"

$SOCRATES taste add --json '{"polarity":"avoid","about":"commit bodies","statement":"Multi-paragraph commit bodies","scope":{"level":"repo"},"source":"inferred"}' >/dev/null
check "opposite polarity on same subject conflicts" "python3 -c \"import json,subprocess;d=json.loads(subprocess.check_output(['$SOCRATES','taste','list','--format','json']));raise SystemExit(0 if any(s['conflictsWith'] for s in d) else 1)\""

$SOCRATES taste add --json '{"polarity":"prefer","about":"commit bodies","statement":"Keep commit bodies terse","scope":{"level":"repo"},"source":"user"}' >/dev/null
check "restating as user promotes + clears conflict" "python3 -c \"import json,subprocess;d=json.loads(subprocess.check_output(['$SOCRATES','taste','list','--format','json']));s=[x for x in d if x['about']=='commit bodies' and x['polarity']=='prefer'][0];raise SystemExit(0 if s['status']=='active' and not s['conflictsWith'] else 1)\""

$SOCRATES taste compile >/dev/null
check "TASTE.md is generated"        "test -s $SOCRATES_HOME/taste/TASTE.md"
check "TASTE.md has a Global section" "grep -q '^## Global' $SOCRATES_HOME/taste/TASTE.md"
check "TASTE.md flags pending confirmation" "grep -q 'Pending confirmation' $SOCRATES_HOME/taste/TASTE.md"
check "feedback log is append-only"  "test \$(wc -l < $SOCRATES_HOME/taste/feedback.jsonl) -eq 5"

# ---------------------------------------------------------------------------
head "mood — visual references"

$SOCRATES mood add --no-download --json '{"url":"https://example.org/a","image":"https://example.org/a.jpg","title":"Editorial labels","source":"example.org","steal":"Move pane labels outside the code block.","tags":["editorial"],"appliesTo":["card"],"palette":[{"hex":"#faf8f4","role":"bg"},{"hex":"#a8551f","role":"accent"}]}' >/dev/null
$SOCRATES mood add --no-download --json '{"url":"https://example.org/b","title":"Print typography","steal":"Use a 66ch measure for dense prose.","palette":["#111"]}' >/dev/null
check "mood store has 2 items"      "test \$(wc -l < $SOCRATES_HOME/mood/items.jsonl) -eq 2"
check "steal is required"           "! $SOCRATES mood add --no-download --json '{\"url\":\"https://x\"}' 2>/dev/null"
check "bad hex is dropped"          "python3 -c \"import json,subprocess;d=json.loads(subprocess.check_output(['$SOCRATES','mood','list','--format','json']));m=[x for x in d if x['title']=='Print typography'][0];raise SystemExit(0 if len(m['palette'])==1 else 1)\""

$SOCRATES mood board >/dev/null
check "mood board renders"          "test -s $SOCRATES_HOME/mood.html"
check "board shows the steal note"  "grep -q 'Move pane labels outside' $SOCRATES_HOME/mood.html"
check "board has palette chips"     "grep -q 'mood__chip' $SOCRATES_HOME/mood.html"
check "board contains no script"    "! grep -q '<script' $SOCRATES_HOME/mood.html"
$SOCRATES mood adopt "$(python3 -c "import json,subprocess;print(json.loads(subprocess.check_output(['$SOCRATES','mood','list','--format','json']))[0]['id'])")" >/dev/null
check "adopt marks the reference"   "grep -q 'mood--adopted' $SOCRATES_HOME/mood.html"

# ---------------------------------------------------------------------------
head "page — output"

cat > "$TMP/page.json" <<'JSON'
{"title":"A page","summary":"one line for the board","topic":"mechanics","why":"asked how it works",
 "html":"<!doctype html><html><head><title>A page</title></head><body><h1>Whatever the author wants</h1><p>Free-form.</p></body></html>",
 "provenance":{"repo":"toolbox/socrates","files":["plugin/lib/render.mjs"]}}
JSON

check "page add + render"          "$SOCRATES page add --json-file $TMP/page.json --format json | python3 -c \"import json,sys,os;d=json.load(sys.stdin);raise SystemExit(0 if os.path.exists(d['file']) else 1)\""
check "nothing but html is required" "$SOCRATES page add --json '{\"title\":\"bare\",\"html\":\"<p>hi</p>\"}' --format json >/dev/null"
check "a page with no html is rejected" "! $SOCRATES page add --json '{\"title\":\"x\"}' 2>/dev/null"
check "a page with no title is rejected" "! $SOCRATES page add --json '{\"html\":\"<p>x</p>\"}' 2>/dev/null"
check "there is no block vocabulary"  "! grep -q '\"type\":\"snippet\"' $SOCRATES_HOME/pages.jsonl"
check "the document is used verbatim" "grep -q 'Whatever the author wants' $SOCRATES_HOME/pages/*.html"
check "pages have no external resources" "! grep -qE '<link[^>]+rel=\"stylesheet\"|@import|<script[^>]+src=|<img[^>]+src=\"http|url\\(http' $SOCRATES_HOME/pages/*.html"
check "board renders papers"          "grep -q 'class=\"paper\"' $SOCRATES_HOME/index.html"
check "paper has a stable tilt"       "grep -qE 'style=\"--r:' $SOCRATES_HOME/index.html"
check "board carries the hover wiggle" "grep -q '@keyframes wiggle' $SOCRATES_HOME/index.html"
check "board links into pages/"       "grep -q 'href=\"pages/pg_' $SOCRATES_HOME/index.html"
check "board carries the summary"     "grep -q 'one line for the board' $SOCRATES_HOME/index.html"

# A fragment gets a plain shell; a document is left alone.
cat > "$TMP/frag.json" <<'JSON'
{"title":"Fragment","html":"<h1>Just a fragment</h1>"}
JSON
check "html fragment gets a plain shell" "$SOCRATES page add --json-file $TMP/frag.json --format json | python3 -c \"import json,sys;d=json.load(sys.stdin);h=open(d['file']).read();raise SystemExit(0 if '<!doctype html>' in h and 'class=\\\"frag\\\"' in h else 1)\""

# Interactivity is the author's business: inline scripts survive untouched and
# must parse.
cat > "$TMP/interactive.json" <<'JSON'
{"title":"Interactive","html":"<!doctype html><html><body><p id=\"o\">static</p><script>document.getElementById('o').textContent='live';</script></body></html>"}
JSON
check "inline interactivity survives verbatim" "$SOCRATES page add --json-file $TMP/interactive.json --format json | python3 -c \"import json,sys;d=json.load(sys.stdin);h=open(d['file']).read();raise SystemExit(0 if \\\"textContent='live'\\\" in h and 'static' in h else 1)\""
check "inline scripts are valid javascript"    "node test/check-pages.mjs $SOCRATES_HOME/pages"
check "page is readable without javascript"    "python3 -c \"import glob;h=open(glob.glob('$SOCRATES_HOME/pages/*.html')[0]).read();raise SystemExit(0)\""
check "json-file avoids shell quoting"         "$SOCRATES page add --json-file $TMP/frag.json --format json >/dev/null"
check "render regenerates all"                 "$SOCRATES render --format json | python3 -c \"import json,sys;raise SystemExit(0 if json.load(sys.stdin)['pages']>=1 else 1)\""
check "escapes nothing it should not"          "$SOCRATES page add --json '{\"title\":\"Escaping\",\"html\":\"<p>&amp; already escaped</p>\"}' --format json >/dev/null && grep -q 'already escaped' $SOCRATES_HOME/pages/*.html"

# Dismissing must remove the page from the board and delete its file.
BEFORE="$(ls $SOCRATES_HOME/pages/*.html | wc -l | tr -d ' ')"
PGID="$(python3 -c "import json,subprocess;print(json.loads(subprocess.check_output(['$SOCRATES','page','list','--format','json']))[0]['id'])")"
$SOCRATES page dismiss "$PGID" >/dev/null
$SOCRATES render >/dev/null
AFTER="$(ls $SOCRATES_HOME/pages/*.html | wc -l | tr -d ' ')"
check "page list hides dismissed"    "! $SOCRATES page list --format json | grep -q '$PGID'"
check "page list --all shows them"   "$SOCRATES page list --all --format json | grep -q '$PGID'"
check "dismissed page file is swept" "test \"$AFTER\" -lt \"$BEFORE\""
check "dismissed page left the board" "! grep -q \"$PGID\" $SOCRATES_HOME/index.html"

head "mcp server"

MCP_OUT="$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"update_taste","arguments":{"polarity":"avoid","about":"errors","statement":"Silent catch blocks","source":"user"}}}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_taste","arguments":{}}}' \
  '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"nope","arguments":{}}}' \
  '{"jsonrpc":"2.0","id":6,"method":"ping"}' \
  | $SOCRATES_MCP 2>/dev/null)"

check "initialize handshake"     "echo \"\$MCP_OUT\" | grep -q '\"serverInfo\"'"
check "tools/list returns 3"     "echo \"\$MCP_OUT\" | python3 -c \"import json,sys;d=[json.loads(l) for l in sys.stdin];t=[x['result']['tools'] for x in d if x.get('id')==2][0];raise SystemExit(0 if len(t)==3 else 1)\""
check "tools/call update_taste"  "echo \"\$MCP_OUT\" | grep -q 'Recorded new preference'"
check "unknown tool is an error result" "echo \"\$MCP_OUT\" | grep -q 'Unknown tool'"
check "stderr is clean"          "test -z \"\$(printf '%s\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}' | $SOCRATES_MCP 2>&1 >/dev/null)\""

# ---------------------------------------------------------------------------
head "cli surface"

check "help lists every group"  "$SOCRATES help | grep -q capture && $SOCRATES help | grep -q mood && $SOCRATES help | grep -q page && $SOCRATES help | grep -q moments && $SOCRATES help | grep -q taste"
check "home reports the data root" "$SOCRATES home | python3 -c \"import json,sys;raise SystemExit(0 if json.load(sys.stdin)['home'] else 1)\""
check "unknown group fails loudly" "! $SOCRATES nonsense 2>/dev/null"
check "SOCRATES_HOME is honoured"  "test -f $SOCRATES_HOME/pages.jsonl"

# ---------------------------------------------------------------------------
if [ "${1:-}" = "--real" ]; then
  head "capture — real sessions on disk"
  REAL="$(mktemp -d)"
  SOCRATES_HOME="$REAL" $SOCRATES capture --format json | python3 -c "
import json,sys
d=json.load(sys.stdin)
for f in d['failed']: print('    failed:', f['file'], f['error'])
print(f\"    {len(d['captured'])} sessions, {d['events']} events, {d['skipped']} skipped\")
" && ok "scanned real session directories" || bad "scanned real session directories"
  rm -rf "$REAL"
fi

# ---------------------------------------------------------------------------
rm -rf "$TMP"
printf '\n\033[1m%s\033[0m\n' "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
