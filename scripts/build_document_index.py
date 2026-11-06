"""Rebuild docs/catalog.md from repository documentation; no services or credentials."""
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
DOCS=ROOT/"docs"
TARGET=DOCS/"catalog.md"
def build():
    groups={}
    for path in sorted(DOCS.rglob("*")):
        if path==TARGET or not path.is_file() or path.suffix.lower() not in (".md",".html"):
            continue
        relative=path.relative_to(DOCS)
        group=relative.parts[0] if len(relative.parts)>1 else "专题规格与指南"
        groups.setdefault(group,[]).append(relative)
    lines=["# 文档总目录","","由scripts/build_document_index.py生成。状态看[项目状态](project-status.md)，接手看[交接入口](handoff/README.md)。目录收录不代表已实现或仍为当前设计。",""]
    for group,paths in sorted(groups.items()):
        lines.extend(["## "+group,""])
        lines.extend("- ["+p.as_posix()+"](<"+p.as_posix()+">)" for p in paths)
        lines.append("")
    TARGET.write_text("\n".join(lines),encoding="utf-8")
    print("Indexed "+str(sum(map(len,groups.values())))+" Markdown/HTML documents.")
if __name__=="__main__":build()
