"""Healthcheck: heartbeat worker не старше 90 секунд."""
from pathlib import Path
import time
import sys
heartbeat=Path('/tmp/narxpilot-worker-heartbeat')
sys.exit(0 if heartbeat.exists() and time.time()-heartbeat.stat().st_mtime<90 else 1)
