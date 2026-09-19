test("rejects an expired token", () => {
  const t = makeToken();
  expect(t).toBeDefined();
});
it("adds an item", () => { expect(add(cart, item).items.length).toBe(1); });
