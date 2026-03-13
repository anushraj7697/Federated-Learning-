"""
ML Service - Login Risk Prediction
FastAPI service that loads the pre-trained Random Forest model
and exposes a /predict endpoint for risk scoring.
"""

import os
import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List

# Load model at startup
MODEL_PATH = os.path.join(os.path.dirname(__file__), "login_risk_model.pkl")
model = None


def load_model():
    global model
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"Model not found at {MODEL_PATH}. Run train_model.py first."
        )
    model = joblib.load(MODEL_PATH)


app = FastAPI(title="Login Risk ML Service", version="1.0.0")


@app.on_event("startup")
async def startup_event():
    load_model()


class PredictRequest(BaseModel):
    """Feature array: [ip_new, location_new, device_new, time_deviation, password_attempts, failed_attempts_24h, geo_distance]"""
    features: List[float]


@app.post("/predict")
async def predict(request: PredictRequest):
    """Predict login risk score (probability of suspicious behavior)"""
    global model
    if model is None:
        load_model()

    features = request.features
    if len(features) != 7:
        raise HTTPException(
            status_code=400,
            detail="Expected 7 features: [ip_new, location_new, device_new, time_deviation, password_attempts, failed_attempts_24h, geo_distance]"
        )

    try:
        risk_score = float(model.predict_proba([features])[0][1])
        return {"risk_score": round(risk_score, 4)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": model is not None}
