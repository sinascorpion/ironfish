/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { Asset, generateKey, Note as NativeNote } from '@ironfish/rust-nodejs'
import { BufferMap } from 'buffer-map'
import { Assert } from '../assert'
import { Witness } from '../merkletree'
import { NoteHasher } from '../merkletree/hasher'
import { Side } from '../merkletree/merkletree'
import { IsNoteWitnessEqual } from '../merkletree/witness'
import { useAccountFixture, useMinerBlockFixture } from '../testUtilities/fixtures'
import { createRawTransaction } from '../testUtilities/helpers/transaction'
import { createNodeTest } from '../testUtilities/nodeTest'
import { Note } from './note'
import { RawTransaction, RawTransactionSerde } from './rawTransaction'

describe('RawTransaction', () => {
  const nodeTest = createNodeTest()

  it('should post', async () => {
    const account = await useAccountFixture(nodeTest.wallet)
    const asset = new Asset(account.spendingKey, 'test', '')

    const block = await useMinerBlockFixture(
      nodeTest.chain,
      undefined,
      account,
      nodeTest.wallet,
    )
    await expect(nodeTest.chain).toAddBlock(block)
    await nodeTest.wallet.updateHead()
    const { unconfirmed } = await account.getUnconfirmedBalance(Asset.nativeId())

    const burn = {
      assetId: Asset.nativeId(),
      value: 2n,
    }

    const mint = {
      asset,
      value: 1n,
    }

    const raw = await createRawTransaction({
      wallet: nodeTest.wallet,
      from: account,
      to: account,
      amount: 1n,
      fee: 5n,
      expiration: 10,
      burns: [burn],
      mints: [mint],
    })

    const posted = raw.post()
    expect(posted.takeReference().verify()).toBe(true)
    expect(posted.fee()).toEqual(5n)
    expect(posted.expiration()).toEqual(10)
    expect(posted.notes.length).toEqual(3)
    expect(posted.spends.length).toEqual(1)
    expect(posted.mints.length).toEqual(1)
    expect(posted.burns.length).toEqual(1)

    const valuesByAsset = new BufferMap<bigint>()

    for (const note of posted.notes) {
      const decryptedNote = note.decryptNoteForOwner(account.incomingViewKey)
      Assert.isNotUndefined(decryptedNote)

      const id = decryptedNote.assetId()
      const value = valuesByAsset.get(id) || 0n
      valuesByAsset.set(id, value + decryptedNote.value())
    }

    const nativeValue = valuesByAsset.get(Asset.nativeId())
    Assert.isNotUndefined(nativeValue)
    expect(nativeValue).toEqual(unconfirmed - raw.fee - mint.value - 1n)

    const mintedValue = valuesByAsset.get(asset.id())
    Assert.isNotUndefined(mintedValue)
    expect(mintedValue).toEqual(1n)
  })

  describe('RawTransactionSerde', () => {
    it('serializes and deserializes a block', async () => {
      const account = await useAccountFixture(nodeTest.wallet)
      const asset = new Asset(account.spendingKey, 'asset', 'metadata')

      const note = new Note(
        new NativeNote(
          generateKey().public_address,
          5n,
          'memo',
          asset.id(),
          account.publicAddress,
        ).serialize(),
      )

      const witness = new Witness(
        0,
        Buffer.alloc(32, 1),
        [
          { side: Side.Left, hashOfSibling: Buffer.alloc(32, 1) },
          { side: Side.Right, hashOfSibling: Buffer.alloc(32, 2) },
          { side: Side.Left, hashOfSibling: Buffer.alloc(32, 3) },
        ],
        new NoteHasher(),
      )

      const raw = new RawTransaction()
      raw.spendingKey = account.spendingKey
      raw.expiration = 60
      raw.fee = 1337n

      raw.mints = [
        {
          asset: asset,
          value: 5n,
        },
      ]

      raw.burns = [
        {
          assetId: asset.id(),
          value: 5n,
        },
      ]

      raw.receives = [
        {
          note: note,
        },
      ]

      raw.spends = [{ note, witness }]

      const serialized = RawTransactionSerde.serialize(raw)
      const deserialized = RawTransactionSerde.deserialize(serialized)

      expect(deserialized).toMatchObject({
        spendingKey: raw.spendingKey,
        expiration: raw.expiration,
        fee: raw.fee,
      })

      expect(RawTransactionSerde.serialize(deserialized).equals(serialized)).toBe(true)
      expect(deserialized.receives[0].note).toEqual(raw.receives[0].note)
      expect(deserialized.burns[0].assetId).toEqual(asset.id())
      expect(deserialized.burns[0].value).toEqual(5n)
      expect(deserialized.mints[0].asset.serialize()).toEqual(asset.serialize())
      expect(deserialized.mints[0].value).toEqual(5n)
      expect(deserialized.spends[0].note).toEqual(raw.spends[0].note)
      expect(IsNoteWitnessEqual(deserialized.spends[0].witness, raw.spends[0].witness)).toBe(
        true,
      )
    })
  })
})
