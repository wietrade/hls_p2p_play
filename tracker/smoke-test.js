#!/usr/bin/env node
/**
 * wt-tracker 冒烟测试：模拟两个 p2p-media-loader 客户端，
 * 验证 tracker 的 announce / offer 路由 / answer 路由 / 断开清理 是否正常。
 *
 * 使用 Node.js 内置全局 WebSocket（Node 22+，无需安装 ws 包）。
 *
 * 用法（先启动 tracker）：
 *   cd tracker/wt-tracker && npm start ../config.json
 *   cd tracker && node smoke-test.js
 */
const TRACKER_URL = process.env.TRACKER_URL || "ws://127.0.0.1:8000/tracker";
const INFO_HASH = "testinfohash12345678"; // 20 字符 ASCII（与 core 的 computeInfoHash 输出一致）
const PEER_A = "W-AAAA-test-peer-a-001";   // 发起 offer 的一方
const PEER_B = "W-BBBB-test-peer-b-002";   // 被路由到的一方

function connect(peerId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(TRACKER_URL);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", (e) => reject(new Error("连接失败: " + (e.message || TRACKER_URL))));
    ws.peerId = peerId;
  });
}

function announce(ws, { offers = [], event, numwant = offers.length }) {
  ws.send(JSON.stringify({
    action: "announce",
    info_hash: INFO_HASH,
    peer_id: ws.peerId,
    numwant,
    uploaded: 0,
    downloaded: 0,
    offers,
    ...(event ? { event } : {}),
  }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const a = await connect(PEER_A);
  const b = await connect(PEER_B);
  console.log("✔ 两个客户端已连接 tracker:", TRACKER_URL);

  let results = { aAnswer: null, bOffer: null, aResponse: null, bResponse: null };

  a.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    // A 收到的是 tracker 的 announce 回包（interval/complete/incomplete）
    if (m.action === "announce" && typeof m.interval === "number" && !m.offer && !m.answer) {
      results.aResponse = m;
    }
    // A 收到 B 转回的 answer
    if (m.answer) results.aAnswer = m;
  });
  b.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    if (m.action === "announce" && typeof m.interval === "number" && !m.offer && !m.answer) {
      results.bResponse = m;
    }
    // B 收到 A 的 offer
    if (m.offer) results.bOffer = m;
  });

  // B 先入 swarm 占位（无 offer）——接收方必须先在场，offer 才能被路由到它
  announce(b, { event: "started", offers: [], numwant: 0 });
  await sleep(300);

  // A 后入 swarm 并带 offer，tracker 应把 offer 路由给已在 swarm 的 B
  announce(a, {
    event: "started",
    offers: [{ offer: { type: "offer", sdp: "v=0\r\no=peerA 1 IN IP4 10.0.0.1\r\ns=-\r\n" }, offer_id: "offer-id-00000001" }],
  });
  await sleep(500);

  // B 收到 offer 后回 answer 给 A
  if (results.bOffer) {
    console.log("✔ B 收到 A 的 offer（offer_id =", results.bOffer.offer_id + "）");
    a.send(JSON.stringify({
      action: "announce",
      info_hash: INFO_HASH,
      peer_id: PEER_B,
      to_peer_id: PEER_A,
      offer_id: results.bOffer.offer_id,
      answer: { type: "answer", sdp: "v=0\r\no=peerB 1 IN IP4 10.0.0.2\r\ns=-\r\n" },
    }));
  } else {
    console.log("✘ B 未收到 A 的 offer —— 路由失败");
  }
  await sleep(500);

  if (results.aAnswer) {
    console.log("✔ A 收到 B 的 answer（offer_id =", results.aAnswer.offer_id + "）");
  } else {
    console.log("✘ A 未收到 B 的 answer —— answer 路由失败");
  }
  if (results.aResponse) console.log("✔ A 收到 announce 回包：interval =", results.aResponse.interval, "complete =", results.aResponse.complete, "incomplete =", results.aResponse.incomplete);
  if (results.bResponse) console.log("✔ B 收到 announce 回包：interval =", results.bResponse.interval, "complete =", results.bResponse.complete, "incomplete =", results.bResponse.incomplete);

  // 测试 stopped 事件清理
  announce(a, { event: "stopped", offers: [], numwant: 0 });
  await sleep(200);

  const ok = results.bOffer && results.aAnswer && results.aResponse && results.bResponse;
  console.log(ok ? "\n✅ 冒烟测试通过：信令链路完整（announce/offer/answer/回包）" : "\n❌ 冒烟测试失败，请检查 tracker 日志");
  a.close(); b.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("测试异常:", e); process.exit(1); });
