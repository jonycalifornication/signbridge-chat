# Backend Automation Guide: Auto-Convert VRMA

If you want to allow uploading `.vrma` files and have the backend automatically convert them to the Streaming Format, follow this guide.

## 1. Setup the Converter (One-time)
Because the conversion logic relies on the robust `three-vrm` library (JavaScript), the most reliable way is to run a small Node.js utility.

1. Navigate to `src/stream_demo/node_converter`
2. Install dependencies:
   ```bash
   npm install
   ```

## 2. Using the Converter CLI
You can run the script manually to test:
```bash
node src/stream_demo/node_converter/convert.js path/to/animation.vrma
```
**Output:**
```json
{"animationData":"AAA..."}
```

## 3. Integrating with Python/Django
When a user uploads a file, your Django view can trigger this script.

### Example Utility Function
```python
import subprocess
import json
import os

NODE_SCRIPT_PATH = "/path/to/src/stream_demo/node_converter/convert.js"

def convert_vrma_to_binary(vrma_path):
    """
    Runs the Node.js converter and returns the raw Base64 string.
    """
    try:
        # Run node script
        result = subprocess.run(
            ["node", NODE_SCRIPT_PATH, vrma_path],
            capture_output=True,
            text=True,
            check=True
        )
        
        # Parse Output
        data = json.loads(result.stdout)
        return data["animationData"]
        
    except subprocess.CalledProcessError as e:
        print(f"Conversion Error: {e.stderr}")
        return None
```

### Example Django Model & Signal
Use a `post_save` signal to convert automatically when a file is uploaded.

```python
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver

class Animation(models.Model):
    name = models.CharField(max_length=100)
    vrma_file = models.FileField(upload_to='animations/')
    binary_data = models.TextField(blank=True) # Stores the Stream Data

@receiver(post_save, sender=Animation)
def auto_convert_animation(sender, instance, created, **kwargs):
    if created and instance.vrma_file:
        # Get absolute path
        file_path = instance.vrma_file.path
        
        # Convert
        base64_data = convert_vrma_to_binary(file_path)
        
        if base64_data:
            instance.binary_data = base64_data
            instance.save()
```

## 4. Why Node.js?

## Option 2: Python (Zero Dependency)
Required for environments where you **cannot install Node.js**. I have provided a pure Python implementation in `src/stream_demo/python_converter/convert.py`.

It uses only standard libraries (`json`, `struct`, `math`) to parse `.vrma` files and re-sample them at 30fps.

### Usage
```python
import subprocess
import json

PYTHON_SCRIPT_PATH = "src/stream_demo/python_converter/convert.py"

def convert_with_python(vrma_path):
    result = subprocess.run(
        ["python3", PYTHON_SCRIPT_PATH, vrma_path],
        capture_output=True,
        text=True,
        check=True
    )
    return json.loads(result.stdout)["animationData"]
```

### Limitations vs Node.js
- The Python script implements a *basic* linear/spherical interpolation.
- The Node.js script uses the official Three.js animation system, which perfectly matches the frontend's behavior (including CubicSpline interpolation if used).
- **Recommendation**: Use the Python script if you have simple baked animations. Use Node.js if you need 100% fidelity for complex curves.
