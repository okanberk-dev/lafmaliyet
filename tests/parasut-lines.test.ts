import assert from "node:assert/strict";
import { test } from "node:test";

import { afterTransientFailure, orderLineReads, UBL_MAX_TRIES } from "../src/server/parasut/line-queue";

const rows = [{ id: 30 }, { id: 29 }, { id: 28 }, { id: 27 }];

test("belgesi geçici hatayla alınamayan fatura sıranın sonuna alınır (az denenen önce)", () => {
  // En yeni fatura (30) hep 500 veriyor: artık sıranın başında kalıp ötekileri bekletmez
  assert.deepEqual(orderLineReads(rows, { 30: 1 }).map((r) => r.id), [29, 28, 27, 30]);
  assert.deepEqual(orderLineReads(rows, { 30: 3, 28: 1 }).map((r) => r.id), [29, 27, 28, 30]);
  // Deneme yoksa sıra değişmez (en yeni önce); verilen dizi bozulmaz
  assert.deepEqual(orderLineReads(rows, {}).map((r) => r.id), [30, 29, 28, 27]);
  assert.deepEqual(rows.map((r) => r.id), [30, 29, 28, 27]);
});

test("geçici hata: tek belgede atlanır, art arda ikincide ya da oturum hatasında bırakılır, sonunda vazgeçilir", () => {
  assert.equal(afterTransientFailure(0, 0, false), "skip");
  // Art arda ikinci hata: sorun Paraşüt'ün kendisinde
  assert.equal(afterTransientFailure(0, 1, false), "stop");
  // Oturum hatası belgeye özgü değil: sayılmaz, bırakılır
  assert.equal(afterTransientFailure(UBL_MAX_TRIES - 1, 0, true), "stop");
  // Son deneme de başarısız: okunamadı sayılır (bir daha denenmez), art arda hata olsa da
  assert.equal(afterTransientFailure(UBL_MAX_TRIES - 1, 0, false), "give-up");
  assert.equal(afterTransientFailure(UBL_MAX_TRIES - 1, 1, false), "give-up");
  assert.equal(afterTransientFailure(UBL_MAX_TRIES - 2, 0, false), "skip");
});
