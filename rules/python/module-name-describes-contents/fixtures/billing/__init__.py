import logging
import smtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)


def send_welcome(to: str) -> None:
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = "Welcome"
    msg.set_content("Thanks for signing up.")
    _deliver(msg)


def send_password_reset(to: str, link: str) -> None:
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = "Reset your password"
    msg.set_content(f"Reset here: {link}")
    _deliver(msg)


def _deliver(msg: EmailMessage) -> None:
    with smtplib.SMTP("localhost") as smtp:
        smtp.send_message(msg)
    logger.info("sent %s to %s", msg["Subject"], msg["To"])
