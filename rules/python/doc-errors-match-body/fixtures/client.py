import argparse
import json
import sys
from typing import Optional

import requests


class ApiError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"api responded {status}: {body[:200]}")
        self.status = status


def fetch_job(base_url: str, job_id: int, timeout: float = 5.0) -> dict:
    """Fetch one job from the API.

    Raises:
        requests.HTTPError: if the API responds with an error status.
        requests.Timeout: if the API does not answer within ``timeout``.
    """
    resp = requests.get(f"{base_url}/jobs/{job_id}", timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def fetch_job_or_none(base_url: str, job_id: int) -> Optional[dict]:
    """Fetch one job from the API.

    Returns:
        The job, or None if the API has no job with this id.
    Raises:
        ApiError: for any other error status.
    """
    resp = requests.get(f"{base_url}/jobs/{job_id}", timeout=5.0)
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise ApiError(resp.status_code, resp.text)
    return resp.json()


def submit(base_url: str, name: str) -> int:
    """Submit a job and return its id.

    Raises:
        requests.Timeout: if the API does not answer within five seconds.
    """
    try:
        resp = requests.post(f"{base_url}/jobs", json={"name": name}, timeout=5.0)
    except requests.Timeout:
        return -1
    resp.raise_for_status()
    return resp.json()["id"]


def cancel(base_url: str, job_id: int) -> None:
    """Cancel a job.

    Raises:
        ApiError: if the API responds with an error status.
    """
    resp = requests.delete(f"{base_url}/jobs/{job_id}", timeout=5.0)
    if resp.status_code >= 400:
        raise ApiError(resp.status_code, resp.text)


def parse_args(argv: Optional[list] = None) -> argparse.Namespace:
    """Parse the command line.

    Raises:
        SystemExit: if the arguments are invalid or ``--help`` is given.
    """
    parser = argparse.ArgumentParser(prog="jobctl")
    parser.add_argument("--base-url", default="http://localhost:8080")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    get = sub.add_parser("get")
    get.add_argument("job_id", type=int)
    return parser.parse_args(argv)


def read_config(path: str) -> dict:
    """Read the JSON config file.

    Raises:
        FileNotFoundError: if the file does not exist.
        json.JSONDecodeError: if the file is not valid JSON.
    """
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def load_token(path: str) -> str:
    """Read the API token from a file.

    Returns:
        The token with surrounding whitespace removed. Never raises: a
        missing or unreadable file yields an empty string.
    """
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return ""


def port_from(text: str) -> int:
    """Parse a port number.

    Raises:
        ValueError: if ``text`` is not an integer in 1..65535.
    """
    port = int(text)
    if not 1 <= port <= 65535:
        raise TypeError(f"port {port} out of range")
    return port


def main(argv: Optional[list] = None) -> int:
    """Run the CLI.

    Returns:
        The process exit code: 0 on success, 1 if the API call failed.
    """
    args = parse_args(argv)
    try:
        if args.command == "get":
            print(json.dumps(fetch_job(args.base_url, args.job_id)))
        else:
            print(json.dumps(requests.get(f"{args.base_url}/jobs", timeout=5.0).json()))
    except requests.RequestException as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0
