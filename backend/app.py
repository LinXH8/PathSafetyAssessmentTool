from app import create_app
app = create_app()

@app.get("/api/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False, use_reloader=True, threaded=True)