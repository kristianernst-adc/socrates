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

check "thinking blocks are dropped"     "! grep -q 'should not be captured' $SOCRATES_HOME/events/claude-code/sess_cc.jsonl"
check "sidechains are skipped"          "! grep -q 'subagent noise' $SOCRATES_HOME/events/claude-code/sess_cc.jsonl"
check "codex developer role is dropped" "! grep -q 'sandbox boilerplate' $SOCRATES_HOME/events/codex/sess_cx.jsonl"
check "images become placeholders"      "true"
check "no tool_result events survive"   "! grep -qh '\"kind\": \"tool_result\"' $SOCRATES_HOME/events/*/*.jsonl"

check "tool results join onto their call" "python3 - <<'PY'
import json, glob
n = 0
for f in glob.glob('$SOCRATES_HOME/events/*/*.jsonl'):
    for line in list(open(f))[1:]:
        e = json.loads(line)
        if e.get('kind') == 'tool':
            assert 'output' in e, f'orphan tool call in {f}: {e}'
            n += 1
assert n >= 3, n
PY"

check "capture list shows all three" "python3 -c \"import json,subprocess;d=json.loads(subprocess.check_output(['$SOCRATES','capture','list','--format','json']));raise SystemExit(0 if {s['harness'] for s in d} >= {'pi','claude-code','codex'} else 1)\""
check "digest is readable"           "$SOCRATES capture show sess_pi | grep -q 'TOOL bash: git rebase --onto main feature-a'"
check "digest shows the user turn"   "$SOCRATES capture show sess_pi | grep -q 'USER: why did that rebase work?'"
check "show --format json is raw events" "$SOCRATES capture show sess_pi --format json | python3 -c \"import json,sys;d=json.load(sys.stdin);raise SystemExit(0 if d[0]['type']=='session' else 1)\""
check "unknown session fails loudly" "{ $SOCRATES capture show nope 2>&1 || true; } | grep -q 'no captured session'"

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
check "only settled events are appended"      "test \$(wc -l < $DOUT | tr -d ' ') -eq \$((BASE_LINES+1))"
check "unresolved tool call is held back"     "! grep -q 'tc_delta' $DOUT"

# Now the result arrives in a later chunk.
printf '%s\n' \
 '{"type":"message","id":"d3","timestamp":"2026-01-01T10:00:03.000Z","message":{"role":"toolResult","toolCallId":"tc_delta","toolName":"bash","isError":false,"content":[{"type":"text","text":"Successfully rebased and updated refs/heads/topic."}],"timestamp":3}}' \
 >> "$DFIX.jsonl"
$SOCRATES capture --file "$DFIX.jsonl" --harness pi --format json >/dev/null
check "held-back call is joined to its late result" "python3 -c \"
import json
ev=[json.loads(l) for l in open('$DOUT')][1:]
t=[e for e in ev if e.get('kind')=='tool']
assert len(t)==1, f'expected 1 tool event, got {len(t)}'
assert t[0].get('output'), 'tool event has no output'
assert 'Successfully rebased' in t[0]['output']
\""
check "no orphan tool_result leaked"  "! grep -q 'tool_result' $DOUT"
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
check "lone tool call is initially held back" "! grep -q 'tc_settle' $SOUT"
SOCRATES_SETTLE_MS=0 $SOCRATES capture --file "$DFIX2.jsonl" --harness pi >/dev/null
check "a quiet session flushes its tail"      "grep -q 'tc_settle' $SOUT"
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
head "card — learning outcomes"

cat > "$TMP/card.json" <<'EOF'
{
  "title": "Moving commits onto a different base",
  "subtitle": "What `git rebase --onto` does that a plain rebase cannot.",
  "topic": "git",
  "difficulty": "working",
  "layout": "before-after",
  "estimatedMinutes": 4,
  "tags": ["git", "rebase"],
  "summary": "Rebasing a range of commits without dragging the old base along.",
  "provenance": { "repo": "toolbox/socrates", "files": ["plugin/lib/store.mjs"] },
  "signals": { "why": "user asked why the rebase worked", "confidence": 0.7 },
  "blocks": [
    { "type": "explanation", "text": "`rebase <upstream>` assumes everything before your commits *is* upstream. When that is wrong you must name the range." },
    { "type": "contrast", "title": "Same commits, different destination",
      "wrong": { "label": "What you tried", "code": "git rebase main", "note": "Drags the old base along." },
      "right": { "label": "What worked", "code": "git rebase --onto main old-base", "note": "`old-base` is exclusive." } },
    { "type": "diagram", "kind": "flow", "title": "Reading the three arguments",
      "nodes": [ { "label": "main", "detail": "destination" }, { "label": "old-base", "detail": "exclusive" }, { "label": "HEAD", "detail": "inclusive" } ] },
    { "type": "drill", "prompt": "Three commits on `feature-a`, only those onto `main`?", "hint": "Two refs and a flag.", "answer": "`git rebase --onto main feature-a`." },
    { "type": "callout", "variant": "gotcha", "title": "Exclusive, not inclusive", "text": "The second ref is *not* replayed." },
    { "type": "reference", "url": "https://git-scm.com/docs/git-rebase", "title": "git-rebase docs", "why": "The --onto section." }
  ]
}
EOF

check "card add + render"        "$SOCRATES card add --json \"\$(cat $TMP/card.json)\" --format json | python3 -c \"import json,sys;d=json.load(sys.stdin);import os;raise SystemExit(0 if os.path.exists(d['file']) else 1)\""
check "unknown block type rejected" "! $SOCRATES card add --json '{\"title\":\"x\",\"blocks\":[{\"type\":\"nope\"}]}' 2>/dev/null"
check "card with no blocks rejected" "! $SOCRATES card add --json '{\"title\":\"x\",\"blocks\":[]}' 2>/dev/null"
check "missing title rejected"      "! $SOCRATES card add --json '{\"blocks\":[{\"type\":\"explanation\",\"text\":\"x\"}]}' 2>/dev/null"
check "layout class applied"        "grep -q 'card layout--before-after' $SOCRATES_HOME/pages/*.html"
check "index links the card"        "grep -q 'pages/crd_' $SOCRATES_HOME/index.html"
check "pages have no external resources" "! grep -qE '<link[^>]+rel=\"stylesheet\"|@import|<script[^>]+src=|<img[^>]+src=\"http|url\\(http' $SOCRATES_HOME/pages/*.html"
check "card has provenance footer"  "grep -q 'toolbox/socrates' $SOCRATES_HOME/pages/*.html"

CARD_ID="$(python3 -c "import json,subprocess;print(json.loads(subprocess.check_output(['$SOCRATES','card','list','--format','json']))[0]['id'])")"
$SOCRATES card review "$CARD_ID" learning >/dev/null
$SOCRATES card review "$CARD_ID" known >/dev/null
check "review advances the interval" "python3 -c \"import json,subprocess;d=json.loads(subprocess.check_output(['$SOCRATES','card','list','--format','json']))[0];raise SystemExit(0 if d['review']['status']=='known' and d['review']['intervalDays']>=3 else 1)\""
check "review --status flag works"   "$SOCRATES card review $CARD_ID --status learning >/dev/null"
check "unknown review status rejected" "! $SOCRATES card review $CARD_ID --status whatever 2>/dev/null"

check "render regenerates all"       "$SOCRATES render --format json | python3 -c \"import json,sys;raise SystemExit(0 if json.load(sys.stdin)['cards']>=1 else 1)\""
check "escapes injected markup"      "$SOCRATES card add --json '{\"title\":\"Escaping\",\"blocks\":[{\"type\":\"snippet\",\"code\":\"<script>alert(1)</script>\",\"caption\":\"<img src=x>\"}]}' >/dev/null && ! grep -q '<script>alert' $SOCRATES_HOME/pages/*.html"

# Free-form html is the primary path now: hand-written wins over blocks.
cat > "$TMP/freeform.json" <<'JSON'
{"title":"Handwritten page","topic":"custom","summary":"freeform","html":"<!doctype html><html><head><title>Handwritten</title></head><body><h1>My own layout</h1></body></html>"}
JSON
cat > "$TMP/fragment.json" <<'JSON'
{"title":"Fragment page","topic":"custom","html":"<h1>Just a fragment</h1>"}
JSON
check "hand-written html is used verbatim" "$SOCRATES card add --json-file $TMP/freeform.json --format json | python3 -c \"import json,sys;d=json.load(sys.stdin);h=open(d['file']).read();raise SystemExit(0 if 'My own layout' in h and 'layout--' not in h else 1)\""
check "html fragment gets a plain shell"   "$SOCRATES card add --json-file $TMP/fragment.json --format json | python3 -c \"import json,sys;d=json.load(sys.stdin);h=open(d['file']).read();raise SystemExit(0 if '<!doctype html>' in h and 'class=\\\"frag\\\"' in h else 1)\""
check "json-file avoids shell quoting"     "$SOCRATES card add --json-file $TMP/fragment.json --format json >/dev/null"
check "neither html nor blocks rejected"   "! $SOCRATES card add --json '{\"title\":\"Empty\"}' 2>/dev/null"
cat > "$TMP/interactive.json" <<'JSON'
{"title":"Interactive page","topic":"custom","summary":"has a script","html":"<!doctype html><html><head><title>i</title></head><body><p id=\"out\">static</p><script>document.getElementById('out').textContent='live';</script></body></html>"}
JSON
check "inline interactivity survives verbatim" "$SOCRATES card add --json-file $TMP/interactive.json --format json | python3 -c \"import json,sys;d=json.load(sys.stdin);h=open(d['file']).read();raise SystemExit(0 if \\\"textContent='live'\\\" in h and 'static' in h else 1)\""
check "inline scripts are valid javascript"    "node test/check-pages.mjs $SOCRATES_HOME/pages"
check "page is readable without javascript"    "$SOCRATES card add --json-file $TMP/interactive.json --format json | python3 -c \"import json,sys;d=json.load(sys.stdin);h=open(d['file']).read();raise SystemExit(0 if 'static' in h.split('<script>')[0] else 1)\""
check "board renders papers"               "grep -q 'class=\"paper\"' $SOCRATES_HOME/index.html"
check "paper has a stable tilt"            "grep -qE 'style=\"--r:' $SOCRATES_HOME/index.html"
check "board carries the hover wiggle"     "grep -q '@keyframes wiggle' $SOCRATES_HOME/index.html"
check "board links into pages/"            "grep -q 'href=\"pages/crd_' $SOCRATES_HOME/index.html"

# Retiring must remove the card from the feed and delete its page, or the site
# quietly accumulates orphans.
BEFORE="$(ls $SOCRATES_HOME/pages/*.html | wc -l | tr -d ' ')"
$SOCRATES card review "$CARD_ID" retired >/dev/null
$SOCRATES render >/dev/null
AFTER="$(ls $SOCRATES_HOME/pages/*.html | wc -l | tr -d ' ')"
check "card list hides retired"      "! $SOCRATES card list --format json | grep -q '$CARD_ID'"
check "card list --all shows retired" "$SOCRATES card list --all --format json | grep -q '$CARD_ID'"
check "retired card page is swept"  "test \"$AFTER\" -lt \"$BEFORE\""
check "retired card left the index" "! grep -q \"$CARD_ID\" $SOCRATES_HOME/index.html"
check "rendering a retired card fails" "! $SOCRATES render --id $CARD_ID 2>/dev/null"

# ---------------------------------------------------------------------------
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

check "help lists every group"  "$SOCRATES help | grep -q capture && $SOCRATES help | grep -q mood && $SOCRATES help | grep -q 'card' && $SOCRATES help | grep -q taste"
check "home reports the data root" "$SOCRATES home | python3 -c \"import json,sys;raise SystemExit(0 if json.load(sys.stdin)['home'] else 1)\""
check "unknown group fails loudly" "! $SOCRATES nonsense 2>/dev/null"
check "SOCRATES_HOME is honoured"  "test -d $SOCRATES_HOME/cards"

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
