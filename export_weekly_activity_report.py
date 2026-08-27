from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.telemetry_store import generate_weekly_report, upload_weekly_report  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a local weekly PSAT activity report from SQLite telemetry.")
    parser.add_argument("--start", required=True, help="Inclusive window start in ISO 8601 format.")
    parser.add_argument("--end", required=True, help="Exclusive window end in ISO 8601 format.")
    parser.add_argument("--output", help="Optional output JSON file path.")
    parser.add_argument(
        "--upload",
        action="store_true",
        help="POST the generated report to the configured Google Apps Script receiver.",
    )
    args = parser.parse_args(argv)

    report = generate_weekly_report(args.start, args.end)
    upload_error: str | None = None

    if args.upload:
        try:
            upload_weekly_report(report)
        except RuntimeError as exc:
            upload_error = str(exc)

    text = json.dumps(report, indent=2)

    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)

    if upload_error:
        print(upload_error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())