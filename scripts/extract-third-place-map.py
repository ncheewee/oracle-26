from html.parser import HTMLParser
from pathlib import Path
import json
import re


class AllocationTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_target = False
        self.depth = 0
        self.in_row = False
        self.in_cell = False
        self.row = []
        self.cell = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table" and "sort-under-center" in attrs.get("class", ""):
            self.in_target = True
            self.depth = 1
            return
        if not self.in_target:
            return
        if tag == "table":
            self.depth += 1
        elif tag == "tr":
            self.in_row = True
            self.row = []
        elif tag in ("td", "th") and self.in_row:
            self.in_cell = True
            self.cell = []

    def handle_endtag(self, tag):
        if not self.in_target:
            return
        if tag in ("td", "th") and self.in_cell:
            text = re.sub(r"\s+", " ", "".join(self.cell)).strip()
            self.row.append(text)
            self.in_cell = False
        elif tag == "tr" and self.in_row:
            self.rows.append(self.row)
            self.in_row = False
        elif tag == "table":
            self.depth -= 1
            if self.depth == 0:
                self.in_target = False

    def handle_data(self, data):
        if self.in_target and self.in_cell:
            self.cell.append(data)


source = Path("/private/tmp/knockout-wiki.html")
output = Path("config/third-place-allocation.json")
parser = AllocationTableParser()
parser.feed(source.read_text(encoding="utf-8"))

mapping = {}
for row in parser.rows:
    if not row or not row[0].isdigit():
        continue
    option = int(row[0])
    # Row 1 contains an extra blank cell caused by the table's 495-row spacer.
    cells = row[1:]
    groups = [value for value in cells[:12] if re.fullmatch(r"[A-L]", value)]
    opponents = [value for value in cells if re.fullmatch(r"3[A-L]", value)]
    if len(groups) != 8 or len(opponents) != 8:
        raise ValueError(
            f"Option {option}: expected 8 groups and 8 opponents, "
            f"got {groups=} {opponents=}"
        )
    key = "".join(sorted(groups))
    mapping[key] = dict(
        zip(["1A", "1B", "1D", "1E", "1G", "1I", "1K", "1L"], opponents)
    )

if len(mapping) != 495:
    raise ValueError(f"Expected 495 unique combinations, got {len(mapping)}")

output.write_text(
    json.dumps(
        {
            "source": "FIFA World Cup 2026 Regulations Annex C",
            "reference": "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage#Combinations_of_matches_in_the_round_of_32",
            "combinations": mapping,
        },
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)
print(json.dumps({"combinations": len(mapping), "output": str(output)}))
