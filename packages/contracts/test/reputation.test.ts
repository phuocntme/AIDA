import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, stringToHex } from "viem";

const { viem, networkHelpers } = await network.create();
const TAG = stringToHex("quality", { size: 32 });

async function deploy() {
  const identity = await viem.deployContract("IdentityRegistry");
  const reputation = await viem.deployContract("ReputationRegistry", [identity.address]);
  const [agentOwner, clientA, clientB] = await viem.getWalletClients();
  await identity.write.register(["ipfs://agent1"], { account: agentOwner.account });
  return { identity, reputation, agentOwner, clientA, clientB };
}

describe("ReputationRegistry (R3)", () => {
  it("records feedback and emits NewFeedback", async () => {
    const { reputation, clientA } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.emitWithArgs(
      reputation.write.giveFeedback([1n, 80, TAG, "ipfs://fb"], { account: clientA.account }),
      reputation,
      "NewFeedback",
      [1n, getAddress(clientA.account.address), 80, TAG],
    );
    const [count, average] = await reputation.read.getSummary([1n]);
    assert.equal(count, 1n);
    assert.equal(average, 80n);
  });

  it("averages scores across clients", async () => {
    const { reputation, clientA, clientB } = await networkHelpers.loadFixture(deploy);
    await reputation.write.giveFeedback([1n, 90, TAG, ""], { account: clientA.account });
    await reputation.write.giveFeedback([1n, 40, TAG, ""], { account: clientB.account });
    const [count, average] = await reputation.read.getSummary([1n]);
    assert.equal(count, 2n);
    assert.equal(average, 65n);
  });

  it("returns (0, 0) for an agent with no feedback", async () => {
    const { reputation } = await networkHelpers.loadFixture(deploy);
    const [count, average] = await reputation.read.getSummary([1n]);
    assert.equal(count, 0n);
    assert.equal(average, 0n);
  });

  it("lists feedback entries", async () => {
    const { reputation, clientA } = await networkHelpers.loadFixture(deploy);
    await reputation.write.giveFeedback([1n, 70, TAG, "ipfs://x"], { account: clientA.account });
    const list = await reputation.read.getFeedback([1n]);
    assert.equal(list.length, 1);
    assert.equal(list[0].client, getAddress(clientA.account.address));
    assert.equal(list[0].score, 70);
    assert.equal(list[0].tag, TAG);
    assert.equal(list[0].uri, "ipfs://x");
    assert.ok(list[0].timestamp > 0n);
  });

  it("rejects the agent owner rating their own agent", async () => {
    const { reputation, agentOwner } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(
      reputation.write.giveFeedback([1n, 100, TAG, ""], { account: agentOwner.account }),
      reputation,
      "SelfFeedback",
    );
  });

  it("rejects scores above 100", async () => {
    const { reputation, clientA } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(
      reputation.write.giveFeedback([1n, 101, TAG, ""], { account: clientA.account }),
      reputation,
      "ScoreOutOfRange",
    );
  });

  it("rejects feedback for unknown agents", async () => {
    const { reputation, clientA } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(
      reputation.write.giveFeedback([99n, 50, TAG, ""], { account: clientA.account }),
      reputation,
      "AgentNotFound",
    );
  });
});
