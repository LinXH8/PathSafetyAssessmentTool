"""Root pytest conftest.

Ensures the `backend/` directory (containing the `app` package) is on
`sys.path` when pytest collects modules under `tests/`. Pytest's default
"prepend" import mode adds each collected test module's own directory to
`sys.path`, which is `tests/` — not `backend/` — so imports like
`from app import create_app` would otherwise fail after tests were moved
out of the backend root (see REFACTOR_PLAN.md S3.7).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
