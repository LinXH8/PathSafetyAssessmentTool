"""One-time reset of all applied treatments across every profile/project.

The CycleRAP v2.14 upgrade replaced the app-authored 25-treatment catalog with
the workbook's 30 STM treatments; saved treatment IDs from the old catalog do
not map 1:1, so (per the agreed migration decision) all applied treatments are
cleared and users re-apply them under the new model.

For each `profiles/<profile>/projects/<project>/versions/<ver>/treatment.csv`:
  - blanks the "Treatments Applied" column, and
  - resets every attribute column back to the values in the sibling
    `attributes.csv` (mirroring the in-app "reset all" behaviour).

Run:  backend/venv/bin/python scripts/reset_applied_treatments.py [--dry-run]
"""

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PROFILES = ROOT / "profiles"


def reset_treatment_csv(treatment_path: Path, dry_run: bool) -> int:
    """Returns the number of segments whose treatments were cleared."""
    df = pd.read_csv(treatment_path)
    if "Treatments Applied" not in df.columns:
        return 0
    applied = df["Treatments Applied"].fillna("").astype(str).str.strip()
    n_cleared = int((applied != "").sum())
    if n_cleared == 0:
        return 0
    if dry_run:
        return n_cleared

    df["Treatments Applied"] = ""
    attrs_path = treatment_path.parent / "attributes.csv"
    if attrs_path.exists():
        attrs_df = pd.read_csv(attrs_path)
        if len(attrs_df) == len(df):
            for col in df.columns:
                if col != "Treatments Applied" and col in attrs_df.columns:
                    df[col] = attrs_df[col].values
    df.to_csv(treatment_path, index=False)
    return n_cleared


def main():
    dry_run = "--dry-run" in sys.argv
    if not PROFILES.is_dir():
        print(f"No profiles directory at {PROFILES}; nothing to do.")
        return
    total_files = total_segments = 0
    for treatment_path in sorted(PROFILES.glob("*/projects/*/versions/*/treatment.csv")):
        try:
            n = reset_treatment_csv(treatment_path, dry_run)
        except Exception as exc:  # keep going across projects
            print(f"  SKIP {treatment_path.relative_to(ROOT)}: {exc}")
            continue
        if n:
            total_files += 1
            total_segments += n
            print(f"  {'would clear' if dry_run else 'cleared'} {n:>4} segment(s): "
                  f"{treatment_path.relative_to(ROOT)}")
    print(f"{'DRY RUN: ' if dry_run else ''}{total_segments} treated segment(s) "
          f"across {total_files} treatment.csv file(s).")


if __name__ == "__main__":
    main()
