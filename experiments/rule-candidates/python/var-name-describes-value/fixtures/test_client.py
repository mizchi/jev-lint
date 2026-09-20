import pytest

import client


class FakeSession:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, url, timeout=None):
        self.calls.append(url)
        return self.responses[url]


class FakeResponse:
    def __init__(self, status, body=None):
        self.status_code = status
        self.ok = status < 400
        self.body = body

    def json(self):
        return self.body

    def raise_for_status(self):
        if not self.ok:
            raise requests_error(self.status_code)


def requests_error(status):
    return RuntimeError(f"http {status}")


def test_admin_role_is_detected(monkeypatch):
    admin = FakeResponse(200, {"id": "1", "role": "admin"})
    monkeypatch.setattr(client, "_session", FakeSession({f"{client.BASE_URL}/users/1": admin}))
    assert client.is_admin_user("1") is True


def test_unauthorized_user_is_rejected(monkeypatch):
    unauthorized = FakeResponse(403)
    monkeypatch.setattr(client, "_session", FakeSession({f"{client.BASE_URL}/users/2": unauthorized}))
    with pytest.raises(RuntimeError):
        client.fetch_user("2")


def test_domain_of_accepts_valid_addresses():
    ok = ["ann@example.com", "bob@mail.example.org"]
    bad = ["no-at-sign", "@", "trailing@"]
    for address in ok:
        assert "." in client.domain_of(address)
    for address in bad:
        with pytest.raises((IndexError, AssertionError)):
            assert "." in client.domain_of(address)


def test_healthy_count_counts_only_ok(monkeypatch):
    responses = {"a": FakeResponse(200), "b": FakeResponse(500), "c": FakeResponse(204)}
    monkeypatch.setattr(client, "_session", FakeSession(responses))
    healthy = client.healthy_count(["a", "b", "c"])
    assert healthy == 2
