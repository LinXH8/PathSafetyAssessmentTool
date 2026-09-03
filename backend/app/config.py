from datetime import timedelta
from pathlib import Path

class Config:
    # data/ sits at the backend root alongside app.py
    DATA_DIR = str((Path(__file__).resolve().parents[1] / "data"))

    # Per-browser login sessions (see app/auth.py). SECRET_KEY, the Secure flag
    # and the cookie name's "_<port>" suffix depend on the runtime environment
    # and are set by auth.configure_session(); everything static lives here.
    SESSION_COOKIE_NAME = "psat_session"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    # "Users remain logged in until they explicitly click Log Out" (admin guide
    # 6.4): a long, fixed lifetime set at login rather than a sliding one, so
    # the hundreds of image/tile responses per page never carry a Set-Cookie.
    PERMANENT_SESSION_LIFETIME = timedelta(days=365)
    SESSION_REFRESH_EACH_REQUEST = False
