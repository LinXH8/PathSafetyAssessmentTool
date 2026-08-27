"""Filter a coords-appended export down to rows matching an attribute value.

Companion to append_coords_to_version.py. The row selection is decided ONCE from
attributes*.csv, then applied to every other CSV in the folder by position, so the
files stay mutually row-aligned (results row i still describes attributes row i).

Usage:
    backend/venv/bin/python scripts/filter_coord_export.py \
        --src  /Users/xh/Desktop/PSAT_Decoded_20260811_with_coords \
        --out  /Users/xh/Desktop/PSAT_Decoded_20260811_UtilityBox \
        --column "FO Type" --value "Utility Box" [--exact]

Matching is case-insensitive. By default a multi-valued cell like
"Railing, Utility Box" MATCHES (the value is one of the listed items); --exact
requires the whole cell to equal the value.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", required=True, help="folder produced by append_coords_to_version.py")
    ap.add_argument("--out", required=True, help="output folder (must not be --src)")
    ap.add_argument("--column", required=True, help="attribute column to filter on")
    ap.add_argument("--value", required=True, help="value to match")
    ap.add_argument("--exact", action="store_true",
                    help="require the whole cell to equal --value (default: match "
                         "any comma-separated item within the cell)")
    args = ap.parse_args()

    src = Path(args.src).expanduser().resolve()
    out = Path(args.out).expanduser()
    if not src.is_dir():
        raise SystemExit(f"[fatal] not a directory: {src}")
    if out.resolve() == src:
        raise SystemExit("[fatal] --out must differ from --src")

    csvs = sorted(src.glob("*.csv"))
    attr = next((p for p in csvs if p.name.startswith("attributes")), None)
    if attr is None:
        raise SystemExit(f"[fatal] no attributes*.csv in {src}")

    adf = pd.read_csv(attr, dtype=str, keep_default_na=False)
    if args.column not in adf.columns:
        raise SystemExit(f"[fatal] column {args.column!r} not in {attr.name}")

    want = args.value.strip().casefold()
    col = adf[args.column].astype(str)
    if args.exact:
        mask = col.str.strip().str.casefold() == want
    else:
        # Split the multi-valued cell and test each item, so "Railing, Utility Box"
        # matches "Utility Box" but "Utility Boxes Ltd" would not.
        mask = col.apply(lambda v: want in [i.strip().casefold() for i in v.split(",")])

    idx = adf.index[mask]
    n_src, n_hit = len(adf), len(idx)
    if n_hit == 0:
        raise SystemExit(f"[fatal] no rows match {args.column}={args.value!r}")

    out.mkdir(parents=True, exist_ok=True)
    mode = "exact" if args.exact else "contains"
    print(f"Source : {src}")
    print(f"Output : {out}")
    print(f"Filter : {args.column} {mode} {args.value!r}")
    print(f"Matched: {n_hit:,} of {n_src:,} rows ({n_hit / n_src:.3%})\n")

    for p in csvs:
        df = pd.read_csv(p, dtype=str, keep_default_na=False)
        if len(df) == 0:
            df.to_csv(out / p.name, index=False, encoding="utf-8")
            print(f"  {p.name:<45} 0 rows (empty at source) -> copied as-is")
            continue
        if len(df) != n_src:
            raise SystemExit(
                f"[fatal] {p.name} has {len(df):,} rows but attributes has "
                f"{n_src:,} — cannot apply a positional filter safely"
            )
        sub = df.loc[idx]
        sub.to_csv(out / p.name, index=False, encoding="utf-8")
        print(f"  {p.name:<45} {len(sub):,} rows")

    print("\nDone. Source folder untouched.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
