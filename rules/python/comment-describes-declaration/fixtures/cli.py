import argparse
import functools
import logging
import sys

logger = logging.getLogger("sessions")


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse the command line. Exits with status 2 on a bad option."""
    parser = argparse.ArgumentParser(prog="sessions")
    parser.add_argument("--ttl", type=int, default=3600, help="seconds")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


# Memoised: the parser is built once per process.
@functools.lru_cache(maxsize=1)
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sessions")
    parser.add_argument("--ttl", type=int, default=3600)
    return parser


# Logs at DEBUG unless --verbose is given, in which case INFO.
@functools.cache
def configure_logging(verbose: bool) -> None:
    logging.basicConfig(level=logging.INFO if verbose else logging.WARNING)


class Command:
    # Every subclass overrides `run`; the base returns the usage error code.
    def run(self, args: argparse.Namespace) -> int:
        logger.error("no command given")
        return 2

    def name(self) -> str:
        """The command's name: the class name, lowercased."""
        return type(self).__name__.lower()


class Purge(Command):
    """Delete every expired session and print how many were removed."""

    def run(self, args: argparse.Namespace) -> int:
        from session_store import SessionStore

        store = SessionStore(ttl_seconds=args.ttl)
        removed = store.purge()
        print(f"purged {removed}")
        return 0


def main() -> int:
    """Entry point."""
    args = parse_args(sys.argv[1:])
    configure_logging(args.verbose)
    return Purge().run(args)
