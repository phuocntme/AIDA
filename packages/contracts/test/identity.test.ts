import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress } from "viem";

const { viem, networkHelpers } = await network.create();

async function deploy() {
  const identity = await viem.deployContract("IdentityRegistry");
  const [owner, other] = await viem.getWalletClients();
  return { identity, owner, other };
}

describe("IdentityRegistry (R1)", () => {
  it("registers an agent with id 1, owned by sender, with its URI", async () => {
    const { identity, owner } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.emitWithArgs(
      identity.write.register(["data:application/json;base64,e30="]),
      identity,
      "Registered",
      [1n, getAddress(owner.account.address), "data:application/json;base64,e30="],
    );
    assert.equal(await identity.read.ownerOf([1n]), getAddress(owner.account.address));
    assert.equal(await identity.read.tokenURI([1n]), "data:application/json;base64,e30=");
    assert.equal(await identity.read.totalAgents(), 1n);
  });

  it("assigns sequential ids", async () => {
    const { identity, other } = await networkHelpers.loadFixture(deploy);
    await identity.write.register(["ipfs://a"]);
    await identity.write.register(["ipfs://b"], { account: other.account });
    assert.equal(await identity.read.ownerOf([2n]), getAddress(other.account.address));
    assert.equal(await identity.read.totalAgents(), 2n);
  });

  it("rejects an empty URI", async () => {
    const { identity } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(identity.write.register([""]), identity, "EmptyURI");
  });

  it("lets the owner update the URI and emits URIUpdated", async () => {
    const { identity } = await networkHelpers.loadFixture(deploy);
    await identity.write.register(["ipfs://a"]);
    await viem.assertions.emitWithArgs(identity.write.setAgentURI([1n, "ipfs://b"]), identity, "URIUpdated", [
      1n,
      "ipfs://b",
    ]);
    assert.equal(await identity.read.tokenURI([1n]), "ipfs://b");
  });

  it("reverts when a non-owner updates the URI", async () => {
    const { identity, other } = await networkHelpers.loadFixture(deploy);
    await identity.write.register(["ipfs://a"]);
    await viem.assertions.revertWithCustomError(
      identity.write.setAgentURI([1n, "ipfs://evil"], { account: other.account }),
      identity,
      "NotAgentOwner",
    );
  });

  it("exists() is false for unknown ids", async () => {
    const { identity } = await networkHelpers.loadFixture(deploy);
    assert.equal(await identity.read.exists([1n]), false);
    await identity.write.register(["ipfs://a"]);
    assert.equal(await identity.read.exists([1n]), true);
  });
});
