```python
import os

greeting = "Hello, welcome to the demo!"
os.makedirs("out", exist_ok=True)
with open("out/demo.log", "w") as f:
    f.write(greeting + "\n")
```