# 2. Managing Machine Learning Models

PSAT uses YOLO-based computer vision models to auto-code segment attributes from street-level photographs.

---

## Table of Contents

- [2.1 Model Storage](#21-model-storage)
- [2.2 Deploying a New Model](#22-deploying-a-new-model)
- [2.3 Hardware Configuration](#23-hardware-configuration)

---

### 2.1 Model Storage

The computer-vision prediction models (YOLO weights) are stored in:

```
backend/models/
```

Each model is a `.pt` file (PyTorch weights). The filenames correspond to specific attribute classifiers (e.g. facility type, delineation, obstacle detection).

### 2.2 Deploying a New Model

To replace a model with a newly trained version:

1. Stop the backend container (`docker compose stop backend`).
2. Replace the existing `.pt` file in `backend/models/` with the new weights file. Keep the filename identical so the application picks it up automatically.
3. Restart the backend (`docker compose start backend`).
4. Run a test auto-code on a known segment to verify the new model produces expected results.

> Do not rename model files unless you also update the corresponding reference in the backend configuration. Mismatched filenames will cause auto-code failures.

### 2.3 Hardware Configuration

The backend loads all PyTorch models into memory at startup.

- **RAM:** Ensure the host machine has at least 8 GB of available RAM. Multiple models are loaded simultaneously.
- **GPU acceleration:** CUDA drivers must be properly configured on the host for GPU inference. If CUDA is unavailable, the models fall back to CPU automatically — auto-code will work but will be slower.
- **Checking model load status:** Query `/api/health` after startup; a healthy response confirms all models loaded correctly.
