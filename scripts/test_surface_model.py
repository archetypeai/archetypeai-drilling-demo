"""
Test OmegaEncoder::omega_embeddings_surface_01 with n-shot examples on staging.

Usage:
    python scripts/test_surface_model.py

Reads ATAI_API_KEY and ATAI_API_ENDPOINT from .env (or env vars).
Uploads volve_drilling.csv / volve_not_drilling.csv as n-shot examples,
registers a lens, opens a session, streams a few windows from a well file,
and prints the SSE classification stream.
"""

import csv
import json
import os
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
API_VERSION = "v0.5"

MODEL_VERSION = "OmegaEncoder::omega_embeddings_01"
DATA_COLUMNS = ["BPOS", "DBTM", "FLWI", "HDTH", "HKLD", "ROP", "RPM", "SPPA", "WOB"]

# Toggle to test whether surface_01 is a self-classifying model (no n-shot)
# or an embedding model that requires n-shot examples.
USE_N_SHOT = True

WINDOW_SIZE = 128
STEP_SIZE = 128
N_NEIGHBORS = 3
METRIC = "euclidean"
WEIGHTS = "uniform"
ALGORITHM = "ball_tree"
NORMALIZE_INPUT = True
NORMALIZE_EMBEDDINGS = False

DRILLING_CSV = ROOT / "static" / "data" / "volve_drilling.csv"
NOT_DRILLING_CSV = ROOT / "static" / "data" / "volve_not_drilling.csv"
TEST_WELL_CSV = ROOT / "static" / "data" / "wells" / "NA-NA-15_$47$_9-F-5.csv"

NUM_TEST_WINDOWS = 5
TEST_OFFSET = 27000


def load_env():
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

    key = os.environ.get("ATAI_API_KEY")
    endpoint = os.environ.get("ATAI_API_ENDPOINT")
    if not key or not endpoint:
        sys.exit("ATAI_API_KEY and ATAI_API_ENDPOINT must be set in .env or environment")
    return key, endpoint.rstrip("/")


def api_url(endpoint, path):
    return f"{endpoint}/{API_VERSION}{path}"


def post(endpoint, key, path, body, timeout=30):
    r = requests.post(
        api_url(endpoint, path),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=body,
        timeout=timeout,
    )
    if not r.ok:
        sys.exit(f"POST {path} failed: {r.status_code}\n{r.text}")
    return r.json()


def upload_file(endpoint, key, path):
    print(f"  uploading {path.name} ...")
    with path.open("rb") as f:
        r = requests.post(
            api_url(endpoint, "/files"),
            headers={"Authorization": f"Bearer {key}"},
            files={"file": (path.name, f, "text/csv")},
            timeout=60,
        )
    if not r.ok:
        sys.exit(f"upload failed: {r.status_code}\n{r.text}")
    file_id = r.json()["file_id"]
    print(f"  -> file_id={file_id}")
    return file_id


def wait_for_running(endpoint, key, session_id, max_wait=90):
    print(f"  waiting for session {session_id} to reach RUNNING ...")
    start = time.time()
    while time.time() - start < max_wait:
        status = post(
            endpoint, key,
            "/lens/sessions/events/process",
            {"session_id": session_id, "event": {"type": "session.status"}},
        )
        s = status.get("session_status", "")
        if "RUNNING" in s or s == "3":
            print(f"  -> RUNNING ({int(time.time() - start)}s)")
            return True
        if "FAILED" in s or s == "6":
            sys.exit(f"  session FAILED: {json.dumps(status, indent=2)}")
        time.sleep(1)
    sys.exit(f"  timed out waiting for session to start (last status: {s})")


def load_window(csv_path, offset, size):
    rows = []
    with csv_path.open() as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            if i < offset:
                continue
            if len(rows) >= size:
                break
            rows.append(row)
    if len(rows) < size:
        sys.exit(f"  not enough rows in {csv_path.name} at offset {offset}")
    # transpose to channel-first: [[col1_vals], [col2_vals], ...]
    return [[float(r[c]) if r[c] not in ("", None) else 0.0 for r in rows] for c in DATA_COLUMNS]


def stream_windows(endpoint, key, session_id, num_windows):
    print(f"  streaming {num_windows} windows from {TEST_WELL_CSV.name} ...")
    for i in range(num_windows):
        offset = TEST_OFFSET + i * STEP_SIZE
        sensor_data = load_window(TEST_WELL_CSV, offset, WINDOW_SIZE)
        post(
            endpoint, key,
            "/lens/sessions/events/process",
            {
                "session_id": session_id,
                "event": {
                    "type": "session.update",
                    "event_data": {
                        "type": "data.json",
                        "event_data": {
                            "sensor_data": sensor_data,
                            "sensor_metadata": {
                                "sensor_timestamp": time.time(),
                                "sensor_id": f"test_window_{i}",
                            },
                        },
                    },
                },
            },
        )
        print(f"    sent window {i + 1}/{num_windows} (offset={offset})")


def consume_sse(endpoint, key, session_id, max_events=20, timeout=40):
    url = api_url(endpoint, f"/lens/sessions/consumer/{session_id}")
    print(f"  consuming SSE from {url}")
    print(f"  (waiting up to {timeout}s for {max_events} events)\n")
    seen = 0
    start = time.time()
    with requests.get(url, headers={"Authorization": f"Bearer {key}"}, stream=True, timeout=timeout) as r:
        if not r.ok:
            sys.exit(f"  SSE consumer failed: {r.status_code}\n{r.text}")
        for raw in r.iter_lines(decode_unicode=True):
            if time.time() - start > timeout:
                break
            if not raw or not raw.startswith("data:"):
                continue
            payload = raw[5:].strip()
            try:
                ev = json.loads(payload)
            except json.JSONDecodeError:
                print(f"    [non-json] {payload[:200]}")
                continue
            ev_type = ev.get("type", "?")
            print(f"  --- event #{seen + 1}: {ev_type} ---")
            print(f"  {json.dumps(ev, indent=2)}\n")
            seen += 1
            if seen >= max_events:
                break
    print(f"  -> consumed {seen} events")


def main():
    key, endpoint = load_env()
    print(f"Endpoint: {endpoint}")
    print(f"Model:    {MODEL_VERSION}\n")

    if USE_N_SHOT:
        print("[1/5] Uploading n-shot examples")
        drilling_id = upload_file(endpoint, key, DRILLING_CSV)
        not_drilling_id = upload_file(endpoint, key, NOT_DRILLING_CSV)
        n_shot = {"DRILLING": drilling_id, "NOT_DRILLING": not_drilling_id}
    else:
        print("[1/5] Skipping n-shot upload (USE_N_SHOT=False)")
        n_shot = {}

    print("\n[2/5] Registering lens")
    lens_name = f"surface-test-{int(time.time())}"
    model_parameters = {
        "model_name": "OmegaEncoder",
        "model_version": MODEL_VERSION,
        "normalize_input": NORMALIZE_INPUT,
        "buffer_size": WINDOW_SIZE,
        "csv_configs": {
            "timestamp_column": "DATE_TIME",
            "data_columns": DATA_COLUMNS,
            "window_size": WINDOW_SIZE,
            "step_size": STEP_SIZE,
        },
        "knn_configs": {
            "n_neighbors": N_NEIGHBORS,
            "metric": METRIC,
            "weights": WEIGHTS,
            "algorithm": ALGORITHM,
            "normalize_embeddings": NORMALIZE_EMBEDDINGS,
        },
    }
    if n_shot:
        model_parameters["input_n_shot"] = n_shot

    lens_config = {
        "lens_name": lens_name,
        "lens_config": {
            "model_pipeline": [{"processor_name": "lens_timeseries_state_processor", "processor_config": {}}],
            "model_parameters": model_parameters,
            "output_streams": [{"stream_type": "server_sent_events_writer"}],
        },
    }
    lens = post(endpoint, key, "/lens/register", {"lens_config": lens_config})
    lens_id = lens["lens_id"]
    print(f"  -> lens_id={lens_id}")

    print("\n[3/5] Creating session")
    session = post(endpoint, key, "/lens/sessions/create", {"lens_id": lens_id})
    session_id = session["session_id"]
    print(f"  -> session_id={session_id}")

    print("\n[4/5] Waiting for session to start")
    wait_for_running(endpoint, key, session_id)

    print("\n[5/5] Streaming test data + consuming SSE")
    stream_windows(endpoint, key, session_id, NUM_TEST_WINDOWS)
    # small delay so the model has time to produce outputs
    time.sleep(2)
    consume_sse(endpoint, key, session_id, max_events=NUM_TEST_WINDOWS * 2, timeout=20)

    print("\nCleanup:")
    print(f"  destroy session: POST /lens/sessions/destroy {{\"session_id\":\"{session_id}\"}}")
    print(f"  delete lens:     POST /lens/delete           {{\"lens_id\":\"{lens_id}\"}}")


if __name__ == "__main__":
    main()
