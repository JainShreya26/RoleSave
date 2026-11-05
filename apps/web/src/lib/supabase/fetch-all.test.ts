import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllRows } from "./fetch-all.ts";

function tableOf(rowCount: number) {
  const requests: [number, number][] = [];
  const rows = Array.from({ length: rowCount }, (_, index) => ({ id: index }));
  const readPage = async (from: number, to: number) => {
    requests.push([from, to]);
    // The server never returns more than it allows, however much is asked for.
    return { data: rows.slice(from, Math.min(to + 1, from + 1_000)), error: null };
  };
  return { readPage, requests };
}

test("a short list takes one request", async () => {
  const { readPage, requests } = tableOf(12);
  const { data } = await fetchAllRows(readPage);
  assert.equal(data?.length, 12);
  assert.equal(requests.length, 1);
});

test("an empty list is fine", async () => {
  const { data, error } = await fetchAllRows(tableOf(0).readPage);
  assert.deepEqual(data, []);
  assert.equal(error, null);
});

test("a long list is read in full, in order", async () => {
  const { readPage, requests } = tableOf(1_100);
  const { data } = await fetchAllRows(readPage);
  assert.equal(data?.length, 1_100);
  assert.deepEqual(data?.map(({ id }) => id), Array.from({ length: 1_100 }, (_, index) => index));
  assert.deepEqual(requests[1], [500, 999]);
});

test("a list ending exactly on a page boundary still stops", async () => {
  const { readPage, requests } = tableOf(1_000);
  const { data } = await fetchAllRows(readPage);
  assert.equal(data?.length, 1_000);
  assert.equal(requests.length, 3);
});

test("a failed page returns the error, not part of the list", async () => {
  const failure = { message: "Database unavailable" };
  let calls = 0;
  const result = await fetchAllRows<{ id: number }, typeof failure>(async () => {
    calls += 1;
    return calls === 1
      ? { data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null }
      : { data: null, error: failure };
  });
  assert.equal(result.data, null);
  assert.equal(result.error, failure);
});
