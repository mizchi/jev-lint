import pytest

from env import read_config, read_flag, read_port, require


def test_read_port_defaults_to_8080():
    assert read_port({}) == 8080


def test_read_port_rejects_non_numeric():
    with pytest.raises(ValueError):
        read_port({"PORT": "abc"})


def test_read_flag_missing_is_false():
    assert read_flag({}, "DEBUG") is False


def test_read_flag_accepts_yes():
    assert read_flag({"DEBUG": "yes"}, "DEBUG") is True


def test_require_returns_value():
    assert require({"DSN": "sqlite://"}, "DSN") == "sqlite://"


def test_read_config_assembles_fields():
    config = read_config({"PORT": "9000", "DEBUG": "1", "DSN": "sqlite://"})
    assert config.port == 9000
    assert config.debug is True
    assert config.dsn == "sqlite://"
