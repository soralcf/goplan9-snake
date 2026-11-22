#!/bin/sh
# 文档一致性自检。在仓库根目录运行：./scripts/check-docs.sh
set -eu
cd "$(dirname "$0")/.."

broken=$(mktemp)
items=$(mktemp)
trap 'rm -f "$broken" "$items"' EXIT
: > "$broken"

fail() {
	echo "check-docs: $*" >> "$broken"
}

# 1. 本地 Markdown 链接存在；指向 checklist 的锚点存在。
find . -path ./.git -prune -o -name '*.md' -print > "$items"
while IFS= read -r f; do
	grep -oE '\]\([^)]*\)' "$f" 2>/dev/null | sed 's/^](//; s/)$//' | while IFS= read -r link; do
		[ -n "$link" ] || continue
		case "$link" in
		http://* | https://* | mailto:* | '#'*) continue ;;
		esac
		target=${link%%#*}
		[ -n "$target" ] || continue
		case "$target" in
		/*) path=$target ;;
		*) path=$(dirname "$f")/$target ;;
		esac
		# 扩展手册里的 docs/... 链接按工作区根目录解析；相对解析失败时再试根目录。
		if [ ! -e "$path" ] && [ -e "$target" ]; then
			path=$target
		fi
		if [ ! -e "$path" ]; then
			fail "broken link: $f -> $link"
			continue
		fi
		anchor=${link#*#}
		if [ "$anchor" != "$link" ] && [ -f "$path" ]; then
			case "$path" in
			*2.1-CHECKLIST.md)
				if ! grep -q "id=\"$anchor\"" "$path"; then
					fail "missing anchor: $f -> $link"
				fi
				;;
			esac
		fi
	done
done < "$items"

# 2. docs 文件名统一为 N.M-NAME.md。
for f in docs/*.md; do
	base=$(basename "$f")
	case "$base" in
	[0-9]*.[0-9]*-*.md) ;;
	*) fail "doc filename should be N.M-NAME.md: $f" ;;
	esac
done

# 3. CHECKLIST 条目：ID 唯一、状态合法、每个条目有状态、已完成有证据。
checklist=docs/2.1-CHECKLIST.md
if [ ! -f "$checklist" ]; then
	fail "missing $checklist"
else
	dups=$(grep -E '^### M[0-9]+-[A-Z0-9]+ ' "$checklist" | awk '{print $2}' | sort | uniq -d)
	if [ -n "$dups" ]; then
		fail "duplicate checklist ids: $dups"
	fi

	awk '
	/^### M[0-9]+-[A-Z0-9]+ / {
		if (id != "" && status == "") print "missing status: " id
		if (id != "" && status == "已完成" && evidence != 1) print "completed without evidence: " id
		id = $2
		head_status = $0
		sub(/^.*— /, "", head_status)
		status = ""; evidence = 0; next
	}
	/^- 状态：/ {
		n = split($0, a, "："); status = a[2]
		if (status !~ /^(待办|进行中|阻塞|已完成|移出)$/) print "invalid status: " id " -> " status
		if (head_status != "" && status != head_status) print "heading/status mismatch: " id " heading=" head_status " status=" status
		next
	}
	/^- 证据：/ {
		n = split($0, a, "："); ev = a[2]
		if (ev != "" && ev != "—") evidence = 1
		next
	}
	END {
		if (id != "" && status == "") print "missing status: " id
		if (id != "" && status == "已完成" && evidence != 1) print "completed without evidence: " id
	}
	' "$checklist" | while IFS= read -r line; do
		fail "checklist: $line"
	done

	for id in m0 m1 m2 m3 m4 m5 m6 m7 m8 rules; do
		grep -q "id=\"$id\"" "$checklist" || fail "checklist missing anchor: $id"
	done
fi

# 4. 旧文档名不再出现。
for pat in \
	'docs/ROADMAP.md' \
	'docs/DESIGN.md' \
	'docs/REFERENCES.md' \
	'docs/IMPLEMENTATION-OVERVIEW.md' \
	'docs/M0-NOTES.md' \
	'docs/M1-NOTES.md' \
	'docs/M1-TWOS-COMPLEMENT-NOTES.md' \
	'docs/M*-NOTES.md' \
	'(ROADMAP.md)' \
	'(DESIGN.md)' \
	'(REFERENCES.md)' \
	'(IMPLEMENTATION-OVERVIEW.md)' \
	'(M0-NOTES.md)' \
	'(M1-NOTES.md)' \
	'(M1-TWOS-COMPLEMENT-NOTES.md)'; do
	hits=$(grep -R -n -F "$pat" --include='*.md' . 2>/dev/null | grep -v '^./.git/' || true)
	if [ -n "$hits" ]; then
		fail "stale reference '$pat':"
		printf '%s\n' "$hits" | while IFS= read -r line; do
			fail "  $line"
		done
	fi
done

# 5. 任务级复选框只在 CHECKLIST 中。
hits=$(grep -R -n -E '^- \[[ x]\] ' --include='*.md' . 2>/dev/null |
	grep -v '^./.git/' | grep -v '^./docs/2.1-CHECKLIST.md:' || true)
if [ -n "$hits" ]; then
	fail "task checkboxes outside CHECKLIST:"
	printf '%s\n' "$hits" | while IFS= read -r line; do
		fail "  $line"
	done
fi

# 6. 入口文档确实指向 CHECKLIST；M0–M8 在三处都有条目/摘要/关卡。
grep -q '2.1-CHECKLIST.md' README.md || fail "README.md does not link to CHECKLIST"
grep -q '2.1-CHECKLIST.md' docs/1.2-ROADMAP.md || fail "ROADMAP does not link to CHECKLIST"
for m in M0 M1 M2 M3 M4 M5 M6 M7 M8; do
	grep -q "^| $m" README.md || fail "README progress table missing $m"
	grep -q "^| $m" "$checklist" || fail "CHECKLIST milestone summary missing $m"
	grep -q "^## $m " docs/1.2-ROADMAP.md || fail "ROADMAP missing section $m"
	grep -q "^### ${m}-G1 " "$checklist" || fail "CHECKLIST missing ${m}-G1 gate"
done

if [ -s "$broken" ]; then
	cat "$broken" >&2
	echo "check-docs: FAILED ($(wc -l < "$broken" | tr -d ' ') problem(s))" >&2
	exit 1
fi

echo "check-docs: OK"
