from pathlib import Path

class Config:
    # data/ sits at the backend root alongside app.py
    DATA_DIR = str((Path(__file__).resolve().parents[1] / "data"))
