import unittest
from unittest.mock import Mock

from inventory import Inventory, OversellError


class TestInventory(unittest.TestCase):
    def setUp(self):
        self.inv = Inventory()
        self.inv.restock("a", 5)

    def test_restock_increases_quantity(self):
        self.inv.restock("a", 3)
        self.assertEqual(self.inv.quantity("a"), 8)

    def test_reserve_reduces_quantity(self):
        self.inv.restock("a", 2)
        self.assertEqual(self.inv.quantity("a"), 7)

    def testReserveRejectsOversell(self):
        with self.assertRaises(OversellError):
            self.inv.reserve("a", 6)

    def test_reserve_records_in_ledger(self):
        ledger = Mock()
        inv = Inventory(ledger=ledger)
        inv.restock("a", 5)
        inv.reserve("a", 2)
        ledger.record.assert_called_once_with("reserve", "a", 2)

    def test_quantity_of_unknown_sku_is_zero(self):
        self.assertEqual(self.inv.quantity("zzz"), 0)

    def test_reserve_returns_remaining(self):
        remaining = self.inv.reserve("a", 2)
        self.assertIsNotNone(remaining)
