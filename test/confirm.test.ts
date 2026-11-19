import { strict as assert } from "node:assert";
import { PassThrough } from "node:stream";
import { confirmRun } from "../src/cli/confirm.ts";
import { testAsync } from "./harness.ts";

function terminal(inputTTY = true, outputTTY = true) {
  const input = Object.assign(new PassThrough(), { isTTY: inputTTY });
  const output = Object.assign(new PassThrough(), { isTTY: outputTTY });
  let text = ""; output.on("data", (chunk) => { text += chunk; });
  return { input, output, text: () => text };
}

await testAsync("confirm: only an explicit yes approves a terminal prompt", async () => {
  for (const answer of ["y\n", "Y\n", "yes\n", " YES \n", "\n", "n\n", "no\n", "later\n", "yesterday\n"]) {
    const io = terminal(), pending = confirmRun("Run these checks?", io);
    io.input.end(answer);
    assert.equal(await pending, ["y", "yes"].includes(answer.trim().toLowerCase()) ? "approved" : "declined", answer);
    assert.match(io.text(), /Run these checks\?/); assert.match(io.text(), /\[y\/N\]/);
  }
});

await testAsync("confirm: noninteractive input or hidden prompts cannot approve execution", async () => {
  for (const [inputTTY, outputTTY] of [[false, false], [false, true], [true, false]]) {
    const io = terminal(inputTTY, outputTTY);
    io.input.write("yes\n");
    assert.equal(await confirmRun("Run checks?", io), "unavailable");
    assert.equal(io.text(), ""); assert.equal(io.input.listenerCount("data"), 0);
    io.input.destroy(); io.output.destroy();
  }
});

await testAsync("confirm: EOF, Ctrl-C and input failure resolve without authorizing or hanging", async () => {
  for (const finish of ["eof", "interrupt", "error"]) {
    const io = terminal(), pending = confirmRun("Run checks?", io);
    if (finish === "eof") io.input.end();
    else if (finish === "interrupt") io.input.write("\u0003");
    else io.input.emit("error", new Error("terminal unavailable"));
    assert.equal(await pending, finish === "error" ? "unavailable" : "declined");
    assert.equal(io.input.listenerCount("keypress"), 0);
    io.input.destroy(); io.output.destroy();
  }
});
