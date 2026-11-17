import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress } from "viem";

const { viem, networkHelpers } = await network.create();

async function deploy() {
  const identity = await viem.deployContract("IdentityRegistry");
  const validation = await viem.deployContract("ValidationRegistry", [identity.address]);
  const [owner, validator, stranger] = await viem.getWalletClients();
  await identity.write.register(["ipfs://agent1"], { account: owner.account });
  return { identity, validation, owner, validator, stranger };
}

describe("ValidationRegistry (R8)", () => {
  it("lets the agent owner request validation from a named validator", async () => {
    const { validation, owner, validator } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.emitWithArgs(
      validation.write.requestValidation([1n, validator.account.address, "ipfs://job-42"], { account: owner.account }),
      validation,
      "ValidationRequested",
      [1n, 1n, getAddress(validator.account.address), "ipfs://job-42"],
    );
    const r = await validation.read.getRequest([1n]);
    assert.equal(r.agentId, 1n);
    assert.equal(r.validator, getAddress(validator.account.address));
    assert.equal(r.responded, false);
    assert.deepEqual(await validation.read.getAgentRequests([1n]), [1n]);
  });

  it("rejects requests from non-owners, for unknown agents, or to the zero address", async () => {
    const { validation, validator, stranger, owner } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(
      validation.write.requestValidation([1n, validator.account.address, "x"], { account: stranger.account }),
      validation,
      "NotAgentOwner",
    );
    await viem.assertions.revertWithCustomError(
      validation.write.requestValidation([9n, validator.account.address, "x"], { account: owner.account }),
      validation,
      "AgentNotFound",
    );
    await viem.assertions.revertWithCustomError(
      validation.write.requestValidation([1n, "0x0000000000000000000000000000000000000000", "x"], { account: owner.account }),
      validation,
      "InvalidValidator",
    );
  });

  it("rejects self-validation (validator = agent owner)", async () => {
    const { validation, owner } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(
      validation.write.requestValidation([1n, owner.account.address, "x"], { account: owner.account }),
      validation,
      "SelfValidation",
    );
  });

  it("only the named validator can respond, once, with 0-100", async () => {
    const { validation, owner, validator, stranger } = await networkHelpers.loadFixture(deploy);
    await validation.write.requestValidation([1n, validator.account.address, "ipfs://job"], { account: owner.account });
    await viem.assertions.revertWithCustomError(validation.write.respond([1n, 90, "ipfs://r"], { account: stranger.account }), validation, "NotValidator");
    await viem.assertions.revertWithCustomError(validation.write.respond([1n, 101, "ipfs://r"], { account: validator.account }), validation, "ScoreOutOfRange");
    await viem.assertions.emitWithArgs(validation.write.respond([1n, 90, "ipfs://r"], { account: validator.account }), validation, "ValidationResponded", [
      1n,
      1n,
      90,
    ]);
    await viem.assertions.revertWithCustomError(validation.write.respond([1n, 50, "ipfs://r2"], { account: validator.account }), validation, "AlreadyResponded");
    const r = await validation.read.getRequest([1n]);
    assert.equal(r.responded, true);
    assert.equal(r.response, 90);
    assert.equal(r.responseURI, "ipfs://r");
  });

  it("summarises responded validations per agent", async () => {
    const { validation, owner, validator, stranger } = await networkHelpers.loadFixture(deploy);
    await validation.write.requestValidation([1n, validator.account.address, "a"], { account: owner.account });
    await validation.write.requestValidation([1n, stranger.account.address, "b"], { account: owner.account });
    await validation.write.requestValidation([1n, validator.account.address, "c"], { account: owner.account });
    await validation.write.respond([1n, 80, ""], { account: validator.account });
    await validation.write.respond([2n, 100, ""], { account: stranger.account });
    const [count, average] = await validation.read.getSummary([1n]);
    assert.equal(count, 2n);
    assert.equal(average, 90n);
  });

  it("reverts on unknown request ids", async () => {
    const { validation, validator } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(validation.write.respond([7n, 50, ""], { account: validator.account }), validation, "RequestNotFound");
  });
});
