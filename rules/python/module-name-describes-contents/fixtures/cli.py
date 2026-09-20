import argparse
import sys

from session_store import SessionStore


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sessions")
    parser.add_argument("command", choices=["purge", "count"])
    parser.add_argument("--ttl", type=int, default=3600)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv if argv is not None else sys.argv[1:])
    store = SessionStore(ttl_seconds=args.ttl)
    if args.command == "purge":
        print(store.purge())
    else:
        print(len(store._sessions))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
