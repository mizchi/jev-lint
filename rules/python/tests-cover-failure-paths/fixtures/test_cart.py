import pytest

from cart import Cart, add_item, apply_coupon, checkout, discount_for, remove_item, total, truncate_sku


def make_cart():
    cart = Cart()
    add_item(cart, "ab-1234", 100)
    add_item(cart, "cd-5678", 200, qty=2)
    return cart


def test_add_item_rejects_zero_qty():
    with pytest.raises(ValueError):
        add_item(Cart(), "ab-1234", 100, qty=0)


def test_add_item_rejects_malformed_sku():
    with pytest.raises(ValueError):
        add_item(Cart(), "not a sku", 100)


def test_add_item_normalizes_sku():
    item = add_item(Cart(), " ab-1234 ", 100)
    assert item.sku == "AB-1234"


def test_remove_item_returns_the_item():
    cart = make_cart()
    item = remove_item(cart, "AB-1234")
    assert item.price_cents == 100
    assert len(cart.items) == 1


def test_total_sums_qty_times_price():
    assert total(make_cart()) == 500


def test_total_of_empty_cart_is_zero():
    assert total(Cart()) == 0


def test_apply_coupon_takes_ten_percent_off():
    assert apply_coupon(make_cart(), "SAVE10") == 450


def test_discount_for_unknown_code_is_zero():
    assert discount_for(make_cart(), "NOPE") == 0


def test_checkout_rejects_expired_card():
    with pytest.raises(ValueError):
        checkout(make_cart(), card_expires="2020-01", today="2026-09")


def test_checkout_returns_total():
    receipt = checkout(make_cart(), card_expires="2030-01", today="2026-09")
    assert receipt.ok
    assert receipt.total_cents == 500


def test_sku_display_width():
    assert truncate_sku("AB-1234-EXTRA") == "AB-1234"
    with pytest.raises(ValueError):
        truncate_sku("")
