def charge(customer, amount_cents, currency="usd"):
    """Charge the customer.

    Args:
        customer: the customer id
        amount: the amount in dollars
    Returns:
        the receipt id, or None on failure
    """
    receipt = gateway.charge(customer, amount_cents, currency)
    if receipt is None:
        raise GatewayError("charge failed")
    return receipt.id


def refund(receipt_id):
    """Refund a receipt in full and return the refund id."""
    return gateway.refund(receipt_id).id
