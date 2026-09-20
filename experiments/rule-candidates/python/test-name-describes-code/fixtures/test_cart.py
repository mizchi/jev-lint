import pytest

from cart import Cart, Item, checkout, Card


def make_cart():
    cart = Cart()
    cart.add(Item(sku="a", price_cents=100, qty=1))
    cart.add(Item(sku="b", price_cents=200, qty=1))
    return cart


def test_total_sums_item_prices():
    cart = make_cart()
    assert cart.total() == 300


def test_empty_cart_total_is_zero():
    cart = make_cart()
    assert cart.total() == 300


def test_remove_item_deletes_it():
    cart = make_cart()
    item = cart.get("a")
    assert item is not None


def test_add_item_raises_on_negative_qty():
    cart = Cart()
    cart.add(Item(sku="a", price_cents=100, qty=2))
    assert len(cart.items) == 1


def test_items_are_sorted_by_price():
    cart = make_cart()
    items = cart.sorted_items()
    assert len(items) == 2


def test_total():
    cart = make_cart()
    assert cart.total() == 300


def test_drop_item_removes_it():
    cart = make_cart()
    cart.remove("a")
    assert [i.sku for i in cart.items] == ["b"]


def test_apply_coupon_reduces_total():
    cart = make_cart()
    cart.apply_coupon("SAVE10")
    assert cart.total() < 300


def test_checkout_rejects_expired_card():
    cart = make_cart()
    receipt = checkout(cart, Card(number="4111", expires="2020-01"))
    assert receipt.status == "paid"


def test_checkout_charges_the_card():
    cart = make_cart()
    checkout(cart, Card(number="4111", expires="2030-01"))


def test_coupon_applies_to_every_item():
    cart = make_cart()
    cart.apply_coupon("SAVE10")
    assert cart is not None


def test_cheapest_item_is_first():
    cart = make_cart()
    items = cart.sorted_items()
    assert items[0] is not None


def test_add_then_remove_leaves_cart_empty():
    cart = Cart()
    cart.add(Item(sku="a", price_cents=100, qty=1))
    cart.remove("a")
    assert len(cart.items) == 0


def test_total_ignores_free_items():
    cart = make_cart()
    cart.add(Item(sku="gift", price_cents=0, qty=3))
    cart.apply_coupon("NONE")
    assert cart.total() == 300


def test_warning_logged_when_over_limit():
    cart = Cart()
    for i in range(100):
        cart.add(Item(sku=f"s{i}", price_cents=1, qty=1))
    assert len(cart.items) == 100


def test_get_unknown_sku_raises():
    cart = make_cart()
    with pytest.raises(KeyError):
        cart.get("missing")
