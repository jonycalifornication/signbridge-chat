# Backend Storage Guide for Animation Streams

The "Slim Animation" format is designed to be compact and easy to store. Here are the recommended ways to handle it in your backend (Django/FastAPI/Node.js).

## 1. The Data Format
The frontend generates a JSON object like this:
```json
{
  "text": "Hello, how are you?",
  "animationData": "AAAAB... (Base64 Encoded Binary) ..."
}
```

### Typical Size
- **Duration**: 5 seconds
- **FPS**: 30
- **Size**: ~100 KB - 150 KB (Base64)
- **Raw Binary**: ~75 KB - 110 KB

## 2. Storage Options

### Option A: JSON Field (Recommended for Simplicity)
Store the entire object as a JSON blob. This is the easiest way to integrate with your existing API.

**PostgreSQL / Django:**
```python
# models.py
from django.db import models

class SignTranslation(models.Model):
    input_text = models.CharField(max_length=255)
    # Store the entire { text, animationData } object here
    animation_payload = models.JSONField() 
```

**Pros:**
- Zero conversion needed. Frontend sends JSON -> Backend saves JSON -> Backend serves JSON.
- Easy to debug (you can see the structure).

### Option B: Binary Field (Recommended for Storage Efficiency)
If you want to save space (approx 30% saving), decode the Base64 and store raw bytes.

**PostgreSQL / Django:**
```python
# models.py
class SignTranslation(models.Model):
    input_text = models.CharField(max_length=255)
    # Store ONLY the raw binary data
    animation_blob = models.BinaryField() 
```

**Workflow:**
1.  **Save**: Backend receives JSON. Decodes `animationData` (Base64) -> Bytes. Saves to `animation_blob`.
2.  **Serve**: Backend reads `animation_blob`. Encodes to Base64. Wraps in JSON `{ "animationData": "..." }`. Returns to frontend.

**Pros:**
- Smaller database size (no Base64 overhead).
**Cons:**
- Requires encoding/decoding logic on the backend.

## 3. Serving the API

Your API endpoint should simply return the JSON structure the frontend player expects.

**FastAPI Example:**
```python
from fastapi import FastAPI
from pydantic import BaseModel

class SignResponse(BaseModel):
    text: str
    animationData: str # Base64 string

@app.get("/translate/{text}", response_model=SignResponse)
async def translate(text: str):
    # 1. Look up in DB or Generate
    # 2. Return payload
    return {
        "text": text,
        "animationData": "AAAAB..." 
    }
```

## Summary
For most use cases, **Option A (JSONField)** is best. 150KB is very small for modern databases (Postgres JSONB supports up to 255MB per field). The storage overhead of Base64 is negligible compared to the development ease of just passing the JSON through.
