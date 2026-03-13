# ============================================
# FULL TRAINING PIPELINE - LOGIN RISK MODEL
# ============================================

import pandas as pd
import numpy as np
import joblib
import matplotlib.pyplot as plt

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    classification_report,
    roc_auc_score,
    roc_curve
)

# --------------------------------------------
# 1️⃣ Load Dataset
# --------------------------------------------

df = pd.read_csv("data.csv")

print("Dataset Shape:", df.shape)
print(df.head())

# --------------------------------------------
# 2️⃣ Prepare Features & Labels
# --------------------------------------------

X = df.drop("label", axis=1)
y = df["label"]

# --------------------------------------------
# 3️⃣ Train-Test Split
# --------------------------------------------

X_train, X_test, y_train, y_test = train_test_split(
    X, y,
    test_size=0.2,
    random_state=42,
    stratify=y
)

print("\nTraining Samples:", X_train.shape[0])
print("Testing Samples:", X_test.shape[0])

# --------------------------------------------
# 4️⃣ Train Random Forest Model
# --------------------------------------------

model = RandomForestClassifier(
    n_estimators=200,
    max_depth=None,
    random_state=42,
    class_weight="balanced"
)

model.fit(X_train, y_train)

# --------------------------------------------
# 5️⃣ Predictions
# --------------------------------------------

y_pred = model.predict(X_test)
y_prob = model.predict_proba(X_test)[:, 1]

# --------------------------------------------
# 6️⃣ Evaluation Metrics
# --------------------------------------------

accuracy = accuracy_score(y_test, y_pred)
roc_auc = roc_auc_score(y_test, y_prob)

print("\n==============================")
print("MODEL PERFORMANCE")
print("==============================")
print("Accuracy:", round(accuracy, 4))
print("ROC-AUC Score:", round(roc_auc, 4))

print("\nConfusion Matrix:")
print(confusion_matrix(y_test, y_pred))

print("\nClassification Report:")
print(classification_report(y_test, y_pred))

# --------------------------------------------
# 7️⃣ Feature Importance
# --------------------------------------------

importances = model.feature_importances_
feature_names = X.columns

importance_df = pd.DataFrame({
    "Feature": feature_names,
    "Importance": importances
}).sort_values(by="Importance", ascending=False)

print("\nFeature Importance:")
print(importance_df)

# Plot Feature Importance
plt.figure()
plt.barh(importance_df["Feature"], importance_df["Importance"])
plt.xlabel("Importance Score")
plt.ylabel("Feature")
plt.title("Feature Importance - Login Risk Model")
plt.gca().invert_yaxis()
plt.savefig("feature_importance.png")
plt.close()

# --------------------------------------------
# 8️⃣ ROC Curve
# --------------------------------------------

fpr, tpr, _ = roc_curve(y_test, y_prob)

plt.figure()
plt.plot(fpr, tpr)
plt.plot([0, 1], [0, 1])
plt.xlabel("False Positive Rate")
plt.ylabel("True Positive Rate")
plt.title("ROC Curve")
plt.savefig("roc_curve.png")
plt.close()

# --------------------------------------------
# 9️⃣ Save Trained Model
# --------------------------------------------

import os
model_dir = os.path.join(os.path.dirname(__file__), "ml_service")
os.makedirs(model_dir, exist_ok=True)
model_path = os.path.join(model_dir, "login_risk_model.pkl")
joblib.dump(model, model_path)
print(f"\nModel saved as {model_path}")

print("\nTraining Complete Successfully!")
